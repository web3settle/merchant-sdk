import React from 'react';
import type { ChainSelectorProps } from '../core/types';
import { CHAIN_ICONS } from '../core/config';

export function ChainSelector({ chains, selectedChainId, onSelect }: ChainSelectorProps) {
  return (
    <div className="w3s-flex w3s-flex-col w3s-gap-2">
      <label className="w3s-text-sm w3s-font-medium w3s-text-slate-300">
        Select Network
      </label>
      <div className="w3s-grid w3s-grid-cols-1 w3s-gap-2 sm:w3s-grid-cols-3">
        {chains.map((chain) => {
          const isSelected = chain.chainId === selectedChainId;
          const iconUrl = chain.iconUrl ?? CHAIN_ICONS[chain.chainId];

          return (
            <button
              key={chain.chainId}
              type="button"
              onClick={() => onSelect(chain.chainId)}
              className={`
                w3s-group w3s-relative w3s-flex w3s-items-center w3s-gap-3
                w3s-rounded-xl w3s-border w3s-p-3
                w3s-transition-all w3s-duration-200 w3s-cursor-pointer
                ${
                  isSelected
                    ? 'w3s-border-indigo-500 w3s-bg-indigo-500/10 w3s-shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                    : 'w3s-border-white/10 w3s-bg-white/5 hover:w3s-border-white/20 hover:w3s-bg-white/10'
                }
              `}
              title={`${chain.name} - ${chain.tokens.length} token${chain.tokens.length !== 1 ? 's' : ''} supported`}
            >
              {iconUrl && (
                <img
                  src={iconUrl}
                  alt={chain.name}
                  className="w3s-h-8 w3s-w-8 w3s-rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="w3s-flex w3s-flex-col w3s-items-start">
                <span className="w3s-text-sm w3s-font-semibold w3s-text-white">
                  {chain.name}
                </span>
                <span className="w3s-text-xs w3s-text-slate-400">
                  {chain.tokens.length} token{chain.tokens.length !== 1 ? 's' : ''}
                  {chain.nativeCurrency ? ` + ${chain.nativeCurrency.symbol}` : ''}
                </span>
              </div>
              {isSelected && (
                <div className="w3s-absolute w3s-right-2 w3s-top-2">
                  <svg
                    className="w3s-h-4 w3s-w-4 w3s-text-indigo-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              )}

              {/* Tooltip on hover */}
              <div
                className="
                  w3s-pointer-events-none w3s-absolute w3s-bottom-full w3s-left-1/2
                  w3s--translate-x-1/2 w3s-mb-2 w3s-rounded-lg w3s-bg-slate-800
                  w3s-px-3 w3s-py-2 w3s-text-xs w3s-text-slate-300
                  w3s-opacity-0 w3s-transition-opacity
                  group-hover:w3s-opacity-100 w3s-whitespace-nowrap
                  w3s-shadow-lg w3s-border w3s-border-white/10
                  w3s-z-10
                "
              >
                <div className="w3s-font-medium w3s-text-white w3s-mb-1">{chain.name}</div>
                <div>
                  Tokens:{' '}
                  {chain.tokens.map((t) => t.symbol).join(', ')}
                  {chain.nativeCurrency ? `, ${chain.nativeCurrency.symbol} (native)` : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
