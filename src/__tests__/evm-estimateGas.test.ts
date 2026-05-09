import { describe, it, expect, vi } from 'vitest';
import type { PublicClient } from 'viem';
import {
  estimateEvmGas,
  estimateEvmApproveGas,
} from '../evm/estimateGas';
import { NATIVE_TOKEN_SENTINEL } from '../core/types';

/**
 * The estimator only needs `estimateGas` and `getGasPrice` from the public
 * client. We hand-roll a minimal mock to keep the test fast and isolated from
 * any RPC.
 */
function mockPublicClient(opts: { gas: bigint; gasPrice: bigint }) {
  const estimateGas = vi.fn().mockResolvedValue(opts.gas);
  const getGasPrice = vi.fn().mockResolvedValue(opts.gasPrice);
  return {
    client: { estimateGas, getGasPrice } as unknown as PublicClient,
    estimateGas,
    getGasPrice,
  };
}

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const CONTRACT = '0x2222222222222222222222222222222222222222' as const;
const TOKEN = '0x3333333333333333333333333333333333333333' as const;

describe('estimateEvmGas', () => {
  it('multiplies gas units by gas price for a native pay-in', async () => {
    const { client } = mockPublicClient({ gas: 50_000n, gasPrice: 25_000_000_000n }); // 25 gwei
    const out = await estimateEvmGas({
      publicClient: client,
      account: ACCOUNT,
      contractAddress: CONTRACT,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1_000_000_000_000_000_000n,
    });
    // 50k gas * 25 gwei = 0.00125 ETH = 1.25e15 wei. Safety multiplier 1.2 → 1.5e15 wei.
    // gas units: ceil(50000 * 1.2) = 60000. 60000 * 25e9 = 1.5e15.
    expect((out.breakdown as { gasUnits: bigint }).gasUnits).toBe(60_000n);
    expect(out.native).toBe(60_000n * 25_000_000_000n);
    expect(out.usd).toBeNull();
  });

  it('estimates a token pay-in with `payInToken(token, amount)` calldata', async () => {
    const { client, estimateGas } = mockPublicClient({ gas: 80_000n, gasPrice: 10_000_000_000n });
    const out = await estimateEvmGas({
      publicClient: client,
      account: ACCOUNT,
      contractAddress: CONTRACT,
      token: TOKEN,
      amount: 100_000_000n,
    });
    expect(out.breakdown).toMatchObject({ family: 'evm', flow: 'token' });
    expect(estimateGas).toHaveBeenCalledOnce();
    const args = estimateGas.mock.calls[0][0] as { value?: bigint; data: string };
    // Native value should be omitted/zero for an ERC-20 pay-in.
    expect(args.value === undefined || args.value === 0n).toBe(true);
    // payInToken selector = 0x0dff7042 (first 4 bytes of keccak256("payInToken(address,uint256)"))
    expect(args.data.slice(0, 10)).toBe('0x0dff7042');
  });

  it('converts to USD when priceUsd is supplied', async () => {
    const { client } = mockPublicClient({ gas: 21_000n, gasPrice: 20_000_000_000n }); // 21k * 20 gwei = 4.2e14 wei = 0.00042 ETH
    const out = await estimateEvmGas(
      {
        publicClient: client,
        account: ACCOUNT,
        contractAddress: CONTRACT,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 0n,
      },
      { priceUsd: 4000, safetyMultiplier: 1.0 },
    );
    expect(out.native).toBe(21_000n * 20_000_000_000n);
    // 0.00042 ETH * $4000 = $1.68
    expect(out.usd).toBeCloseTo(1.68, 2);
  });

  it('uses fetchPriceUsd when priceUsd is omitted', async () => {
    const { client } = mockPublicClient({ gas: 21_000n, gasPrice: 20_000_000_000n });
    const fetchPriceUsd = vi.fn().mockResolvedValue(4000);
    const out = await estimateEvmGas(
      {
        publicClient: client,
        account: ACCOUNT,
        contractAddress: CONTRACT,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 0n,
      },
      { fetchPriceUsd, safetyMultiplier: 1.0 },
    );
    expect(fetchPriceUsd).toHaveBeenCalledOnce();
    expect(out.usd).toBeCloseTo(1.68, 2);
  });

  it('returns usd=null when fetchPriceUsd throws', async () => {
    const { client } = mockPublicClient({ gas: 21_000n, gasPrice: 20_000_000_000n });
    const out = await estimateEvmGas(
      {
        publicClient: client,
        account: ACCOUNT,
        contractAddress: CONTRACT,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 0n,
      },
      { fetchPriceUsd: () => Promise.reject(new Error('price feed down')) },
    );
    expect(out.usd).toBeNull();
    expect(out.native).toBeGreaterThan(0n);
  });

  it('returns usd=null for a non-positive priceUsd', async () => {
    const { client } = mockPublicClient({ gas: 21_000n, gasPrice: 20_000_000_000n });
    const out = await estimateEvmGas(
      {
        publicClient: client,
        account: ACCOUNT,
        contractAddress: CONTRACT,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 0n,
      },
      { priceUsd: 0 },
    );
    expect(out.usd).toBeNull();
  });

  it('respects safetyMultiplier=1.0 (no padding)', async () => {
    const { client } = mockPublicClient({ gas: 50_000n, gasPrice: 1_000_000_000n });
    const out = await estimateEvmGas(
      {
        publicClient: client,
        account: ACCOUNT,
        contractAddress: CONTRACT,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 0n,
      },
      { safetyMultiplier: 1.0 },
    );
    expect((out.breakdown as { gasUnits: bigint }).gasUnits).toBe(50_000n);
  });
});

describe('estimateEvmApproveGas', () => {
  it('encodes calldata for ERC-20 approve and returns native + usd', async () => {
    const { client, estimateGas } = mockPublicClient({ gas: 46_000n, gasPrice: 30_000_000_000n });
    const out = await estimateEvmApproveGas(
      {
        publicClient: client,
        account: ACCOUNT,
        tokenAddress: TOKEN,
        spenderAddress: CONTRACT,
        amount: 1_000_000n,
      },
      { priceUsd: 3500, safetyMultiplier: 1.0 },
    );
    const callArgs = estimateGas.mock.calls[0][0] as { data: string; to: string };
    // approve selector = 0x095ea7b3
    expect(callArgs.data.slice(0, 10)).toBe('0x095ea7b3');
    expect(callArgs.to).toBe(TOKEN);
    expect(out.native).toBe(46_000n * 30_000_000_000n);
    expect(typeof out.usd).toBe('number');
  });
});
