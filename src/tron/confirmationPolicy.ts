/**
 * TRON-locked variant of {@link ConfirmationPolicy}. Lives under
 * `@web3settle/merchant-sdk/tron` so consumers who use that subpath get a
 * TRON-shaped default that recognises both the legacy gateway-internal
 * sentinel chainId (`1001`) and the canonical TronGrid `chainId` (728126428).
 *
 * The TRON pipeline (`src/tron/pipeline.ts`) currently polls
 * `getConfirmedTransaction` until it lands; the `requiredConfirmations`
 * surface here is for UI / parity ("X confirmations remaining"), not used
 * by the polling loop directly. A future enhancement could drive the polling
 * cadence off this value.
 */

import {
  DefaultConfirmationPolicy,
  type ConfirmationPolicy,
  type ConfirmationProgress,
  type SolanaCommitmentLevel,
} from '../core/ConfirmationPolicy';
import type { ChainConfig } from '../core/types';

class TronConfirmationPolicy implements ConfirmationPolicy {
  private readonly inner = new DefaultConfirmationPolicy();

  family(chainId: number): 'evm' | 'tron' | 'solana' {
    return this.inner.family(chainId);
  }

  requiredConfirmations(chainId: number): number {
    return this.inner.requiredConfirmations(chainId);
  }

  commitmentLevel(chainId: number): SolanaCommitmentLevel | null {
    void chainId;
    return null;
  }

  estimatedSecondsToFinality(chainId: number): number {
    return this.inner.estimatedSecondsToFinality(chainId);
  }

  progress(chainId: number, current: number): ConfirmationProgress {
    return this.inner.progress(chainId, current);
  }

  resolve(config: ChainConfig): number {
    return this.inner.resolve(config);
  }
}

/** Singleton — TRON-locked default (19 confirmations). */
export const tronConfirmationPolicy: ConfirmationPolicy = new TronConfirmationPolicy();
