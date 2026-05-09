/**
 * Solana fee estimator (item 14.1).
 *
 * Solana's "gas" model is two pieces: a fixed signature fee (5 000 lamports
 * per signature, hard-coded by the runtime) plus an optional priority fee in
 * micro-lamports per compute unit. We:
 *   1. simulate the transaction to learn how many compute units it actually
 *      uses (`simulateTransaction.unitsConsumed`);
 *   2. ask the cluster for recent priority fees and take a prudent median;
 *   3. add the static signature fee.
 *
 * The total is returned in lamports plus an optional USD conversion via the
 * caller-supplied price oracle.
 */
import {
  type Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  buildPayInNativeInstruction,
  buildPayInTokenInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from './instructions';
import { deriveConfigPda, hexToBytes32 } from './pda';
import { NATIVE_TOKEN_SENTINEL, type TokenSelection } from '../core/types';
import type {
  GasEstimate,
  SolanaGasBreakdown,
  FeeOracleOptions,
} from '../evm/estimateGas';

/** Lamports the cluster charges per signature. Static. */
export const LAMPORTS_PER_SIGNATURE = 5_000;
/** Solana native decimals. */
const SOL_DECIMALS = 9;
/** Default ceiling for compute units when simulation can't tell us. */
const DEFAULT_COMPUTE_UNITS = 200_000;

export interface EstimateSolanaGasInput {
  /** Connected web3.js connection. */
  connection: Connection;
  /** Sender pubkey (the customer's wallet). */
  sender: PublicKey;
  /** MerchantPayIn program ID. */
  programId: PublicKey;
  /** Per-merchant 32-byte identifier (hex string with or without 0x). */
  merchantId: string;
  /** `"native"` for SOL pay-in, or the SPL mint address. */
  token: TokenSelection;
  /** Amount in smallest unit (lamports for native, raw decimals for SPL). */
  amount: bigint;
  /** SPL token mint when `token !== "native"`. Optional shortcut for tests. */
  tokenMint?: PublicKey;
}

/** Compute the Associated Token Account address for (owner, mint). */
function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/**
 * Simulate the pay-in tx to read `unitsConsumed`, then add a priority fee from
 * `getRecentPrioritizationFees`. Returns lamports + breakdown + USD.
 */
export async function estimateSolanaGas(
  input: EstimateSolanaGasInput,
  fee: FeeOracleOptions = {},
): Promise<GasEstimate> {
  const merchantBytes = hexToBytes32(input.merchantId);

  // Build the same instruction the pipeline would submit.
  let ix: TransactionInstruction;
  if (input.token === NATIVE_TOKEN_SENTINEL) {
    ix = buildPayInNativeInstruction(
      {
        programId: input.programId,
        merchantId: merchantBytes,
        sender: input.sender,
      },
      input.amount,
    );
  } else {
    const mint = input.tokenMint ?? new PublicKey(String(input.token));
    const senderAta = getAssociatedTokenAddress(input.sender, mint);
    const [configPda] = deriveConfigPda(input.programId, merchantBytes);
    const vaultAta = getAssociatedTokenAddress(configPda, mint);
    ix = buildPayInTokenInstruction(
      {
        programId: input.programId,
        merchantId: merchantBytes,
        sender: input.sender,
        tokenMint: mint,
        senderTokenAccount: senderAta,
        vaultTokenAccount: vaultAta,
      },
      input.amount,
    );
  }

  // 1. Compute units via simulation. Some endpoints disallow `replaceRecentBlockhash`
  //    — we call it best-effort, fall back to the default.
  let computeUnits = DEFAULT_COMPUTE_UNITS;
  try {
    const tx = new Transaction().add(ix);
    tx.feePayer = input.sender;
    // Avoid hitting the chain for a real blockhash here: simulateTransaction
    // accepts a recent blockhash from the cluster, but for a CU read we can use
    // a placeholder when the connection supports `replaceRecentBlockhash`.
    const { blockhash } = await input.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    const sim = await input.connection.simulateTransaction(tx, undefined);
    const consumed = sim.value.unitsConsumed;
    if (typeof consumed === 'number' && consumed > 0) {
      computeUnits = consumed;
    }
  } catch {
    // Keep DEFAULT_COMPUTE_UNITS — surface a conservative estimate.
  }

  // 2. Median priority fee across recent blocks. Returns micro-lamports per CU.
  let microLamportsPerCu = 0;
  try {
    const recent = await input.connection.getRecentPrioritizationFees();
    if (Array.isArray(recent) && recent.length > 0) {
      // Median is more robust to spikes than mean.
      const sorted = [...recent]
        .map((r) => Number(r.prioritizationFee ?? 0))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
      if (sorted.length > 0) {
        microLamportsPerCu = sorted[Math.floor(sorted.length / 2)] ?? 0;
      }
    }
  } catch {
    // Networks that don't support the RPC just skip priority — base fee still applies.
  }

  // 3. Total lamports = base + (priority µLAM/CU × CU) / 1e6.
  const priorityLamports = Math.ceil((microLamportsPerCu * computeUnits) / 1_000_000);
  const totalLamports = LAMPORTS_PER_SIGNATURE + priorityLamports;

  const usd = await convertLamportsToUsd(totalLamports, fee);

  const breakdown: SolanaGasBreakdown = {
    family: 'solana',
    computeUnits,
    microLamportsPerCu,
    baseLamports: LAMPORTS_PER_SIGNATURE,
  };

  return {
    native: totalLamports,
    usd,
    breakdown,
  };
}

async function convertLamportsToUsd(
  lamports: number,
  fee: FeeOracleOptions,
): Promise<number | null> {
  let priceUsd = fee.priceUsd;
  if (priceUsd === undefined && fee.fetchPriceUsd) {
    try {
      priceUsd = await fee.fetchPriceUsd(fee.signal);
    } catch {
      return null;
    }
  }
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  const sol = lamports / 10 ** SOL_DECIMALS;
  return sol * priceUsd;
}

/**
 * Simulate-only variant exposed for tests: returns just the compute-unit count
 * without the priority/network round-trip. Lets tests assert builder shape
 * without mocking the whole connection.
 */
export function buildSolanaEstimateInstruction(
  input: EstimateSolanaGasInput,
): TransactionInstruction {
  const merchantBytes = hexToBytes32(input.merchantId);
  if (input.token === NATIVE_TOKEN_SENTINEL) {
    return buildPayInNativeInstruction(
      {
        programId: input.programId,
        merchantId: merchantBytes,
        sender: input.sender,
      },
      input.amount,
    );
  }
  const mint = input.tokenMint ?? new PublicKey(String(input.token));
  const senderAta = getAssociatedTokenAddress(input.sender, mint);
  const [configPda] = deriveConfigPda(input.programId, merchantBytes);
  const vaultAta = getAssociatedTokenAddress(configPda, mint);
  return buildPayInTokenInstruction(
    {
      programId: input.programId,
      merchantId: merchantBytes,
      sender: input.sender,
      tokenMint: mint,
      senderTokenAccount: senderAta,
      vaultTokenAccount: vaultAta,
    },
    input.amount,
  );
}
