import { useEffect, useState } from 'react';
import { useWeb3SettleContext } from '../components/Web3SettleProvider';
import { Web3SettleApiClient } from '../core/api-client';
import type { QuoteResponse } from '../core/types';

interface UseQuoteOptions {
  /** Auto-refresh interval. Set to 0 to disable polling — useful for tests. */
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

  const ready =
    enabled && !!network && !!token && typeof amountUsd === 'number' && amountUsd > 0;

  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!ready) {
      setQuote(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const client = new Web3SettleApiClient(config.apiBaseUrl, config.storefrontId);
    setIsLoading(true);
    setError(null);

    client
      .fetchQuote(network!, token!, amountUsd!, controller.signal)
      .then((q) => {
        if (!controller.signal.aborted) setQuote(q);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
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
  useEffect(() => {
    if (!ready || refreshIntervalMs <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [ready, refreshIntervalMs]);

  return { quote, isLoading, error, refresh };
}
