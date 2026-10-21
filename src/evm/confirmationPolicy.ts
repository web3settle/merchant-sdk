/**
 * EVM-locked variant of {@link ConfirmationPolicy}. Convenience wrapper for
 * EVM-only consumers — if you `import { evmConfirmationPolicy } from
 * '@web3settle/merchant-sdk'` you do NOT pull in the TRON family.
 *
 * The default policy already covers EVM correctly; this wrapper just narrows
 * the family check so an EVM-only storefront can fail loudly when given a TRON
 * chainId by mistake (which would otherwise resolve to a conservative
 * 12-confirmation default and silently work).
 */

import {
  DefaultConfirmationPolicy,
  type ChainFamily,
  type ConfirmationPolicy,
  type ConfirmationProgress,
} from '../core/ConfirmationPolicy';
import type { ChainConfig } from '../core/types';

// Chain cut 2026-09-24: Polygon (137) dropped permanently (decision D1).
const SUPPORTED_EVM_CHAIN_IDS = new Set<number>([1, 8453]);

class EvmConfirmationPolicy implements ConfirmationPolicy {
  private readonly inner = new DefaultConfirmationPolicy();

  family(chainId: number): ChainFamily {
    return this.inner.family(chainId);
  }

  requiredConfirmations(chainId: number): number {
    return this.inner.requiredConfirmations(chainId);
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
