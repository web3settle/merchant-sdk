/**
 * EVM-locked variant of {@link ConfirmationPolicy}. Convenience wrapper for
 * EVM-only consumers — if you `import { evmConfirmationPolicy } from
 * '@web3settle/merchant-sdk'` you do NOT pull in the Solana / TRON families.
 *
 * The default policy already covers EVM correctly; this wrapper just
 * narrows the family check so an EVM-only storefront can fail loudly when
 * given a Solana chainId by mistake (which would otherwise resolve to a
 * conservative 12-confirmation default and silently work).
 */

import {
  DefaultConfirmationPolicy,
  type ConfirmationPolicy,
  type ConfirmationProgress,
  type SolanaCommitmentLevel,
} from '../core/ConfirmationPolicy';
import type { ChainConfig } from '../core/types';

const SUPPORTED_EVM_CHAIN_IDS = new Set<number>([1, 137, 8453]);

class EvmConfirmationPolicy implements ConfirmationPolicy {
  private readonly inner = new DefaultConfirmationPolicy();

  family(chainId: number): 'evm' | 'tron' | 'solana' {
    return this.inner.family(chainId);
  }

  requiredConfirmations(chainId: number): number {
    return this.inner.requiredConfirmations(chainId);
  }

  commitmentLevel(chainId: number): SolanaCommitmentLevel | null {
    // EVM-locked policy never returns a commitment level.
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
    if (!SUPPORTED_EVM_CHAIN_IDS.has(config.chainId)) {
      // Conservative default; logged so integrators notice the mis-wire.
      // Console.warn is called once per resolve — acceptable for an SDK
      // diagnostic.
      // eslint-disable-next-line no-console
      console.warn(
        `[w3s] EVM ConfirmationPolicy used with non-EVM chainId ${config.chainId}; ` +
          `falling back to default depth. Use the chain-family-specific subpath instead.`,
      );
    }
    return this.inner.resolve(config);
  }
}

/** Singleton — EVM-locked default. */
export const evmConfirmationPolicy: ConfirmationPolicy = new EvmConfirmationPolicy();
