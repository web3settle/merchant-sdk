import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getNativeTokenPrice,
  getTokenPrice,
  usdToNativeAmount,
  usdToTokenAmount,
  clearPriceCache,
} from '../core/price-feed';

describe('price-feed', () => {
  beforeEach(() => {
    clearPriceCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getNativeTokenPrice', () => {
    it('fetches ETH price from CoinGecko', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ethereum: { usd: 3200 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const price = await getNativeTokenPrice(1);

      expect(price).toBe(3200);
    });

    it('fetches POL price for Polygon', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ 'matic-network': { usd: 0.45 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const price = await getNativeTokenPrice(137);

      expect(price).toBe(0.45);
    });

    it('returns cached price on second call within TTL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ethereum: { usd: 3200 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await getNativeTokenPrice(1);
      await getNativeTokenPrice(1);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('uses fallback price when CoinGecko fails and no cache', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const price = await getNativeTokenPrice(1);

      expect(price).toBe(3500); // fallback for ethereum
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('uses stale cache over fallback when CoinGecko fails', async () => {
      // First call succeeds and caches
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ethereum: { usd: 2900 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await getNativeTokenPrice(1);

      // Clear and mark cache as stale by manipulating internals
      // For this test we rely on the TTL check in the code
      // We need to wait past TTL or manipulate time, so we use vi.useFakeTimers
      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000); // Past 60s TTL

      // Second call fails
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const price = await getNativeTokenPrice(1);

      // Should return stale cached value (2900) rather than fallback (3500)
      expect(price).toBe(2900);

      vi.useRealTimers();
    });

    it('throws for unknown chain IDs without fallback', async () => {
      await expect(getNativeTokenPrice(999)).rejects.toThrow('No CoinGecko mapping');
    });

    it('throws when CoinGecko returns invalid data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ethereum: { usd: -1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Should fall back to static price since response is invalid
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const price = await getNativeTokenPrice(1);
      expect(price).toBe(3500);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('getTokenPrice', () => {
    it('returns 1.0 for USDC', () => {
      expect(getTokenPrice('USDC')).toBe(1.0);
    });

    it('returns 1.0 for USDT', () => {
      expect(getTokenPrice('USDT')).toBe(1.0);
    });

    it('returns 1.0 for DAI', () => {
      expect(getTokenPrice('DAI')).toBe(1.0);
    });

    it('is case-insensitive', () => {
      expect(getTokenPrice('usdc')).toBe(1.0);
    });

    it('throws for unknown tokens', () => {
      expect(() => getTokenPrice('UNKNOWN')).toThrow('No price feed');
    });
  });

  describe('usdToNativeAmount', () => {
    it('converts USD to ETH amount', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ethereum: { usd: 4000 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const amount = await usdToNativeAmount(100, 1);

      expect(amount).toBeCloseTo(0.025);
    });
  });

  describe('usdToTokenAmount', () => {
    it('converts USD to USDC amount at 1:1', () => {
      const amount = usdToTokenAmount(100, 'USDC');

      expect(amount).toBe(100);
    });

    it('throws for unsupported tokens', () => {
      expect(() => usdToTokenAmount(100, 'UNKNOWN')).toThrow();
    });
  });

  describe('clearPriceCache', () => {
    it('forces re-fetch after clearing', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ ethereum: { usd: 3000 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      );

      await getNativeTokenPrice(1);
      clearPriceCache();
      await getNativeTokenPrice(1);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
