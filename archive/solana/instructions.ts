import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  deriveConfigPda,
  deriveSolVaultPda,
  deriveTokenTotalsPda,
} from './pda';

/**
 * Hand-rolled instruction builders for the MerchantPayIn Anchor program.
 *
 * We intentionally avoid bundling the full Anchor runtime (`@coral-xyz/anchor`)
 * — it pulls ~200kB of IDL machinery the SDK doesn't need for two instructions.
 * The discriminators below are Anchor's standard `sha256("global:<snake_name>")[:8]`.
 */

/** Anchor discriminator for `global:pay_in_native`. */
const PAY_IN_NATIVE_DISCRIMINATOR = new Uint8Array([
  0xe4, 0xa7, 0x94, 0x4a, 0x32, 0xa0, 0x4b, 0x91,
]);

/** Anchor discriminator for `global:pay_in_token`. */
const PAY_IN_TOKEN_DISCRIMINATOR = new Uint8Array([
  0xba, 0x77, 0x38, 0x90, 0x1b, 0x0e, 0xdb, 0xc5,
]);

/** SPL Token program ID. */
export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

/** SPL Associated Token program ID. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** Encode a u64 little-endian. */
function u64LE(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, value, true);
  return out;
}

/** Concat fragments into a single Uint8Array. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface PayInNativeAccounts {
  programId: PublicKey;
  merchantId: Uint8Array;
  sender: PublicKey;
}

/** Build the `pay_in_native` instruction. */
export function buildPayInNativeInstruction(
  accounts: PayInNativeAccounts,
  amountLamports: bigint,
): TransactionInstruction {
  const [configPda] = deriveConfigPda(accounts.programId, accounts.merchantId);
  const [solVaultPda] = deriveSolVaultPda(accounts.programId, configPda);

  const data = concat(PAY_IN_NATIVE_DISCRIMINATOR, u64LE(amountLamports));

  return new TransactionInstruction({
    programId: accounts.programId,
    keys: [
      { pubkey: accounts.sender, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export interface PayInTokenAccounts {
  programId: PublicKey;
  merchantId: Uint8Array;
  sender: PublicKey;
  tokenMint: PublicKey;
  senderTokenAccount: PublicKey;
  vaultTokenAccount: PublicKey;
}

/** Build the `pay_in_token` instruction. */
export function buildPayInTokenInstruction(
  accounts: PayInTokenAccounts,
  amountRaw: bigint,
): TransactionInstruction {
  const [configPda] = deriveConfigPda(accounts.programId, accounts.merchantId);
  const [tokenTotalsPda] = deriveTokenTotalsPda(
    accounts.programId,
    configPda,
    accounts.tokenMint,
  );

  const data = concat(PAY_IN_TOKEN_DISCRIMINATOR, u64LE(amountRaw));

  return new TransactionInstruction({
    programId: accounts.programId,
    keys: [
      { pubkey: accounts.sender, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
      { pubkey: accounts.senderTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenTotalsPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
