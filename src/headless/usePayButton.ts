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
import {
  resolveAttribution,
  type PayInMode,
  type PaymentReference,
  type ResolvedAttribution,
} from '../core/payment-reference';

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
  /** The `paymentReference` the current attempt pays against (`null` when unattributed / idle). */
  paymentReference: string | null;
}

/** Per-attempt options for {@link PayButtonController.start}. */
export interface PayButtonStartOptions {
  /** bytes32 `paymentReference` from your backend's `POST /api/payment/create`. */
  paymentReference?: string;
  /** Overrides the controller's `mode` for this attempt. */
  mode?: PayInMode;
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
  runPayment?: (ctx: {
    amount: number;
    paymentConfig: PaymentConfig;
    /**
     * Present in attributed mode (the default): pass it to `payInNativeWithReference` /
     * `payInTokenWithReference` (see `buildPayInCall`). Absent only when `mode` is `'unattributed'`.
     */
    paymentReference?: PaymentReference;
    mode: PayInMode;
  }) => Promise<{ txHash: string }>;
  /**
   * `'attributed'` (default): `start()` refuses to call `runPayment` without a valid
   * `paymentReference`. `'unattributed'`: the runner gets none — explicit opt-in.
   */
  mode?: PayInMode;
}

/** Public API of the headless controller. */
export interface PayButtonController {
  /** Read the latest snapshot synchronously. */
  getState(): PayButtonState;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (state: PayButtonState) => void): () => void;
  /** Trigger the flow: load config → run payment if a runner was provided. */
  start(amount: number, opts?: PayButtonStartOptions): Promise<void>;
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
  paymentReference: null,
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

  const start = async (amount: number, startOpts: PayButtonStartOptions = {}) => {
    // Attribution is decided before config is fetched or the runner (and so the wallet) is
    // touched. Without a runner nothing is paid here, so a missing reference is not an error —
    // the caller that pays reads it from the snapshot.
    let attribution: ResolvedAttribution | null = null;
    try {
      attribution = resolveAttribution({
        paymentReference: startOpts.paymentReference,
        mode: startOpts.mode ?? opts.mode,
      });
    } catch (err) {
      if (opts.runPayment) {
        setState({
          status: PaymentStatus.Error,
          error: err instanceof Error ? err.message : 'Invalid payment reference',
          txHash: null,
          paymentReference: null,
        });
        return;
      }
    }
    setState({
      status: PaymentStatus.Connecting,
      error: null,
      txHash: null,
      paymentReference: attribution?.mode === 'attributed' ? attribution.paymentReference : null,
    });
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
        ...(attribution?.mode === 'attributed'
          ? { paymentReference: attribution.paymentReference, mode: 'attributed' as const }
          : { mode: 'unattributed' as const }),
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
      paymentReference: null,
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
