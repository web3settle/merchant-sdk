import React from 'react';
import { useConnect, useAccount, useDisconnect } from 'wagmi';
import type { WalletConnectProps } from '../core/types';

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <circle cx="17" cy="14" r="1.5" fill="currentColor" />
    </svg>
  );
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnect({ onConnected }: WalletConnectProps) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connectors, connect, isPending, error } = useConnect();

  React.useEffect(() => {
    if (isConnected && address && onConnected) {
      onConnected(address);
    }
  }, [isConnected, address, onConnected]);

  if (isConnected && address) {
    return (
      <div className="w3s-flex w3s-flex-col w3s-gap-3">
        <div
          className="
            w3s-flex w3s-items-center w3s-justify-between
            w3s-rounded-xl w3s-border w3s-border-green-500/20
            w3s-bg-green-500/5 w3s-p-3
          "
        >
          <div className="w3s-flex w3s-items-center w3s-gap-3">
            <div className="w3s-flex w3s-h-8 w3s-w-8 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-green-500/20">
              <div className="w3s-h-2.5 w3s-w-2.5 w3s-rounded-full w3s-bg-green-400" />
            </div>
            <div className="w3s-flex w3s-flex-col">
              <span className="w3s-text-xs w3s-text-slate-400">Connected</span>
              <span className="w3s-text-sm w3s-font-mono w3s-text-white">
                {truncateAddress(address)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => disconnect()}
            className="
              w3s-rounded-lg w3s-border w3s-border-white/10 w3s-bg-white/5
              w3s-px-3 w3s-py-1.5 w3s-text-xs w3s-text-slate-300
              hover:w3s-bg-white/10 w3s-transition-colors w3s-cursor-pointer
            "
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w3s-flex w3s-flex-col w3s-gap-3">
      <label className="w3s-text-sm w3s-font-medium w3s-text-slate-300">
        Connect Wallet
      </label>
      <div className="w3s-flex w3s-flex-col w3s-gap-2">
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            type="button"
            onClick={() => connect({ connector })}
            disabled={isPending}
            className="
              w3s-flex w3s-items-center w3s-gap-3
              w3s-rounded-xl w3s-border w3s-border-white/10
              w3s-bg-white/5 w3s-p-3
              w3s-transition-all w3s-duration-200 w3s-cursor-pointer
              hover:w3s-border-white/20 hover:w3s-bg-white/10
              disabled:w3s-cursor-not-allowed disabled:w3s-opacity-50
            "
          >
            {connector.icon ? (
              <img
                src={connector.icon}
                alt={connector.name}
                className="w3s-h-7 w3s-w-7 w3s-rounded-lg"
              />
            ) : (
              <WalletIcon className="w3s-h-7 w3s-w-7 w3s-text-indigo-400" />
            )}
            <div className="w3s-flex w3s-flex-col w3s-items-start">
              <span className="w3s-text-sm w3s-font-medium w3s-text-white">
                {connector.name}
              </span>
              {isPending && (
                <span className="w3s-text-xs w3s-text-slate-400">
                  Connecting...
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <p className="w3s-text-xs w3s-text-red-400 w3s-mt-1">
          {error.message.includes('rejected')
            ? 'Connection rejected by user'
            : error.message}
        </p>
      )}
    </div>
  );
}
