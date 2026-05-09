import { describe, it, expect } from 'vitest';
import {
  DefaultConfirmationPolicy,
  defaultConfirmationPolicy,
  createHighValueConfirmationPolicy,
  DEFAULT_CONFIRMATION_THRESHOLDS,
  CHAIN_FAMILY_REGISTRY,
} from '../core/ConfirmationPolicy';
import type { ChainConfig } from '../core/types';

/**
 * Segment 2.2 — ConfirmationPolicy unit tests.
 *
 * The policy is a pure-data abstraction (no network I/O), so the tests are
 * straightforward: verify that each chainId resolves to the SPD-canonical
 * value, that ChainConfig overrides win, and that family inference picks
 * the right vocabulary.
 *
 * The SPD-canonical thresholds are defined in `enhancementplan.md` line 94:
 * ETH 12, Polygon 30, Base 12, TRON 19, Solana 31.
 */

describe('DefaultConfirmationPolicy — required confirmations (SPD §3.2)', () => {
  const policy = new DefaultConfirmationPolicy();

  it('returns 12 for Ethereum mainnet (chainId 1)', () => {
    expect(policy.requiredConfirmations(1)).toBe(12);
  });

  it('returns 30 for Polygon mainnet (chainId 137)', () => {
    expect(policy.requiredConfirmations(137)).toBe(30);
  });

  it('returns 12 for Base mainnet (chainId 8453)', () => {
    expect(policy.requiredConfirmations(8453)).toBe(12);
  });

  it('returns 19 for TRON mainnet (TronGrid chainId 728126428)', () => {
    expect(policy.requiredConfirmations(728126428)).toBe(19);
  });

  it('returns 19 for the SDK-internal TRON sentinel (1001)', () => {
    expect(policy.requiredConfirmations(1001)).toBe(19);
  });

  it('returns 31 for Solana mainnet (gateway-internal 901)', () => {
    expect(policy.requiredConfirmations(901)).toBe(31);
  });

  it('falls back to a conservative 12 for unknown chainIds', () => {
    expect(policy.requiredConfirmations(999_999)).toBe(12);
  });
});

describe('DefaultConfirmationPolicy — family inference', () => {
  const policy = new DefaultConfirmationPolicy();

  it('classifies the EVM mainnet chainIds as `evm`', () => {
    expect(policy.family(1)).toBe('evm');
    expect(policy.family(137)).toBe('evm');
    expect(policy.family(8453)).toBe('evm');
  });

  it('classifies TRON chainIds as `tron`', () => {
    expect(policy.family(728126428)).toBe('tron');
    expect(policy.family(1001)).toBe('tron');
  });

  it('classifies Solana chainIds as `solana`', () => {
    expect(policy.family(900)).toBe('solana');
    expect(policy.family(901)).toBe('solana');
    expect(policy.family(902)).toBe('solana');
  });

  it('defaults unknown chainIds to `evm`', () => {
    expect(policy.family(424242)).toBe('evm');
  });
});

describe('DefaultConfirmationPolicy — Solana commitment level', () => {
  it('defaults to `confirmed` for Solana chainIds', () => {
    const policy = new DefaultConfirmationPolicy();
    expect(policy.commitmentLevel(901)).toBe('confirmed');
  });

  it('honours an explicit `finalized` override', () => {
    const policy = new DefaultConfirmationPolicy({ solanaCommitment: 'finalized' });
    expect(policy.commitmentLevel(901)).toBe('finalized');
  });

  it('returns null for non-Solana chainIds', () => {
    const policy = new DefaultConfirmationPolicy({ solanaCommitment: 'finalized' });
    expect(policy.commitmentLevel(1)).toBeNull();
    expect(policy.commitmentLevel(728126428)).toBeNull();
  });

  it('createHighValueConfirmationPolicy returns finalized', () => {
    expect(createHighValueConfirmationPolicy().commitmentLevel(901)).toBe('finalized');
  });
});

describe('DefaultConfirmationPolicy — ChainConfig overrides', () => {
  const policy = new DefaultConfirmationPolicy();

  function makeConfig(chainId: number, confirmations?: number): ChainConfig {
    return {
      chainId,
      name: 'test',
      contractAddress: '0x0000000000000000000000000000000000000001',
      tokens: [],
      explorerUrl: 'https://example.com',
      confirmations,
    };
  }

  it('uses the per-chain override when it is set', () => {
    expect(policy.resolve(makeConfig(1, 6))).toBe(6);
  });

  it('falls back to the canonical default when no override is set', () => {
    expect(policy.resolve(makeConfig(1))).toBe(12);
  });

  it('treats a zero override as "use the default" (defensive — zero is not a valid depth)', () => {
    expect(policy.resolve(makeConfig(1, 0))).toBe(12);
  });

  it('honours overrides on chains that lack a registry entry', () => {
    expect(policy.resolve(makeConfig(424242, 5))).toBe(5);
  });
});

