import { COINGECKO_CHAIN_IDS, PRICE_CACHE_TTL_MS } from './config';

interface PriceEntry {
  usd: number;
  fetchedAt: number;
}

const priceCache = new Map<string, PriceEntry>();

/**
 * Static fallback prices used when CoinGecko is unreachable.
 * These are approximate and should only be used as a last resort.
 */
const FALLBACK_PRICES: Record<string, number> = {
  ethereum: 3500,
  'matic-network': 0.50,
};

/**
 * Fetch the current USD price for a native currency by CoinGecko ID.
 * Results are cached for 60 seconds.
 */
export async function getNativeTokenPrice(
  chainId: number,
  signal?: AbortSignal,
): Promise<number> {
  const coingeckoId = COINGECKO_CHAIN_IDS[chainId];
  if (!coingeckoId) {
    throw new Error(`No CoinGecko mapping for chain ${chainId}`);
  }

  const cached = priceCache.get(coingeckoId);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.usd;
  }

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
      {
        headers: { Accept: 'application/json' },
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status}`);
    }

    const data = await response.json();
    const price = data?.[coingeckoId]?.usd;

    if (typeof price !== 'number' || price <= 0) {
      throw new Error('Invalid price data from CoinGecko');
    }

    priceCache.set(coingeckoId, { usd: price, fetchedAt: Date.now() });
    return price;
  } catch (err) {
    // If we have a stale cached value, prefer it over fallback
    if (cached) {
      return cached.usd;
    }

    const fallback = FALLBACK_PRICES[coingeckoId];
    if (fallback !== undefined) {
      console.warn(
        `[Web3Settle] Using fallback price for ${coingeckoId}: $${fallback}`,
        err instanceof Error ? err.message : err,
      );
      return fallback;
    }

    throw new Error(
      `Failed to fetch price for chain ${chainId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

/**
 * Stablecoin tokens always return $1.00.
 * For other ERC-20 tokens, extend this function with additional price feeds.
 */
export function getTokenPrice(symbol: string): number {
  const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD'];
  if (stablecoins.includes(symbol.toUpperCase())) {
    return 1.0;
  }
  throw new Error(`No price feed available for token: ${symbol}`);
}

/**
 * Convert a USD amount to native token amount.
 */
export async function usdToNativeAmount(
  usdAmount: number,
  chainId: number,
  signal?: AbortSignal,
): Promise<number> {
  const price = await getNativeTokenPrice(chainId, signal);
  return usdAmount / price;
}

/**
 * Convert a USD amount to token amount (handles stablecoins at 1:1).
 */
export function usdToTokenAmount(usdAmount: number, tokenSymbol: string): number {
  const tokenPrice = getTokenPrice(tokenSymbol);
  return usdAmount / tokenPrice;
}

/**
 * Clear the entire price cache. Useful for testing.
 */
export function clearPriceCache(): void {
  priceCache.clear();
}
