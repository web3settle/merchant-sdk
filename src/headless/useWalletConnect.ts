/**
 * Headless wallet-connect controller (item 14.5).
 *
 * Framework-agnostic alternative to the React `useWallet`. Mirrors the
 * connect / disconnect / status surface so non-React consumers can pull a
 * snapshot, listen for changes, and drive the connect flow.
 *
 * The actual chain calls are pluggable via {@link WalletConnectControllerOptions.connect}
 * — we don't import wagmi/viem/tronweb/web3.js here. This keeps the bundle
 * surface tiny: a Web Component that doesn't talk to any wallet at all just
 * uses this to render a button stub.
 */

export interface WalletConnectState {
  /** Last connected address (any chain), or null when disconnected. */
  address: string | null;
  /** Connection status — strings rather than enum so callers can extend. */
  status: 'idle' | 'connecting' | 'connected' | 'error';
  /** Last error from connect or disconnect, surfaced as a string. */
  error: string | null;
}

export interface WalletConnectControllerOptions {
  /**
   * Caller-supplied connect routine. Returns the connected address on
   * success. The controller takes care of state transitions.
   */
  connect: () => Promise<string>;
  /** Caller-supplied disconnect routine. Optional — defaults to a no-op. */
  disconnect?: () => Promise<void> | void;
}

export interface WalletConnectController {
  getState(): WalletConnectState;
  subscribe(listener: (state: WalletConnectState) => void): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const INITIAL_STATE: WalletConnectState = Object.freeze({
  address: null,
  status: 'idle' as const,
  error: null,
});

export function createWalletConnectController(
  opts: WalletConnectControllerOptions,
): WalletConnectController {
  let state: WalletConnectState = INITIAL_STATE;
  const listeners = new Set<(s: WalletConnectState) => void>();

  const setState = (partial: Partial<WalletConnectState>) => {
    state = { ...state, ...partial };
    for (const l of listeners) {
      try { l(state); } catch { /* swallow */ }
    }
  };

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async connect() {
      setState({ status: 'connecting', error: null });
      try {
        const addr = await opts.connect();
        setState({ address: addr, status: 'connected' });
      } catch (err) {
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Connect failed',
        });
      }
    },
    async disconnect() {
      try {
        if (opts.disconnect) await opts.disconnect();
      } catch (err) {
        setState({ error: err instanceof Error ? err.message : 'Disconnect failed' });
        return;
      }
      setState({ address: null, status: 'idle', error: null });
    },
  };
}
