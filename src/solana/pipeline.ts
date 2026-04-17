import type {
  Connection} from '@solana/web3.js';
import {
  PublicKey,
  Transaction,
  type Signer,
} from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { PaymentPipelineError, classifyError, type PaymentPipeline, type PaymentReceipt } from '../core/pipeline';
import type { ChainConfig, TokenSelection } from '../core/types';
import { NATIVE_TOKEN_SENTINEL } from '../core/types';
import { usdToNativeAmount, usdToTokenAmount } from '../core/price-feed';
import { deriveConfigPda, hexToBytes32 } from './pda';
import {
  buildPayInNativeInstruction,
  buildPayInTokenInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from './instructions';

const SOL_DECIMALS = 9;

/**
 * Configuration for the Solana pipeline. `programId` is the deployed
 * MerchantPayIn program ID (constant across all merchants). `merchantId` is
 * the 32-byte identifier used to derive the per-merchant config PDA.
 */
export interface SolanaPipelineConfig {
  /** Solana base58 program ID of the MerchantPayIn Anchor program. */
  programId: string;
  /** Per-merchant 32-byte identifier (hex string, with or without 0x prefix). */
  merchantId: string;
}

/** Compute the Associated Token Account address for (owner, mint). */
function getAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export class SolanaPaymentPipeline implements PaymentPipeline {
  readonly family = 'solana' as const;

  private readonly connection: Connection;
  private readonly wallet: WalletContextState;
  private readonly programId: PublicKey;
  private readonly merchantId: Uint8Array;

  constructor(
    connection: Connection,
    wallet: WalletContextState,
    config: SolanaPipelineConfig,
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = new PublicKey(config.programId);
    this.merchantId = hexToBytes32(config.merchantId);
  }

  async quoteAmount(
    usdAmount: number,
    chain: ChainConfig,
    token: TokenSelection,
  ): Promise<bigint> {
    if (token === NATIVE_TOKEN_SENTINEL) {
      const sol = await usdToNativeAmount(usdAmount, chain.chainId);
      return BigInt(Math.round(sol * 10 ** SOL_DECIMALS));
    }
    const tokenConfig = chain.tokens.find((t) => t.address === token);
    if (!tokenConfig) {
      throw new PaymentPipelineError(
        'unknown',
        `Token ${String(token)} not in Solana chain configuration`,
      );
    }
    const amount = usdToTokenAmount(usdAmount, tokenConfig.symbol);
    return BigInt(Math.round(amount * 10 ** tokenConfig.decimals));
  }

  needsApproval(): Promise<boolean> {
    // Solana has no approval step — the user signs the transfer directly.
    return Promise.resolve(false);
  }

  approve(): Promise<string> {
    throw new PaymentPipelineError(
      'unknown',
      'Solana pipeline has no approval step; this method should never be called.',
    );
  }

  async execute(
    _chain: ChainConfig,
    token: TokenSelection,
    amount: bigint,
  ): Promise<string> {
    if (!this.wallet.publicKey) {
      throw new PaymentPipelineError('user-rejected', 'Wallet not connected');
    }
    if (!this.wallet.sendTransaction) {
      throw new PaymentPipelineError(
        'unknown',
        'Wallet adapter does not expose sendTransaction',
      );
    }

    try {
      const tx = new Transaction();

      if (token === NATIVE_TOKEN_SENTINEL) {
        tx.add(
          buildPayInNativeInstruction(
            {
              programId: this.programId,
              merchantId: this.merchantId,
              sender: this.wallet.publicKey,
            },
            amount,
          ),
        );
      } else {
        const mint = new PublicKey(String(token));
        const senderAta = getAssociatedTokenAddress(this.wallet.publicKey, mint);
        // The config PDA owns the vault ATA.
        const [configPda] = deriveConfigPda(this.programId, this.merchantId);
        const vaultAta = getAssociatedTokenAddress(configPda, mint);

        tx.add(
          buildPayInTokenInstruction(
            {
              programId: this.programId,
              merchantId: this.merchantId,
              sender: this.wallet.publicKey,
              tokenMint: mint,
              senderTokenAccount: senderAta,
              vaultTokenAccount: vaultAta,
            },
            amount,
          ),
        );
      }

      const signature = await this.wallet.sendTransaction(tx, this.connection);
      return signature;
    } catch (err) {
      throw new PaymentPipelineError(
        classifyError(err),
        err instanceof Error ? err.message : 'Solana transaction failed',
        err,
      );
    }
  }

  async waitForReceipt(
    txHash: string,
    _confirmations?: number,
  ): Promise<PaymentReceipt> {
    try {
      // Solana's commitment levels: 'processed' | 'confirmed' | 'finalized'.
      // We use 'confirmed' for UX speed; high-value flows should use 'finalized'.
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
      const result = await this.connection.confirmTransaction(
        {
          signature: txHash,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      );

      if (result.value.err) {
        return { success: false, blockNumber: null, raw: result };
      }

      const parsed = await this.connection.getTransaction(txHash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return {
        success: true,
        blockNumber: parsed?.slot ?? null,
        raw: parsed ?? result,
      };
    } catch (err) {
      throw new PaymentPipelineError(
        classifyError(err),
        err instanceof Error ? err.message : 'Solana receipt wait failed',
        err,
      );
    }
  }
}

export type { Signer };
