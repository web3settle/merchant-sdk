/**
 * Solana-locked variant of {@link ConfirmationPolicy}. Lives under
 * `@web3settle/merchant-sdk/solana` so consumers who use that subpath get a
 * Solana-shaped default without manually configuring the commitment level.
 *
 * The exported singleton uses `'confirmed'` (matching `SolanaPaymentPipeline`'s
 * default — see `src/solana/pipeline.ts`). For high-value flows, instantiate
 * `createSolanaConfirmationPolicy('finalized')` and pass it down to the
 * pipeline / hook.
 */

import {
  DefaultConfirmationPolicy,
  type ConfirmationPolicy,
  type ConfirmationProgress,
  type SolanaCommitmentLevel,
} from '../core/ConfirmationPolicy';
import type { ChainConfig } from '../core/types';

class SolanaConfirmationPolicy implements ConfirmationPolicy {
  private readonly inner: DefaultConfirmationPolicy;

  constructor(commitment: SolanaCommitmentLevel) {
    this.inner = new DefaultConfirmationPolicy({ solanaCommitment: commitment });
  }

  family(chainId: number): 'evm' | 'tron' | 'solana' {
    return this.inner.family(chainId);
  }

  requiredConfirmations(chainId: number): number {
    return this.inner.requiredConfirmations(chainId);
  }

  commitmentLevel(chainId: number): SolanaCommitmentLevel | null {
    return this.inner.commitmentLevel(chainId);
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

/**
 * Default Solana policy: `confirmed` commitment, slot-delta heuristic of 31
 * (per SPD §3.2). Use this for low-to-mid-value consumer flows.
 */
export const solanaConfirmationPolicy: ConfirmationPolicy = new SolanaConfirmationPolicy('confirmed');

/**
 * Factory for storefronts that want a higher safety bar on Solana.
 * `'finalized'` adds ~10 s of wait but eliminates the (already-rare)
 * possibility of a `'confirmed'` slot getting reorganized away.
 */
export function createSolanaConfirmationPolicy(
  commitment: SolanaCommitmentLevel,
): ConfirmationPolicy {
  return new SolanaConfirmationPolicy(commitment);
}
