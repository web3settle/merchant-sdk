import { useEffect, useRef, useState } from 'react';
import { useWeb3SettleContext } from '../components/Web3SettleProvider';
import { Web3SettleApiClient } from '../core/api-client';
import type { QuoteResponse } from '../core/types';

/**
 * Denial-of-wallet guard (SEC-FINOPS-009): cap the number of *auto* refreshes
 * per hook/modal session so a checkout tab left open in the background can't
 * hammer our quote endpoint (which fans out to paid Chainlink RPCs) forever.
 * At the default 30s cadence this is ~20 min of open-modal polling; after the
 * cap the displayed quote simply stops auto-updating until the user interacts
 * (manual `refresh()`) or remounts the hook. Manual `refresh()` is never
 * capped.
 */
const MAX_AUTO_REFRESHES = 40;

/** Backoff ceiling for repeated quote failures (ms). */
const MAX_BACKOFF_MS = 5 * 60_000;

interface UseQuoteOptions {
  /**
   * Auto-refresh cadence in milliseconds (default 30_000 = every 30s). This is
   * the steady-state interval between successful re-quotes while the modal is
   * visible; integrators can raise it to reduce quote-endpoint load or lower it
   * for a snappier displayed price. Set to `0` to disable polling entirely
   * (useful for tests). Note that auto-refresh additionally pauses while the
   * tab is hidden, backs off on repeated failure, and stops after
   * {@link MAX_AUTO_REFRESHES} ticks per session.
   */
  refreshIntervalMs?: number;
  /** Skip fetching while any of network/token/amount is unset. */
  enabled?: boolean;
}

interface UseQuoteResult {
  quote: QuoteResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Server-issued USD → token quote with auto-refresh. Backed by
 * <c>GET /api/storefronts/{id}/quote</c>, which reads Chainlink via our gateway RPCs.
 *
 * Auto-refresh keeps the user looking at a fresh number while they hover on the review step;
 * the *signed* amount is whatever the most recent quote said at the moment they click Pay.
 * Slippage between that point and tx confirmation is the merchant's concern (they reconcile
 * USD value when our webhook hits their backend), so the SDK doesn't try to lock USD client-
 * side or re-quote at confirmation.
 */
export function useQuote(
  network: string | null,
  token: string | null,
  amountUsd: number | null,
  options: UseQuoteOptions = {},
): UseQuoteResult {
  const { refreshIntervalMs = 30_000, enabled = true } = options;
  const { config } = useWeb3SettleContext();

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping `tick` via setTick() is how both auto-refresh ticks AND manual refresh() trigger a
  // fresh fetch — including it in the effect deps gives us a single fetch path.
  const [tick, setTick] = useState(0);

  // SEC-FINOPS-009 bookkeeping, kept in refs so updating them never re-renders
  // or restarts the decoupled auto-refresh timer:
  //   - autoRefreshCountRef: auto ticks fired this session (manual refresh()
  //     does not count) → enforces MAX_AUTO_REFRESHES.
  //   - failureCountRef: consecutive fetch failures → drives jittered
  //     exponential backoff. Reset to 0 on the next success.
  const autoRefreshCountRef = useRef(0);
  const failureCountRef = useRef(0);

  const ready =
    enabled && Boolean(network) && Boolean(token) && typeof amountUsd === 'number' && amountUsd > 0;

  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!ready || network === null || token === null || amountUsd === null) {
      setQuote(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const client = new Web3SettleApiClient(config.apiBaseUrl, config.storefrontId);
    setIsLoading(true);
    setError(null);

    client
      .fetchQuote(network, token, amountUsd, controller.signal)
      .then((q) => {
        if (controller.signal.aborted) return;
        failureCountRef.current = 0; // success clears the backoff streak
        setQuote(q);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        failureCountRef.current += 1; // grows the backoff streak
        setError(err instanceof Error ? err.message : 'Quote unavailable');
        setQuote(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [ready, network, token, amountUsd, config.apiBaseUrl, config.storefrontId, tick]);

  // Auto-refresh: schedule a tick bump on the requested cadence. Decoupled from the fetch
  // effect so re-fetches caused by input changes don't reset the auto-refresh timer.
  //
  // SEC-FINOPS-009 (denial-of-wallet): a self-rescheduling timeout chain (vs a
  // fixed setInterval) lets us (a) pause while the tab is hidden, (b) stop after
  // MAX_AUTO_REFRESHES auto ticks, and (c) back off exponentially (with jitter)
  // when quotes keep failing — so a backgrounded checkout tab can't pin our
  // paid quote endpoint. Manual refresh() is unaffected: it bumps `tick`
  // directly and never increments the auto counter.
  useEffect(() => {
    if (!ready || refreshIntervalMs <= 0) return;

    let cancelled = false;
    let timerId: number | undefined;

    // Steady cadence on success; jittered exponential backoff after consecutive
    // failures: base · 2^(failures-1), capped, then full-jittered to spread
    // retries across tabs.
    const computeDelay = (): number => {
      const failures = failureCountRef.current;
      if (failures <= 0) return refreshIntervalMs;
      const exp = Math.min(refreshIntervalMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
      return Math.round(Math.random() * exp);
    };

    const scheduleNext = () => {
      if (cancelled || autoRefreshCountRef.current >= MAX_AUTO_REFRESHES) return;
      timerId = window.setTimeout(() => {
        if (cancelled) return;
        // Page Visibility API: don't fetch (or spend the cap budget) while the
        // tab is hidden. visibilitychange below resumes us once it's visible.
        if (typeof document !== 'undefined' && document.hidden) {
          timerId = undefined;
          return;
        }
        autoRefreshCountRef.current += 1;
        setTick((t) => t + 1);
        scheduleNext();
      }, computeDelay());
    };

    const handleVisibility = () => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) return;
      // Became visible again — restart the chain if it had stalled while hidden.
      if (timerId === undefined) scheduleNext();
    };

    scheduleNext();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [ready, refreshIntervalMs]);

  return { quote, isLoading, error, refresh };
}
