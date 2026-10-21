/**
 * ConfirmationPolicy — Segment 2.2 (cross-chain SDK abstraction).
 *
 * Storefronts SHOULD NOT branch on `chainId` to decide "is this safe yet" —
 * that pattern has historically drifted (SPD §3.2 cites ETH 12, Base 12,
 * TRON 19; storefront code that hard-codes any subset of those is one chain-add
 * away from being wrong).
 *
 * This interface unifies the "depth required for finality" semantics across the
 * active chain families:
 *
 *   - EVM (Ethereum, Base): integer block confirmations on top of the canonical
 *     chain. A receipt is finalized when `blockNumber - txBlock >=
 *     requiredConfirmations(chainId)`.
 *   - TRON: block confirmations against the SR-produced chain. SPD calls 19
 *     (≈ 60 s @ 3 s blocks). Same arithmetic as EVM.
 *
 * The policy is purposefully **read-only** — it never touches the network. A
 * storefront calls it to drive UI ("X confirmations remaining") and to wire the
 * receipt-wait into the EVM pipeline (`waitForReceipt(hash, depth)`).
 *
 * Adding a new chain is one entry in `DEFAULT_CONFIRMATION_THRESHOLDS` plus, if
 * it is not EVM, an entry in `CHAIN_FAMILY_REGISTRY`. Storefronts MUST NOT need
 * to be touched.
 *
 * The type is *additive* — existing `ChainConfig.confirmations` stays valid;
 * the policy treats a per-chain override on `ChainConfig` as taking
 * precedence over the registry default. This keeps existing consumers
 * working with no change.
 *
 * **Chain cut (2026-09-24).** Polygon (137) was dropped permanently (decision
 * D1) and Solana archived (decision D2). The Solana-shaped parts of this
 * surface — `SolanaCommitmentLevel`, `commitmentLevel()`,
 * `createHighValueConfirmationPolicy()` — were removed rather than left
 * returning `null` for every chain: a policy that advertises a commitment
 * vocabulary no chain uses is a trap for the next integrator.
 */

import type { ChainConfig } from './types';

/**
 * Identifies which chain family a chainId belongs to. The SDK uses this to
 * pick the right pipeline.
 *
 * Note: for EVM this is the actual EIP-155 chainId (1, 8453, …); for TRON it is
 * the conventional gateway-internal numeric ID (so the storefront doesn't need
 * to special-case strings).
 */
export type ChainFamily = 'evm' | 'tron';

/**
 * Default per-chain confirmation thresholds. Mirrors SPD §3.2 / Segment 2.
 * These are gateway-canonical values — a storefront that needs higher values
 * can pass a custom `ConfirmationPolicy` to override.
 *
 * The TRON chainIds here are gateway-internal sentinel values. They match the
 * ones already used elsewhere in the SDK (see `src/core/config.ts` and the
 * per-chain pipelines).
 */
export const DEFAULT_CONFIRMATION_THRESHOLDS: Readonly<Record<number, number>> = Object.freeze({
  // EVM
  1: 12,        // Ethereum mainnet
  8453: 12,     // Base mainnet
  // TRON — chainId 728126428 is the mainnet "chain id" surfaced by TronGrid.
  // The SDK uses the smaller `1001` sentinel internally (per existing
  // gateway convention); we map BOTH so storefronts can pass whichever they
  // already use.
  728126428: 19,
  1001: 19,
});

/**
 * Registry mapping chainId → family. Used to pick the right pipeline.
 *
 * Add new chains here. The default policy resolves unknown chainIds to `evm`
 * and to a depth of 12, which is conservative for any L1 and L2 we currently
 * care about; it errs on the side of "wait longer than necessary".
 */
export const CHAIN_FAMILY_REGISTRY: Readonly<Record<number, ChainFamily>> = Object.freeze({
  // EVM
  1: 'evm',
  8453: 'evm',
  // TRON
  728126428: 'tron',
  1001: 'tron',
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
  8453: 12 * 2,         // Base ~2 s blocks × 12 confirmations
  728126428: 19 * 3,    // TRON ~3 s blocks × 19 confirmations
  1001: 19 * 3,
});

/**
 * Convenience progress descriptor for UI rendering. The pipeline reports the
 * current confirmation count; the UI computes an `ETA` text from it.
 */
export interface ConfirmationProgress {
  family: ChainFamily;
  required: number;
  /** Best-effort current depth. */
  current: number;
  /** A render-ready label — "8 of 12 confirmations". */
  label: string;
}

/**
 * Public interface — what the storefront depends on. Concrete instances live
 * in `src/{evm,tron}/confirmationPolicy.ts`; the default exported by this file
 * composes both so callers who don't know their chain family yet still get a
 * working object.
 */
export interface ConfirmationPolicy {
  /** Which family the policy thinks `chainId` belongs to. */
  family(chainId: number): ChainFamily;

  /**
   * Number of confirmations the storefront should wait for. Used both as the
   * EVM `waitForReceipt(hash, n)` parameter and as the "X of N" denominator in
   * UI.
   */
  requiredConfirmations(chainId: number): number;

  /**
   * Best-effort estimate (in seconds) of how long to wait. The UI uses this
   * to render the ETA hint under "Confirming on-chain…". Returns 0 when no
   * estimate is registered for `chainId`.
   */
  estimatedSecondsToFinality(chainId: number): number;

  /**
   * Build a render-ready progress descriptor. The pipeline supplies the
   * current confirmation count; this method packages that with the policy's
   * required value and produces the label string.
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
 * Default implementation. Storefronts can either use
 * `defaultConfirmationPolicy` directly (most callers — covers every active
 * mainnet out of the box) or pass a custom impl into the chain-specific
 * pipeline / hook.
 */
export class DefaultConfirmationPolicy implements ConfirmationPolicy {
  family(chainId: number): ChainFamily {
    return CHAIN_FAMILY_REGISTRY[chainId] ?? 'evm';
  }

  requiredConfirmations(chainId: number): number {
    const v = DEFAULT_CONFIRMATION_THRESHOLDS[chainId];
    if (typeof v === 'number') return v;
    // Conservative fallback for unknown chains. 12 matches Ethereum / Base.
    return 12;
  }

  estimatedSecondsToFinality(chainId: number): number {
    return DEFAULT_SECONDS_TO_FINALITY[chainId] ?? 0;
  }

  progress(chainId: number, currentConfirmations: number): ConfirmationProgress {
    const family = this.family(chainId);
    const required = this.requiredConfirmations(chainId);
    const current = Math.max(0, Math.min(currentConfirmations, required));
    return { family, required, current, label: `${current} of ${required} confirmations` };
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
