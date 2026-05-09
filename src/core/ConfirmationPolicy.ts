/**
 * ConfirmationPolicy — Segment 2.2 (cross-chain SDK abstraction).
 *
 * Storefronts SHOULD NOT branch on `chainId` to decide "is this safe yet" —
 * that pattern has historically drifted (SPD §3.2 cites ETH 12, Polygon 30,
 * Base 12, TRON 19, Solana 31; storefront code that hard-codes any subset of
 * those is one chain-add away from being wrong).
 *
 * This interface unifies the "depth required for finality" semantics across
 * chain families that disagree about what "depth" even means:
 *
 *   - EVM (Ethereum, Polygon, Base): integer block confirmations on top of the
 *     canonical chain. A receipt is finalized when `blockNumber - txBlock >=
 *     requiredConfirmations(chainId)`.
 *   - TRON: block confirmations against the SR-produced chain. SPD calls 19
 *     (≈ 60 s @ 3 s blocks). Same arithmetic as EVM.
 *   - Solana: there is no "block depth" the way EVM has — Solana has
 *     **commitment levels** (`processed | confirmed | finalized`). The
 *     "31 confirmations" figure in the SPD is the slot-progression heuristic
 *     used by the gateway's Solana indexer to deem a tx irreversible without
 *     waiting the full ~13 s for `finalized`. The policy exposes both
 *     `requiredConfirmations` (slot delta — for indexer / UI parity with EVM
 *     thinking) AND `commitmentLevel` (the actual call shape `web3.js` wants).
 *
 * The policy is purposefully **read-only** — it never touches the network. A
 * storefront calls it to drive UI ("X confirmations remaining"), to wire the
 * receipt-wait into the EVM pipeline (`waitForReceipt(hash, depth)`), and to
 * decide whether to use `'confirmed'` or `'finalized'` for Solana.
 *
 * Adding a new chain is one entry in `DEFAULT_CONFIRMATION_THRESHOLDS` plus,
 * if it's not EVM or TRON, an explicit family registration in
 * `chainFamilyForId`. Storefronts MUST NOT need to be touched.
 *
 * The type is *additive* — existing `ChainConfig.confirmations` stays valid;
 * the policy treats a per-chain override on `ChainConfig` as taking
 * precedence over the registry default. This keeps existing consumers
 * working with no change.
 */

import type { ChainConfig } from './types';

/**
 * Solana commitment level — `web3.js` uses this string verbatim. EVM/TRON
 * pipelines do not consume it (they receive `null` for these chains).
 *
 * - `processed`: optimistic, single-validator vote. Reorg-prone.
 * - `confirmed`: super-majority cluster vote (~ 2 s). The default trade-off
 *   for consumer UX. Reorgs are extremely rare but possible.
 * - `finalized`: full root-set finalization (~ 13 s). Effectively irreversible.
 */
export type SolanaCommitmentLevel = 'processed' | 'confirmed' | 'finalized';

/**
 * Identifies which chain family a chainId belongs to. The SDK uses this to
 * pick the right pipeline + commitment vocabulary.
 *
 * Note: for EVM this is the actual EIP-155 chainId (1, 137, 8453, …); for
 * TRON it is the conventional gateway-internal numeric ID (so the storefront
 * doesn't need to special-case strings); for Solana it is a synthetic
 * gateway-internal ID — Solana clusters don't have an EIP-155 chainId.
 */
export type ChainFamily = 'evm' | 'tron' | 'solana';

/**
 * Default per-chain confirmation thresholds. Mirrors SPD §3.2 / Segment 2
 * (line 94 of `enhancementplan.md`). These are gateway-canonical values —
 * a storefront that needs higher values can pass a custom `ConfirmationPolicy`
 * to override.
 *
 * The TRON and Solana chainIds here are gateway-internal sentinel values.
 * They match the ones already used elsewhere in the SDK (see
 * `src/core/config.ts` and the per-chain pipelines).
 */
