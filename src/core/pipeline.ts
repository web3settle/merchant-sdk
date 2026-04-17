import type { ChainConfig, TokenSelection } from './types';

/**
 * Common abstraction over the EVM / Solana / TRON payment pipelines.
 *
 * Each chain stack (wagmi+viem, @solana/web3.js, tronweb) has a different call
 * convention. This interface hides the mechanics so merchant UIs can work
 * against a single API regardless of the underlying chain.
 *
 * Each pipeline decides:
 *   - whether an approval step is required (EVM + TRON yes for non-native
 *     tokens; Solana never — the user signs the transfer instruction directly)
 *   - how to encode `value` into the chain's native smallest unit
 *   - what shape of tx hash it returns (hex for EVM, base58 for Solana + TRON)
 *
 * Implementations live in:
 *   - `src/hooks/usePayment.ts`      — EVM (wagmi-backed, already shipped)
 *   - `src/solana/pipeline.ts`       — Solana
 *   - `src/tron/pipeline.ts`         — TRON
 */
export interface PaymentPipeline {
  /** Chain family this pipeline drives. Useful for debug/telemetry. */
  readonly family: PaymentFamily;

  /**
   * Convert a USD amount into the chain-native smallest unit (wei, lamports,
   * sun, SPL raw), using the merchant-platform price feeds.
   */
  quoteAmount(usdAmount: number, chain: ChainConfig, token: TokenSelection): Promise<bigint>;

  /**
   * Does this pay-in need an approval / allowance step before the transfer?
   * EVM + TRON return true for non-native tokens when allowance < amount.
   * Solana always returns false — the user signs the transfer inline.
   */
  needsApproval(
    chain: ChainConfig,
    token: TokenSelection,
    amount: bigint,
  ): Promise<boolean>;

  /**
   * Execute the approval tx. Must be called only when `needsApproval` returned
   * true. Returns the approval tx hash.
   */
  approve(chain: ChainConfig, token: TokenSelection, amount: bigint): Promise<string>;

  /** Execute the actual pay-in tx. Returns the pay-in tx hash. */
  execute(chain: ChainConfig, token: TokenSelection, amount: bigint): Promise<string>;

  /**
   * Wait until the tx is confirmed at the chain's required depth.
   * EVM uses block confirmations; Solana uses commitment levels; TRON uses
   * `getConfirmedTransaction`.
   */
  waitForReceipt(
    txHash: string,
    confirmations?: number,
  ): Promise<PaymentReceipt>;
}

export type PaymentFamily = 'evm' | 'solana' | 'tron';

export interface PaymentReceipt {
  success: boolean;
  /** Block number (EVM/TRON) or slot (Solana). `null` when unavailable. */
  blockNumber: bigint | number | null;
  /** Raw receipt from the underlying chain client — for logging / debugging. */
  raw: unknown;
}

/**
 * Error categories common across pipelines so UIs can branch on a stable enum
 * instead of per-chain string matching.
 */
export type PaymentErrorKind =
  | 'user-rejected'
  | 'insufficient-funds'
  | 'wrong-network'
  | 'reverted'
  | 'timeout'
  | 'unknown';

export class PaymentPipelineError extends Error {
  public readonly kind: PaymentErrorKind;
  public readonly cause?: unknown;

  constructor(kind: PaymentErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'PaymentPipelineError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Map a provider-native error message to a `PaymentErrorKind`. Shared by all
 * pipelines so the classifier lives in one place.
 */
export function classifyError(err: unknown): PaymentErrorKind {
  if (!(err instanceof Error)) return 'unknown';
  const msg = err.message.toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied') || msg.includes('rejected by user')) {
    return 'user-rejected';
  }
  if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
    return 'insufficient-funds';
  }
  if (msg.includes('wrong network') || msg.includes('chain mismatch')) {
    return 'wrong-network';
  }
  if (msg.includes('reverted') || msg.includes('execution reverted')) {
    return 'reverted';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  return 'unknown';
}
