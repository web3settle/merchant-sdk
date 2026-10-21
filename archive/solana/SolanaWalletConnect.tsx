import { useEffect, useId } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletReadyState } from '@solana/wallet-adapter-base';

export interface SolanaWalletConnectProps {
  onConnected?: (address: string) => void;
}

const READY_STATES: Record<string, string> = {
  Installed: 'installed',
  Loadable: 'loadable',
  NotDetected: 'not detected',
  Unsupported: 'unsupported',
};

function truncate(base58: string): string {
  return `${base58.slice(0, 4)}…${base58.slice(-4)}`;
}

/**
 * Solana wallet connection UI. Lists every adapter passed into
 * `<SolanaWeb3SettleProvider wallets={…}>`, separating "installed" from the rest.
 */
export function SolanaWalletConnect({ onConnected }: SolanaWalletConnectProps) {
  const walletCtx = useWallet();
  const wallets = walletCtx.wallets;
  const connected = walletCtx.connected;
  const publicKey = walletCtx.publicKey;
  const wallet = walletCtx.wallet;
  const connecting = walletCtx.connecting;
  // Keep `select` / `connect` / `disconnect` bound to the context by calling
  // them through `walletCtx.*` at the site — avoids the unbound-method lint.
  const headingId = useId();

  useEffect(() => {
    if (connected && publicKey && onConnected) {
      onConnected(publicKey.toBase58());
    }
  }, [connected, publicKey, onConnected]);

  const readyWallets = wallets.filter(
    (w) => (w.readyState as WalletReadyState | string) === 'Installed' || (w.readyState as WalletReadyState | string) === 'Loadable',
  );
  const otherWallets = wallets.filter(
    (w) => !readyWallets.includes(w),
  );

  if (connected && publicKey) {
    return (
      <div className="w3s-flex w3s-flex-col w3s-gap-3">
        <div className="w3s-flex w3s-items-center w3s-justify-between w3s-rounded-xl w3s-border w3s-border-green-500/20 w3s-bg-green-500/5 w3s-p-3">
          <div className="w3s-flex w3s-items-center w3s-gap-3">
            <div
              aria-hidden="true"
              className="w3s-flex w3s-h-8 w3s-w-8 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-green-500/20"
            >
              <div className="w3s-h-2.5 w3s-w-2.5 w3s-rounded-full w3s-bg-green-400" />
            </div>
            <div className="w3s-flex w3s-flex-col">
              <span className="w3s-text-xs w3s-text-slate-400">
                Connected — {wallet?.adapter.name ?? 'Solana wallet'}
              </span>
              <span className="w3s-text-sm w3s-font-mono w3s-text-white">
                {truncate(publicKey.toBase58())}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void walletCtx.disconnect(); }}
            className="w3s-rounded-lg w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-px-3 w3s-py-1.5 w3s-text-xs w3s-text-slate-300 hover:w3s-bg-white/10 w3s-transition-colors w3s-cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="w3s-flex w3s-flex-col w3s-gap-3"
    >
      <div id={headingId} className="w3s-text-sm w3s-font-medium w3s-text-slate-300">
        Connect Solana Wallet
      </div>
      <div className="w3s-flex w3s-flex-col w3s-gap-2">
        {[...readyWallets, ...otherWallets].map((w) => {
          const ready = readyWallets.includes(w);
          return (
            <button
              key={w.adapter.name}
              type="button"
              onClick={() => {
                walletCtx.select(w.adapter.name);
                // Give select() a tick to propagate before connect()
                setTimeout(() => { void walletCtx.connect().catch(() => undefined); }, 0);
              }}
              disabled={!ready || connecting}
              className="w3s-flex w3s-items-center w3s-gap-3 w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-p-3 w3s-transition-all hover:w3s-border-white/20 hover:w3s-bg-white/10 w3s-cursor-pointer disabled:w3s-cursor-not-allowed disabled:w3s-opacity-40"
            >
              {w.adapter.icon ? (
                <img
                  src={w.adapter.icon}
                  alt=""
                  aria-hidden="true"
                  className="w3s-h-7 w3s-w-7 w3s-rounded-lg"
                />
              ) : (
                <div aria-hidden="true" className="w3s-h-7 w3s-w-7 w3s-rounded-lg w3s-bg-indigo-500/20" />
              )}
              <div className="w3s-flex w3s-flex-col w3s-items-start">
                <span className="w3s-text-sm w3s-font-medium w3s-text-white">
                  {w.adapter.name}
                </span>
                <span className="w3s-text-xs w3s-text-slate-400">
                  {ready ? (connecting ? 'Connecting…' : 'Ready') : READY_STATES[w.readyState] ?? 'unavailable'}
                </span>
              </div>
            </button>
          );
        })}
        {wallets.length === 0 && (
          <p className="w3s-text-xs w3s-text-slate-400">
            No Solana wallet adapters registered. Pass them via
            {' '}<code className="w3s-font-mono">wallets=&#123;…&#125;</code>
            {' '}on <code className="w3s-font-mono">SolanaWeb3SettleProvider</code>.
          </p>
        )}
      </div>
    </div>
  );
}
