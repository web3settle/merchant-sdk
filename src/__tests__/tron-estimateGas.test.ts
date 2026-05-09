import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  estimateTronGas,
  computeTronCost,
  DEFAULT_SUN_PER_ENERGY,
} from '../tron/estimateGas';
import { NATIVE_TOKEN_SENTINEL } from '../core/types';
import type { TronWebLike } from '../tron/tronweb-global';

const VALID_T_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const VALID_USDT_ADDR = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

interface MockTronInit {
  energyUsed?: number;
  rawDataHex?: string;
  triggerError?: string;
}

function mockTronWeb(opts: MockTronInit): TronWebLike {
  const triggerConstantContract = vi.fn().mockImplementation(() => {
    if (opts.triggerError) return Promise.reject(new Error(opts.triggerError));
    return Promise.resolve({
      energy_used: opts.energyUsed,
      transaction: { raw_data_hex: opts.rawDataHex },
      result: { result: true },
    });
  });
  return {
    defaultAddress: { base58: VALID_T_ADDR, hex: '0x41' + '00'.repeat(20) },
    ready: true,
    contract: () => ({ at: vi.fn().mockResolvedValue({}) }),
    trx: { getConfirmedTransaction: vi.fn() },
    toSun: vi.fn(),
    address: { toHex: vi.fn(), fromHex: vi.fn() },
    transactionBuilder: { triggerConstantContract },
  } as unknown as TronWebLike;
}

afterEach(() => {
  delete (globalThis as unknown as { window: unknown }).window;
});

describe('estimateTronGas', () => {
  it('returns sun cost = energy*sunPerEnergy + bandwidth for native pay-in', async () => {
    const tw = mockTronWeb({
      energyUsed: 30_000,
      rawDataHex: '00'.repeat(270), // 270 byte placeholder tx
    });
    const out = await estimateTronGas(
      {
        contractAddress: VALID_T_ADDR,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 1_000_000n,
        tronWebOverride: tw,
      },
      { sunPerEnergy: 280 } as never, // sunPerEnergy lives on input — passing here is a typecheck noop
    );
    // We pass sunPerEnergy via the input, not the fee oracle. Re-run with input:
    const out2 = await estimateTronGas({
      contractAddress: VALID_T_ADDR,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1_000_000n,
      sunPerEnergy: 280,
      tronWebOverride: tw,
    });
    // 30k energy * 280 sun/energy = 8.4e6 sun, + 270 bandwidth = 8_400_270.
    expect(out2.native).toBe(8_400_270);
    expect((out2.breakdown as { energy: number; bandwidth: number }).energy).toBe(30_000);
    expect((out2.breakdown as { bandwidth: number }).bandwidth).toBe(270);
    // First call (without sunPerEnergy override) should use the default rate.
    expect(out.native).toBe(30_000 * DEFAULT_SUN_PER_ENERGY + 270);
  });

  it('rejects an invalid (non-T) contract address before hitting tronWeb', async () => {
    const tw = mockTronWeb({ energyUsed: 1 });
    await expect(estimateTronGas({
      contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
      tronWebOverride: tw,
    })).rejects.toThrow(/Invalid TRON/);
  });

  it('rejects when tronWeb is not present', async () => {
    await expect(estimateTronGas({
      contractAddress: VALID_T_ADDR,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
    })).rejects.toThrow(/not available/);
  });

  it('builds payInToken(address,uint256) for an ERC-20 pay-in', async () => {
    const tw = mockTronWeb({ energyUsed: 60_000, rawDataHex: '00'.repeat(280) });
    await estimateTronGas({
      contractAddress: VALID_T_ADDR,
      token: VALID_USDT_ADDR,
      amount: 1_000_000n,
      tronWebOverride: tw,
    });
    const builder = (tw as unknown as { transactionBuilder: { triggerConstantContract: ReturnType<typeof vi.fn> } }).transactionBuilder;
    const args = builder.triggerConstantContract.mock.calls[0];
    expect(args[1]).toBe('payInToken(address,uint256)');
    // Two parameters
    expect(args[3]).toEqual([
      { type: 'address', value: VALID_USDT_ADDR },
      { type: 'uint256', value: '1000000' },
    ]);
  });

  it('converts sun to USD when a TRX price is provided', async () => {
    const tw = mockTronWeb({ energyUsed: 30_000, rawDataHex: '00'.repeat(270) });
    const out = await estimateTronGas(
      {
        contractAddress: VALID_T_ADDR,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 1n,
        sunPerEnergy: 280,
        tronWebOverride: tw,
      },
      { priceUsd: 0.13 },
    );
    // 8400270 sun = 8.40027 TRX → 8.40027 * $0.13 = $1.092
    expect(out.usd).toBeCloseTo(1.092, 2);
  });

  it('surfaces a triggerConstantContract error as a thrown Error', async () => {
    const tw = mockTronWeb({ triggerError: 'rpc denied' });
    await expect(estimateTronGas({
      contractAddress: VALID_T_ADDR,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
      tronWebOverride: tw,
    })).rejects.toThrow(/rpc denied/);
  });
});

describe('computeTronCost', () => {
  it('matches the documented formula', () => {
    const out = computeTronCost(40_000, 270, 280);
    expect(out.energySun).toBe(40_000 * 280);
    expect(out.bandwidthSun).toBe(270);
    expect(out.sunCost).toBe(40_000 * 280 + 270);
  });

  it('uses DEFAULT_SUN_PER_ENERGY when omitted', () => {
    const out = computeTronCost(40_000, 270);
    expect(out.energySun).toBe(40_000 * DEFAULT_SUN_PER_ENERGY);
  });
});
