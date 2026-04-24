import { useEffect, useId } from 'react';
import { useTronWeb3SettleContext } from './TronProvider';

export interface TronWalletConnectProps {
  onConnected?: (address: string) => void;
}

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * TRON wallet connection UI. Detects TronLink and exposes a single "Connect"
 * button + account indicator. Falls back to an install-TronLink message when
 * the extension isn't present.
 */
export function TronWalletConnect({ onConnected }: TronWalletConnectProps) {
  const { wallet, connect, disconnect } = useTronWeb3SettleContext();
  const headingId = useId();

  useEffect(() => {
    if (wallet.connected && wallet.address && onConnected) {
      onConnected(wallet.address);
    }
  }, [wallet.connected, wallet.address, onConnected]);

  const isTronLinkInstalled =
    typeof window !== 'undefined' &&
    (typeof window.tronLink !== 'undefined' || typeof window.tronWeb !== 'undefined');

  if (wallet.connected && wallet.address) {
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
              <span className="w3s-text-xs w3s-text-slate-400">Connected — TronLink</span>
              <span className="w3s-text-sm w3s-font-mono w3s-text-white">
                {truncate(wallet.address)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={disconnect}
            className="w3s-rounded-lg w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-px-3 w3s-py-1.5 w3s-text-xs w3s-text-slate-300 hover:w3s-bg-white/10 w3s-cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={headingId} className="w3s-flex w3s-flex-col w3s-gap-3">
      <div id={headingId} className="w3s-text-sm w3s-font-medium w3s-text-slate-300">
        Connect TRON Wallet
      </div>

      {!isTronLinkInstalled ? (
        <div className="w3s-rounded-xl w3s-border w3s-border-amber-500/30 w3s-bg-amber-500/5 w3s-p-4 w3s-text-sm w3s-text-amber-200">
          TronLink is not installed.{' '}
          <a
            href="https://www.tronlink.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="w3s-underline"
          >
            Install it
          </a>
          {' '}and reload this page.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { void connect(); }}
          disabled={wallet.connecting}
          className="w3s-flex w3s-items-center w3s-gap-3 w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-p-3 hover:w3s-border-white/20 hover:w3s-bg-white/10 w3s-cursor-pointer disabled:w3s-opacity-40 disabled:w3s-cursor-not-allowed"
        >
          <div
            aria-hidden="true"
            className="w3s-flex w3s-h-7 w3s-w-7 w3s-items-center w3s-justify-center w3s-rounded-lg w3s-bg-red-500/20 w3s-text-red-400 w3s-font-bold"
          >
            T
          </div>
          <div className="w3s-flex w3s-flex-col w3s-items-start">
            <span className="w3s-text-sm w3s-font-medium w3s-text-white">TronLink</span>
            {wallet.connecting && (
              <span className="w3s-text-xs w3s-text-slate-400">Connecting…</span>
            )}
          </div>
        </button>
      )}

      {wallet.error && (
        <p role="alert" className="w3s-text-xs w3s-text-red-400">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
