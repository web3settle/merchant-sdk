import { describe, it, expect } from 'vitest';
import {
  DefaultConfirmationPolicy,
  defaultConfirmationPolicy,
  DEFAULT_CONFIRMATION_THRESHOLDS,
  DEFAULT_SECONDS_TO_FINALITY,
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
 * The SPD-canonical thresholds for the active chains are ETH 12, Base 12,
 * TRON 19. Polygon (30) and Solana (31) were removed by the 2026-09-24 chain
 * cut — decisions D1 and D2.
 */

describe('DefaultConfirmationPolicy — required confirmations (SPD §3.2)', () => {
  const policy = new DefaultConfirmationPolicy();

  it('returns 12 for Ethereum mainnet (chainId 1)', () => {
    expect(policy.requiredConfirmations(1)).toBe(12);
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

  it('falls back to a conservative 12 for unknown chainIds', () => {
    expect(policy.requiredConfirmations(999_999)).toBe(12);
  });
});

describe('DefaultConfirmationPolicy — family inference', () => {
  const policy = new DefaultConfirmationPolicy();

  it('classifies the EVM mainnet chainIds as `evm`', () => {
    expect(policy.family(1)).toBe('evm');
    expect(policy.family(8453)).toBe('evm');
  });

  it('classifies TRON chainIds as `tron`', () => {
    expect(policy.family(728126428)).toBe('tron');
    expect(policy.family(1001)).toBe('tron');
  });

  it('defaults unknown chainIds to `evm`', () => {
    expect(policy.family(424242)).toBe('evm');
  });
});

/**
 * Chain cut (2026-09-24) — the contract these tests protect is *product scope*,
 * not arithmetic: a dropped chain must not be re-addable by accident. If someone
 * re-adds 137 or 900–902 to either registry without a founder decision, these
 * fail. They are the executable half of decisions D1 (drop Polygon) and D2
 * (archive Solana).
 */
describe('Chain cut — dropped chains stay dropped', () => {
  const policy = new DefaultConfirmationPolicy();
  const POLYGON = 137;
  const SOLANA_IDS = [900, 901, 902];

  it('Polygon (137) is absent from both registries', () => {
    expect(DEFAULT_CONFIRMATION_THRESHOLDS[POLYGON]).toBeUndefined();
    expect(CHAIN_FAMILY_REGISTRY[POLYGON]).toBeUndefined();
    expect(DEFAULT_SECONDS_TO_FINALITY[POLYGON]).toBeUndefined();
  });

  it('Solana sentinels (900–902) are absent from both registries', () => {
    for (const id of SOLANA_IDS) {
      expect(DEFAULT_CONFIRMATION_THRESHOLDS[id]).toBeUndefined();
      expect(CHAIN_FAMILY_REGISTRY[id]).toBeUndefined();
      expect(DEFAULT_SECONDS_TO_FINALITY[id]).toBeUndefined();
    }
  });

  it('a dropped chainId is treated as unknown, not as its old self', () => {
    // Polygon used to resolve to 30 and Solana to 31. Both must now fall through
    // to the conservative unknown-chain default rather than a stale special case.
    expect(policy.requiredConfirmations(POLYGON)).toBe(12);
    expect(policy.estimatedSecondsToFinality(POLYGON)).toBe(0);
    for (const id of SOLANA_IDS) {
      expect(policy.requiredConfirmations(id)).toBe(12);
      expect(policy.estimatedSecondsToFinality(id)).toBe(0);
    }
  });

  it('no registry entry claims a family outside evm | tron', () => {
    const families = new Set(Object.values(CHAIN_FAMILY_REGISTRY));
    expect([...families].sort()).toEqual(['evm', 'tron']);
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
    expect(policy.estimatedSecondsToFinality(8453)).toBeGreaterThan(0);
    expect(policy.estimatedSecondsToFinality(728126428)).toBeGreaterThan(0);
  });

  it('returns 0 for unknown chains (no fabricated estimate)', () => {
    expect(policy.estimatedSecondsToFinality(424242)).toBe(0);
  });
});

describe('Module-level singletons', () => {
  it('defaultConfirmationPolicy is reusable across calls', () => {
    expect(defaultConfirmationPolicy.requiredConfirmations(1)).toBe(12);
    expect(defaultConfirmationPolicy.family(728126428)).toBe('tron');
  });

  it('thresholds and family registry are frozen', () => {
    expect(Object.isFrozen(DEFAULT_CONFIRMATION_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(CHAIN_FAMILY_REGISTRY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SECONDS_TO_FINALITY)).toBe(true);
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
  it('evmConfirmationPolicy resolves EVM depth', async () => {
    const { evmConfirmationPolicy } = await import('../evm/confirmationPolicy');
    expect(evmConfirmationPolicy.requiredConfirmations(1)).toBe(12);
    expect(evmConfirmationPolicy.requiredConfirmations(8453)).toBe(12);
    expect(evmConfirmationPolicy.family(1)).toBe('evm');
  });

  it('tronConfirmationPolicy returns 19 for the TRON mainnet sentinel', async () => {
    const { tronConfirmationPolicy } = await import('../tron/confirmationPolicy');
    expect(tronConfirmationPolicy.requiredConfirmations(728126428)).toBe(19);
    expect(tronConfirmationPolicy.family(728126428)).toBe('tron');
  });
});