describe('DefaultConfirmationPolicy — progress descriptor', () => {
  const policy = new DefaultConfirmationPolicy();

  it('renders "X of N confirmations" for EVM', () => {
    const p = policy.progress(1, 8);
    expect(p.family).toBe('evm');
    expect(p.required).toBe(12);
    expect(p.current).toBe(8);
    expect(p.label).toBe('8 of 12 confirmations');
  });

  it('clamps negative current to 0', () => {
    const p = policy.progress(1, -3);
    expect(p.current).toBe(0);
    expect(p.label).toBe('0 of 12 confirmations');
  });

  it('clamps current to required (cannot exceed)', () => {
    const p = policy.progress(1, 99);
    expect(p.current).toBe(12);
    expect(p.label).toBe('12 of 12 confirmations');
  });

  it('renders commitment-level state for Solana — Pending → Confirmed → Finalized', () => {
    expect(policy.progress(901, 0).label).toContain('Pending');
    expect(policy.progress(901, 1).label).toContain('Confirmed');
    expect(policy.progress(901, 2).label).toContain('Finalized');
    expect(policy.progress(901, 0).label).toContain('confirmed'); // target
  });

  it('renders confirmations for TRON', () => {
    const p = policy.progress(728126428, 10);
    expect(p.family).toBe('tron');
    expect(p.required).toBe(19);
    expect(p.label).toBe('10 of 19 confirmations');
  });
});

describe('DefaultConfirmationPolicy — estimated finality time', () => {
  const policy = new DefaultConfirmationPolicy();

  it('produces a positive estimate for known chains', () => {
    expect(policy.estimatedSecondsToFinality(1)).toBeGreaterThan(0);
    expect(policy.estimatedSecondsToFinality(137)).toBeGreaterThan(0);
    expect(policy.estimatedSecondsToFinality(901)).toBeGreaterThan(0);
  });

  it('returns 0 for unknown chains (no fabricated estimate)', () => {
    expect(policy.estimatedSecondsToFinality(424242)).toBe(0);
  });
});

describe('Module-level singletons', () => {
  it('defaultConfirmationPolicy is reusable across calls', () => {
    expect(defaultConfirmationPolicy.requiredConfirmations(1)).toBe(12);
    expect(defaultConfirmationPolicy.commitmentLevel(901)).toBe('confirmed');
  });

  it('thresholds and family registry are frozen', () => {
    expect(Object.isFrozen(DEFAULT_CONFIRMATION_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(CHAIN_FAMILY_REGISTRY)).toBe(true);
  });

  it('the threshold table covers every family-registered chain', () => {
    // Defensive — if you add a chain to one table you must add it to the other.
    for (const chainIdStr of Object.keys(CHAIN_FAMILY_REGISTRY)) {
      const chainId = Number(chainIdStr);
      expect(
        DEFAULT_CONFIRMATION_THRESHOLDS[chainId],
        `chainId ${chainId} is in CHAIN_FAMILY_REGISTRY but missing from DEFAULT_CONFIRMATION_THRESHOLDS`,
      ).toBeDefined();
    }
  });
});

describe('Per-chain locked policies', () => {
  it('evmConfirmationPolicy returns null commitment for any chainId', async () => {
    const { evmConfirmationPolicy } = await import('../evm/confirmationPolicy');
    expect(evmConfirmationPolicy.commitmentLevel(1)).toBeNull();
    expect(evmConfirmationPolicy.commitmentLevel(901)).toBeNull(); // even when chainId is Solana
    expect(evmConfirmationPolicy.requiredConfirmations(1)).toBe(12);
  });

  it('solanaConfirmationPolicy defaults to confirmed', async () => {
    const { solanaConfirmationPolicy, createSolanaConfirmationPolicy } = await import(
      '../solana/confirmationPolicy'
    );
    expect(solanaConfirmationPolicy.commitmentLevel(901)).toBe('confirmed');
    const finalized = createSolanaConfirmationPolicy('finalized');
    expect(finalized.commitmentLevel(901)).toBe('finalized');
  });

  it('tronConfirmationPolicy returns 19 for the TRON mainnet sentinel', async () => {
    const { tronConfirmationPolicy } = await import('../tron/confirmationPolicy');
    expect(tronConfirmationPolicy.requiredConfirmations(728126428)).toBe(19);
    expect(tronConfirmationPolicy.commitmentLevel(728126428)).toBeNull();
  });
});