export const DEFAULT_CONFIRMATION_THRESHOLDS: Readonly<Record<number, number>> = Object.freeze({
  // EVM
  1: 12,        // Ethereum mainnet
  137: 30,      // Polygon mainnet
  8453: 12,     // Base mainnet
  // TRON — chainId 728126428 is the mainnet "chain id" surfaced by TronGrid.
  // The SDK uses the smaller `1001` sentinel internally (per existing
  // gateway convention); we map BOTH so storefronts can pass whichever they
  // already use.
  728126428: 19,
  1001: 19,
  // Solana — slot-delta heuristic. The gateway-internal chainId for Solana
  // mainnet-beta is 901 (see `parity-tests/parity-matrix.json`). 900 is
  // testnet; 902 is devnet; we treat all the same for the slot heuristic.
  900: 31,
  901: 31,
  902: 31,
});

/**
 * Registry mapping chainId → family. Used to pick the right vocabulary
 * (`requiredConfirmations` for EVM/TRON; `commitmentLevel` for Solana).
 *
 * Add new chains here. The default policy resolves unknown chainIds to `evm`
 * and to a depth of 12, which is conservative for any L1 and L2 we currently
 * care about; it errs on the side of "wait longer than necessary".
 */
export const CHAIN_FAMILY_REGISTRY: Readonly<Record<number, ChainFamily>> = Object.freeze({
  // EVM
  1: 'evm',
  137: 'evm',
  8453: 'evm',
  // TRON
  728126428: 'tron',
  1001: 'tron',
  // Solana
  900: 'solana',
  901: 'solana',
  902: 'solana',
});

/**
 * Estimated seconds-to-finality per chainId, used by the UI to render
 * "this usually takes ~30 s" hints. Values are eyeballed off public
 * block-time stats — they are NOT load-bearing for correctness. The only
 * consumer is presentational (TopUpModal), so an integrator who tweaks
 * them or replaces them entirely cannot break payment flow.
 */
export const DEFAULT_SECONDS_TO_FINALITY: Readonly<Record<number, number>> = Object.freeze({
  1: 12 * 12,           // ETH ~12 s blocks × 12 confirmations
  137: 30 * 2,          // Polygon ~2 s blocks × 30 confirmations
  8453: 12 * 2,         // Base ~2 s blocks × 12 confirmations
  728126428: 19 * 3,    // TRON ~3 s blocks × 19 confirmations
  1001: 19 * 3,
  900: 31 * 0.4,        // Solana ~400 ms slot
  901: 31 * 0.4,
  902: 31 * 0.4,
});

/**
 * Convenience progress descriptor for UI rendering. The pipeline reports the
 * current confirmation count (EVM/TRON) or commitment level (Solana); the UI
 * computes an `ETA` text from it.
 */
export interface ConfirmationProgress {
  family: ChainFamily;
  required: number;
  /** Best-effort current depth. For Solana, this is the *slot delta* if the
   *  caller knows it; otherwise 0 = pending, 1 = confirmed, 2 = finalized. */
  current: number;
  /** A render-ready label — "8 of 12 confirmations" / "Confirmed (1 of 2)". */
  label: string;
}

/**
 * Public interface — what the storefront depends on. Concrete instances live
 * in `src/{evm,solana,tron}/confirmationPolicy.ts`; the default exported by
 * this file composes all three so callers who don't know their chain family
 * yet still get a working object.
 */
export interface ConfirmationPolicy {
  /** Which family the policy thinks `chainId` belongs to. */
  family(chainId: number): ChainFamily;

  /**
   * Number of confirmations / slot-deltas the storefront should wait for.
   * Used both as the EVM `waitForReceipt(hash, n)` parameter and as the
   * "X of N" denominator in UI.
   */
  requiredConfirmations(chainId: number): number;

  /**
   * Commitment level for Solana. Returns `null` for chains where the concept
   * is meaningless (EVM, TRON). Defaulted to `'confirmed'` because that's
   * the UX/safety trade-off the existing `SolanaPaymentPipeline` already
   * uses — `'finalized'` is appropriate for high-value flows where the
   * extra ~10 s wait is acceptable.
   */
  commitmentLevel(chainId: number): SolanaCommitmentLevel | null;

