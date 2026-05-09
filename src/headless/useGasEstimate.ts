/**
 * Headless gas-estimate controller (item 14.5).
 *
 * Wraps any of the three chain estimators (`evm/estimateGas`,
 * `solana/estimateGas`, `tron/estimateGas`) under a single subscription
 * surface so non-React UIs can drive "≈ $X fee" badges.
 *
 * The estimator is injected as a thunk so the controller stays chain-agnostic
 * and the SDK doesn't import wagmi/viem from this directory.
 */
import type { GasEstimate } from '../evm/estimateGas';

export interface GasEstimateState {
  /** Last successful estimate, if any. */
  estimate: GasEstimate | null;
  /** Whether a refresh is in flight. */
  loading: boolean;
  /** Last error from the estimator. */
  error: string | null;
  /** Wall-clock ms when `estimate` was last set. */
  fetchedAt: number | null;
}

export interface GasEstimateControllerOptions {
  /** Function the controller calls to get a fresh estimate. */
  estimate: (signal?: AbortSignal) => Promise<GasEstimate>;
  /**
   * Optional auto-refresh interval (ms). Set to `0` or `undefined` to disable.
   * Useful for the modal's footer where the fee badge updates every minute.
   */
  refreshIntervalMs?: number;
}

export interface GasEstimateController {
  getState(): GasEstimateState;
  subscribe(listener: (state: GasEstimateState) => void): () => void;
  /** Run an estimate now. Cancels any in-flight call first. */
  refresh(): Promise<void>;
  /** Stop any timer and abort any in-flight call. */
  dispose(): void;
}

const INITIAL_STATE: GasEstimateState = Object.freeze({
  estimate: null,
  loading: false,
  error: null,
  fetchedAt: null,
});

export function createGasEstimateController(
  opts: GasEstimateControllerOptions,
): GasEstimateController {
  let state: GasEstimateState = INITIAL_STATE;
  const listeners = new Set<(s: GasEstimateState) => void>();
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setState = (partial: Partial<GasEstimateState>) => {
    state = { ...state, ...partial };
    for (const l of listeners) {
      try { l(state); } catch { /* swallow */ }
    }
  };

  const refresh = async () => {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setState({ loading: true, error: null });
    try {
      const result = await opts.estimate(controller.signal);
      if (controller.signal.aborted) return;
      setState({ estimate: result, loading: false, fetchedAt: Date.now() });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        loading: false,
        error: err instanceof Error ? err.message : 'Gas estimate failed',
      });
    }
  };

  const scheduleNext = () => {
    if (!opts.refreshIntervalMs || opts.refreshIntervalMs <= 0) return;
    timer = setTimeout(() => {
      void refresh().finally(scheduleNext);
    }, opts.refreshIntervalMs);
  };

  // Kick off auto-refresh if configured. Callers always get a chance to
  // subscribe first because we use a microtask to fire.
  if (opts.refreshIntervalMs && opts.refreshIntervalMs > 0) {
    queueMicrotask(() => {
      void refresh().finally(scheduleNext);
    });
  }

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    refresh,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      abort?.abort();
      abort = null;
      listeners.clear();
    },
  };
}
