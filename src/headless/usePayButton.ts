/**
 * Headless pay-button controller (item 14.5).
 *
 * Wraps the same payment-config discovery + start-payment plumbing the React
 * `<Web3SettlePayButton>` uses, but exposes it as a plain controller with a
 * `subscribe` API. Consumers pull a state snapshot, listen for changes, and
 * call `start()` to fire the flow.
 *
 * No React imports here. The Web Component (`src/wc/`) and any Vue/Svelte/JS
 * caller drive this directly.
 */
import { Web3SettleApiClient } from '../core/api-client';
import {
  PaymentStatus,
  type PaymentConfig,
} from '../core/types';
import { safeEmit, type TelemetryCallback, buildTelemetryEvent, hashWalletAddress } from '../core/telemetry';

/** A snapshot of the controller's current state. */
export interface PayButtonState {
  /** Status enum mirroring `usePayment` from the React layer. */
  status: PaymentStatus;
  /** Last payment-config fetched from the backend. `null` until ready. */
  paymentConfig: PaymentConfig | null;
  /** Loading flag for the initial config fetch. */
  configLoading: boolean;
  /** Last error encountered (config fetch or payment start). */
  error: string | null;
  /** Last tx hash returned by the chain. `null` until a tx is broadcast. */
  txHash: string | null;
}

/** Options for {@link createPayButtonController}. */
export interface PayButtonControllerOptions {
  /** Pre-built API client. Either this or `apiBaseUrl` + `storefrontId` is required. */
  apiClient?: Web3SettleApiClient;
  apiBaseUrl?: string;
  storefrontId?: string;
  /** Optional callback for failure breadcrumbs. See `core/telemetry`. */
  onTelemetry?: TelemetryCallback;
  /**
   * Optional payment runner. When omitted, `start()` only loads config and
   * surfaces the snapshot — useful for non-EVM stacks that handle the chain
   * call themselves. When provided, it's invoked with the merged context.
   */
  runPayment?: (ctx: { amount: number; paymentConfig: PaymentConfig }) => Promise<{ txHash: string }>;
}

/** Public API of the headless controller. */
export interface PayButtonController {
  /** Read the latest snapshot synchronously. */
  getState(): PayButtonState;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (state: PayButtonState) => void): () => void;
  /** Trigger the flow: load config → run payment if a runner was provided. */
  start(amount: number): Promise<void>;
  /** Reset to idle. */
  reset(): void;
  /** Manually fetch the merchant payment-config. */
  loadConfig(): Promise<void>;
}

const INITIAL_STATE: PayButtonState = Object.freeze({
  status: PaymentStatus.Idle,
  paymentConfig: null,
  configLoading: false,
  error: null,
  txHash: null,
});

export function createPayButtonController(opts: PayButtonControllerOptions): PayButtonController {
  let apiClient: Web3SettleApiClient;
  if (opts.apiClient) {
    apiClient = opts.apiClient;
  } else if (opts.apiBaseUrl && opts.storefrontId) {
    apiClient = new Web3SettleApiClient(opts.apiBaseUrl, opts.storefrontId);
  } else {
    throw new Error('createPayButtonController requires either apiClient or apiBaseUrl+storefrontId');
  }

  let state: PayButtonState = INITIAL_STATE;
  const listeners = new Set<(s: PayButtonState) => void>();

  const setState = (partial: Partial<PayButtonState>) => {
    state = { ...state, ...partial };
    for (const l of listeners) {
      try {
        l(state);
      } catch {
        // Ignore subscriber errors — same posture as `safeEmit`.
      }
    }
  };

  const loadConfig = async () => {
    setState({ configLoading: true, error: null });
    try {
      const cfg = await apiClient.fetchPaymentConfig();
      setState({ paymentConfig: cfg, configLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load config';
      setState({ configLoading: false, error: message });
      safeEmit(opts.onTelemetry, buildTelemetryEvent({
        chain: 'evm', // config fetch is chain-agnostic; default bucket
        phase: 'connect',
        errorCode: 'unknown',
        rawMessage: message,
      }));
    }
  };

  const start = async (amount: number) => {
    setState({ status: PaymentStatus.Connecting, error: null, txHash: null });
    if (!state.paymentConfig) {
      await loadConfig();
    }
    if (!state.paymentConfig) {
      // loadConfig set the error already
      setState({ status: PaymentStatus.Error });
      return;
    }
    if (!opts.runPayment) {
      // Headless caller is in charge of running the chain call. Surface the
      // loaded config; flag idle so the caller can drive it.
      setState({ status: PaymentStatus.Idle });
      return;
    }
    try {
      setState({ status: PaymentStatus.Sending });
      const result = await opts.runPayment({
        amount,
        paymentConfig: state.paymentConfig,
      });
      setState({ txHash: result.txHash, status: PaymentStatus.Success });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      setState({ error: message, status: PaymentStatus.Error });
      const digest = await hashWalletAddress(undefined);
      safeEmit(opts.onTelemetry, buildTelemetryEvent({
        chain: 'evm',
        phase: 'send',
        errorCode: message.toLowerCase().includes('reject') ? 'user-rejected' : 'unknown',
        rawMessage: message,
        walletDigest: digest,
      }));
    }
  };

  const reset = () => {
    setState({
      status: PaymentStatus.Idle,
      txHash: null,
      error: null,
    });
  };

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start,
    reset,
    loadConfig,
  };
}
