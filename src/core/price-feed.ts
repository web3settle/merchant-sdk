import { COINGECKO_CHAIN_IDS, PRICE_CACHE_TTL_MS } from './config';

interface PriceEntry {
  usd: number;
  fetchedAt: number;
}

const priceCache = new Map<string, PriceEntry>();

const FALLBACK_PRICES: Record<string, number> = {
  ethereum: 3500,
  'matic-network': 0.5,
};

const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'BUSD']);

function parseCoinGeckoPrice(body: unknown, coingeckoId: string): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const entry = (body as Record<string, unknown>)[coingeckoId];
  if (typeof entry !== 'object' || entry === null) return null;
  const price = (entry as Record<string, unknown>).usd;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return price;
}

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
    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', coingeckoId);
    url.searchParams.set('vs_currencies', 'usd');

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const price = parseCoinGeckoPrice(body, coingeckoId);
    if (price === null) {
      throw new Error('Invalid price data from CoinGecko');
    }

    priceCache.set(coingeckoId, { usd: price, fetchedAt: Date.now() });
    return price;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    if (cached) {
      return cached.usd;
    }

    const fallback = FALLBACK_PRICES[coingeckoId];
    if (fallback !== undefined) {
      console.warn(
        `[Web3Settle] Using fallback price for ${coingeckoId}: $${fallback}`,
        err instanceof Error ? err.message : String(err),
      );
      return fallback;
    }

    throw new Error(
      `Failed to fetch price for chain ${chainId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

export function getTokenPrice(symbol: string): number {
  if (STABLECOIN_SYMBOLS.has(symbol.toUpperCase())) {
    return 1.0;
  }
  throw new Error(`No price feed available for token: ${symbol}`);
}

export async function usdToNativeAmount(
  usdAmount: number,
  chainId: number,
  signal?: AbortSignal,
): Promise<number> {
  const price = await getNativeTokenPrice(chainId, signal);
  return usdAmount / price;
}

export function usdToTokenAmount(usdAmount: number, tokenSymbol: string): number {
  const tokenPrice = getTokenPrice(tokenSymbol);
  return usdAmount / tokenPrice;
}

export function clearPriceCache(): void {
  priceCache.clear();
}