  /**
   * Best-effort estimate (in seconds) of how long to wait. The UI uses this
   * to render the ETA hint under "Confirming on-chain…". Returns 0 when no
   * estimate is registered for `chainId`.
   */
  estimatedSecondsToFinality(chainId: number): number;

  /**
   * Build a render-ready progress descriptor. The pipeline supplies the
   * current confirmation count (or 0/1/2 for the three Solana commitment
   * levels); this method packages that with the policy's required value
   * and produces the label string.
   */
  progress(chainId: number, currentConfirmations: number): ConfirmationProgress;

  /**
   * Resolve the per-chain depth using a {@link ChainConfig}. If the config
   * supplies its own `confirmations`, that wins; otherwise fall back to
   * the policy's default for `config.chainId`. This is the path
   * `usePayment` / pipelines should use so that legacy
   * `ChainConfig.confirmations` overrides keep working.
   */
  resolve(config: ChainConfig): number;
}

/**
 * Default implementation. Storefronts can either:
 *   1. Use `defaultConfirmationPolicy` directly (most callers — covers all
 *      five mainnets out of the box).
 *   2. Pass a custom impl into the chain-specific pipeline / hook (e.g. to
 *      flip Solana to `'finalized'` for a high-value flow).
 */
export class DefaultConfirmationPolicy implements ConfirmationPolicy {
  /**
   * Optional override to upgrade Solana commitment to `'finalized'` for all
   * Solana chainIds. Defaults to `'confirmed'` — see comment on
   * `commitmentLevel`.
   */
  constructor(private readonly options: { solanaCommitment?: SolanaCommitmentLevel } = {}) {}

  family(chainId: number): ChainFamily {
    return CHAIN_FAMILY_REGISTRY[chainId] ?? 'evm';
  }

  requiredConfirmations(chainId: number): number {
    const v = DEFAULT_CONFIRMATION_THRESHOLDS[chainId];
    if (typeof v === 'number') return v;
    // Conservative fallback for unknown chains. 12 matches Ethereum / Base.
    return 12;
  }

  commitmentLevel(chainId: number): SolanaCommitmentLevel | null {
    if (this.family(chainId) !== 'solana') return null;
    return this.options.solanaCommitment ?? 'confirmed';
  }

  estimatedSecondsToFinality(chainId: number): number {
    return DEFAULT_SECONDS_TO_FINALITY[chainId] ?? 0;
  }

  progress(chainId: number, currentConfirmations: number): ConfirmationProgress {
    const family = this.family(chainId);
    const required = this.requiredConfirmations(chainId);
    const current = Math.max(0, Math.min(currentConfirmations, required));

    let label: string;
    if (family === 'solana') {
      // For Solana we render commitment names rather than numeric depth —
      // the storefront usually knows whether it's at processed/confirmed/
      // finalized but rarely a sensible "slot delta".
      const commitment = this.commitmentLevel(chainId) ?? 'confirmed';
      const stateName =
        currentConfirmations <= 0
          ? 'Pending'
          : currentConfirmations === 1
            ? 'Confirmed'
            : 'Finalized';
      label = `${stateName} (target: ${commitment})`;
    } else {
      label = `${current} of ${required} confirmations`;
    }
    return { family, required, current, label };
  }

  resolve(config: ChainConfig): number {
    if (typeof config.confirmations === 'number' && config.confirmations > 0) {
      return config.confirmations;
    }
    return this.requiredConfirmations(config.chainId);
  }
}

/**
 * Stable singleton — most callers want this. Exported as the default so that
 * `import { defaultConfirmationPolicy } from '@web3settle/merchant-sdk'`
 * works.
 */
export const defaultConfirmationPolicy: ConfirmationPolicy = new DefaultConfirmationPolicy();

/**
 * Convenience factory — one-liner for storefronts that want `'finalized'`
 * across the board on Solana. Equivalent to
 * `new DefaultConfirmationPolicy({ solanaCommitment: 'finalized' })`.
 */
export function createHighValueConfirmationPolicy(): ConfirmationPolicy {
  return new DefaultConfirmationPolicy({ solanaCommitment: 'finalized' });
}
