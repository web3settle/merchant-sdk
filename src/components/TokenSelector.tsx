import React, { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import type { TokenSelectorProps } from '../core/types';
import { getTokenBalance } from '../core/contract';
import { getTokenPrice } from '../core/price-feed';

interface TokenWithBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: string | null;
  usdValue: string | null;
  isNative: boolean;
  iconUrl?: string;
}

export function TokenSelector({
  tokens,
  nativeCurrency,
  selectedToken,
  onSelect,
  walletAddress,
  chainId,
}: TokenSelectorProps) {
  const publicClient = usePublicClient({ chainId });
  const [tokenBalances, setTokenBalances] = useState<TokenWithBalance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchBalances() {
      const items: TokenWithBalance[] = [];

      // Add native currency option
      if (nativeCurrency) {
        items.push({
          address: 'native',
          symbol: nativeCurrency.symbol,
          decimals: nativeCurrency.decimals,
          balance: null,
          usdValue: null,
          isNative: true,
        });
      }

      // Add ERC-20 tokens
      for (const token of tokens) {
        items.push({
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: null,
          usdValue: null,
          isNative: false,
          iconUrl: token.iconUrl,
        });
      }

      if (!walletAddress || !publicClient) {
        if (!cancelled) setTokenBalances(items);
        return;
      }

      setLoading(true);

      // Fetch native balance
      if (nativeCurrency) {
        try {
          const nativeBal = await publicClient.getBalance({
            address: walletAddress as `0x${string}`,
          });
          const formatted = formatUnits(nativeBal, nativeCurrency.decimals);
          const nativeItem = items.find((i) => i.isNative);
          if (nativeItem) {
            nativeItem.balance = Number(formatted).toFixed(6);
          }
        } catch {
          // Balance fetch failed — show without balance
        }
      }

      // Fetch ERC-20 balances in parallel
      const balancePromises = tokens.map(async (token) => {
        try {
          const bal = await getTokenBalance(
            publicClient,
            token.address as `0x${string}`,
            walletAddress as `0x${string}`,
          );
          const formatted = formatUnits(bal, token.decimals);
          const item = items.find((i) => i.address === token.address);
          if (item) {
            item.balance = Number(formatted).toFixed(token.decimals <= 6 ? 2 : 6);
            try {
              const price = getTokenPrice(token.symbol);
              item.usdValue = (Number(formatted) * price).toFixed(2);
            } catch {
              // No price feed for this token
            }
          }
        } catch {
          // Balance fetch failed — show without balance
        }
      });

      await Promise.allSettled(balancePromises);

      if (!cancelled) {
        setTokenBalances(items);
        setLoading(false);
      }
    }

    fetchBalances();
    return () => {
      cancelled = true;
    };
  }, [tokens, nativeCurrency, walletAddress, publicClient, chainId]);

  return (
    <div className="w3s-flex w3s-flex-col w3s-gap-2">
      <label className="w3s-text-sm w3s-font-medium w3s-text-slate-300">
        Select Token
      </label>
      <div className="w3s-flex w3s-flex-col w3s-gap-2">
        {tokenBalances.map((token) => {
          const isSelected = selectedToken === token.address;
          return (
            <button
              key={token.address}
              type="button"
              onClick={() => onSelect(token.address as 'native' | `0x${string}`)}
              className={`
                w3s-flex w3s-items-center w3s-justify-between
                w3s-rounded-xl w3s-border w3s-p-3
                w3s-transition-all w3s-duration-200 w3s-cursor-pointer
                ${
                  isSelected
                    ? 'w3s-border-indigo-500 w3s-bg-indigo-500/10'
                    : 'w3s-border-white/10 w3s-bg-white/5 hover:w3s-border-white/20 hover:w3s-bg-white/10'
                }
              `}
            >
              <div className="w3s-flex w3s-items-center w3s-gap-3">
                {token.iconUrl ? (
                  <img
                    src={token.iconUrl}
                    alt={token.symbol}
                    className="w3s-h-7 w3s-w-7 w3s-rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    className="
                      w3s-flex w3s-h-7 w3s-w-7 w3s-items-center w3s-justify-center
                      w3s-rounded-full w3s-bg-indigo-500/20 w3s-text-xs w3s-font-bold
                      w3s-text-indigo-300
                    "
                  >
                    {token.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="w3s-flex w3s-flex-col w3s-items-start">
                  <span className="w3s-text-sm w3s-font-semibold w3s-text-white">
                    {token.symbol}
                  </span>
                  {token.isNative && (
                    <span className="w3s-text-xs w3s-text-slate-400">Native</span>
                  )}
                </div>
              </div>

              <div className="w3s-flex w3s-flex-col w3s-items-end">
                {loading ? (
                  <div className="w3s-h-4 w3s-w-16 w3s-animate-pulse w3s-rounded w3s-bg-white/10" />
                ) : token.balance !== null ? (
                  <>
                    <span className="w3s-text-sm w3s-text-white">{token.balance}</span>
                    {token.usdValue && (
                      <span className="w3s-text-xs w3s-text-slate-400">
                        ${token.usdValue}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="w3s-text-xs w3s-text-slate-500">--</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
