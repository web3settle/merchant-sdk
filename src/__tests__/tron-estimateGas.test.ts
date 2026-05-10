import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  estimateTronGas,
  computeTronCost,
  DEFAULT_SUN_PER_ENERGY,
  fetchCurrentSunPerEnergy,
  clearSunPerEnergyCache,
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
  clearSunPerEnergyCache();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Stub global fetch so tests that don't pass `sunPerEnergy` don't escape to
  // the live TronGrid endpoint when the new dynamic refresh path runs.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test: fetch disabled'));
});

describe('estimateTronGas', () => {
  it('returns sun cost = energy*sunPerEnergy + bandwidth for native pay-in', async () => {
    const tw = mockTronWeb({
      energyUsed: 30_000,
      rawDataHex: '00'.repeat(270), // 270 byte placeholder tx
    });
    // Default path: fetchOverride throws → falls back to DEFAULT_SUN_PER_ENERGY.
    const fetchFail = vi.fn().mockRejectedValue(new Error('no network in tests'));
    const out = await estimateTronGas(
      {
        contractAddress: VALID_T_ADDR,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 1_000_000n,
        tronWebOverride: tw,
        fetchOverride: fetchFail as unknown as typeof fetch,
      },
    );
    clearSunPerEnergyCache();
    // Explicit sunPerEnergy short-circuits the fetch.
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
    // First call (without sunPerEnergy override) falls back to the default rate.
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

// Premortem F6: dynamic sun-per-energy refresh — the hardcoded 280 stops being
// the truth the moment Witnesses raise the rate.
describe('fetchCurrentSunPerEnergy', () => {
  afterEach(() => clearSunPerEnergyCache());

  it('parses the rightmost rate from TronGrid /wallet/getenergyprices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ prices: '0:100,1542607200000:10,1606537500000:40,1697461200000:420' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const value = await fetchCurrentSunPerEnergy(fetchMock as unknown as typeof fetch);
    expect(value).toBe(420);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the value across subsequent calls within the TTL window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prices: '1697461200000:330' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const a = await fetchCurrentSunPerEnergy(fetchMock as unknown as typeof fetch);
    const b = await fetchCurrentSunPerEnergy(fetchMock as unknown as typeof fetch);
    expect(a).toBe(330);
    expect(b).toBe(330);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to DEFAULT_SUN_PER_ENERGY when TronGrid fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('rpc down'));
    const value = await fetchCurrentSunPerEnergy(fetchMock as unknown as typeof fetch);
    expect(value).toBe(DEFAULT_SUN_PER_ENERGY);
  });
});
