// @vitest-environment node
// PDA derivation via @solana/web3.js fails under jsdom because of a
// TextEncoder/Uint8Array identity quirk in seed concatenation — same workaround
// as `solana-pda.test.ts`. The estimator is pure JS plus mocked Connection
// methods, so node is the right runtime.
import { describe, it, expect, vi } from 'vitest';
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  estimateSolanaGas,
  buildSolanaEstimateInstruction,
  LAMPORTS_PER_SIGNATURE,
} from '../solana/estimateGas';
import { NATIVE_TOKEN_SENTINEL } from '../core/types';

// Use a real curve-point program id. SystemProgram (`...11112`) has no viable
// PDA nonce for many merchant-id seeds, which is what triggered the original
// "Unable to find a viable program address nonce" failures. We reuse the same
// fixture as `solana-pda.test.ts` because that test already proves these seeds
// derive cleanly.
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const SENDER = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnT');
const MINT = new PublicKey('So11111111111111111111111111111111111111112');
// Non-trivial merchant id: bytes [1,2,3,…,32]. A zeroed (or all-`aa`) id can
// collide with an on-curve point and break PDA derivation.
const MERCHANT_ID =
  '0x' +
  Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, '0')).join('');

interface MockConnectionInit {
  unitsConsumed?: number;
  prioritization?: { prioritizationFee: number }[];
  simulateError?: boolean;
  feesError?: boolean;
}

function mockConnection(opts: MockConnectionInit) {
  const simulateTransaction = vi.fn().mockImplementation(() => {
    if (opts.simulateError) return Promise.reject(new Error('simulate failed'));
    return Promise.resolve({
      value: {
        unitsConsumed: opts.unitsConsumed,
        err: null,
        logs: [],
      },
    });
  });
  const getRecentPrioritizationFees = vi.fn().mockImplementation(() => {
    if (opts.feesError) return Promise.reject(new Error('rpc down'));
    return Promise.resolve(opts.prioritization ?? []);
  });
  const getLatestBlockhash = vi.fn().mockResolvedValue({
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 1,
  });
  return {
    simulateTransaction,
    getRecentPrioritizationFees,
    getLatestBlockhash,
  } as unknown as Connection;
}

describe('estimateSolanaGas (native)', () => {
  it('returns the static signature fee when no priority fee is recommended', async () => {
    const conn = mockConnection({ unitsConsumed: 50_000, prioritization: [] });
    const out = await estimateSolanaGas({
      connection: conn,
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1_000_000n,
    });
    expect(out.native).toBe(LAMPORTS_PER_SIGNATURE);
    expect(out.usd).toBeNull();
    expect(out.breakdown).toMatchObject({
      family: 'solana',
      computeUnits: 50_000,
      microLamportsPerCu: 0,
    });
  });

  it('adds priority fee = median(microLam/CU) × CU / 1e6', async () => {
    const conn = mockConnection({
      unitsConsumed: 200_000,
      prioritization: [
        { prioritizationFee: 50 },
        { prioritizationFee: 100 },
        { prioritizationFee: 150 },
      ],
    });
    const out = await estimateSolanaGas({
      connection: conn,
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1_000_000n,
    });
    // Median = 100 µLAM/CU, CU = 200k → priority lamports = ceil(100*200000/1e6) = 20.
    // Total = 5000 base + 20 priority = 5020.
    expect(out.native).toBe(5020);
    expect((out.breakdown as { microLamportsPerCu: number }).microLamportsPerCu).toBe(100);
  });

  it('falls back to a default 200k CU when simulate fails', async () => {
    const conn = mockConnection({ simulateError: true });
    const out = await estimateSolanaGas({
      connection: conn,
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
    });
    expect((out.breakdown as { computeUnits: number }).computeUnits).toBe(200_000);
  });

  it('still returns the base fee when getRecentPrioritizationFees errors', async () => {
    const conn = mockConnection({ unitsConsumed: 30_000, feesError: true });
    const out = await estimateSolanaGas({
      connection: conn,
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
    });
    expect(out.native).toBe(LAMPORTS_PER_SIGNATURE);
  });

  it('throws when BOTH simulate and getRecentPrioritizationFees fail', async () => {
    // When both dynamic sources are unavailable the only thing left is the
    // 5000-lamport signature fee, which would render "≈ $0.001" and be
    // misleading on a congested cluster. The estimator should refuse rather
    // than silently produce a fake-looking number.
    const conn = mockConnection({ simulateError: true, feesError: true });
    await expect(estimateSolanaGas({
      connection: conn,
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 1n,
    })).rejects.toThrow(/Solana fee estimate unavailable/);
  });

  it('converts lamports to USD when a priceUsd oracle is supplied', async () => {
    const conn = mockConnection({ unitsConsumed: 50_000, prioritization: [] });
    const out = await estimateSolanaGas(
      {
        connection: conn,
        sender: SENDER,
        programId: PROGRAM_ID,
        merchantId: MERCHANT_ID,
        token: NATIVE_TOKEN_SENTINEL,
        amount: 1_000_000n,
      },
      { priceUsd: 200 },
    );
    // 5000 lamports = 5e-6 SOL = $0.001 at $200/SOL.
    expect(out.usd).toBeCloseTo(0.001, 5);
  });
});

describe('buildSolanaEstimateInstruction', () => {
  it('builds the native pay-in instruction with the right discriminator', () => {
    const ix = buildSolanaEstimateInstruction({
      connection: mockConnection({ unitsConsumed: 1 }),
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: NATIVE_TOKEN_SENTINEL,
      amount: 12345n,
    });
    expect(ix.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    // Anchor discriminator for `pay_in_native`. Verified against
    // src/solana/instructions.ts.
    expect(ix.data[0]).toBe(0xe4);
    expect(ix.data[1]).toBe(0xa7);
  });

  it('builds the SPL pay-in instruction with the token discriminator', () => {
    const ix = buildSolanaEstimateInstruction({
      connection: mockConnection({ unitsConsumed: 1 }),
      sender: SENDER,
      programId: PROGRAM_ID,
      merchantId: MERCHANT_ID,
      token: MINT.toBase58(),
      amount: 1n,
      tokenMint: MINT,
    });
    // pay_in_token discriminator
    expect(ix.data[0]).toBe(0xba);
    expect(ix.data[1]).toBe(0x77);
  });
});
