import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// useQuote: what the modal is allowed to show (and pay with) between quote fetches.

vi.mock('../components/Web3SettleProvider', () => ({
  useWeb3SettleContext: () => ({
    config: { apiBaseUrl: 'https://api.example.test', storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd' },
  }),
}));

const fetchQuote = vi.fn();
vi.mock('../core/api-client', () => ({
  Web3SettleApiClient: class {
    fetchQuote = fetchQuote;
  },
}));

const { useQuote } = await import('../hooks/useQuote');

function quoteFor(amountUsd: number, amountToken: string) {
  return {
    storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd',
    network: 'Base',
    token: 'native',
    tokenSymbol: 'ETH',
    tokenDecimals: 18,
    amountUsd,
    amountToken,
    amountTokenDisplay: Number(amountToken) / 1e18,
    priceUsd: 2500,
    source: 'chainlink',
    feedAddress: '0xfeed',
    roundId: '1',
    observedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useQuote', () => {
  it('is loading until the quote lands, then exposes it', async () => {
    fetchQuote.mockResolvedValue(quoteFor(10, '4000000000000000'));
    const { result } = renderHook(() => useQuote('Base', 'native', 10, { refreshIntervalMs: 0 }));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.quote).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.quote?.amountToken).toBe('4000000000000000');
    expect(result.current.error).toBeNull();
  });

  it('keeps the previous quote visible (but loading) while re-quoting for a new amount', async () => {
    fetchQuote.mockResolvedValueOnce(quoteFor(10, '4000000000000000'));
    const { result, rerender } = renderHook(
      ({ amount }: { amount: number }) => useQuote('Base', 'native', amount, { refreshIntervalMs: 0 }),
      { initialProps: { amount: 10 } },
    );
    await waitFor(() => expect(result.current.quote).not.toBeNull());

    let resolveSecond!: (q: unknown) => void;
    fetchQuote.mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));
    rerender({ amount: 20 });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.quote?.amountToken).toBe('4000000000000000');

    await act(async () => {
      resolveSecond(quoteFor(20, '8000000000000000'));
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.quote?.amountToken).toBe('8000000000000000');
  });

  it('clears quote and error as soon as the inputs stop being ready', async () => {
    fetchQuote.mockResolvedValue(quoteFor(10, '4000000000000000'));
    const initialProps: { amount: number | null } = { amount: 10 };
    const { result, rerender } = renderHook(
      ({ amount }: { amount: number | null }) => useQuote('Base', 'native', amount, { refreshIntervalMs: 0 }),
      { initialProps },
    );
    await waitFor(() => expect(result.current.quote).not.toBeNull());

    rerender({ amount: null });
    expect(result.current.quote).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed quote as an error with no quote, and drops the error on refresh()', async () => {
    fetchQuote.mockRejectedValueOnce(new Error('feed stale'));
    const { result } = renderHook(() => useQuote('Base', 'native', 10, { refreshIntervalMs: 0 }));
    await waitFor(() => expect(result.current.error).toBe('feed stale'));
    expect(result.current.quote).toBeNull();
    expect(result.current.isLoading).toBe(false);

    fetchQuote.mockResolvedValueOnce(quoteFor(10, '4000000000000000'));
    act(() => { result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.quote).not.toBeNull());
  });
});
