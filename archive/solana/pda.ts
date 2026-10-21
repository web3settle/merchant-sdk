import { PublicKey } from '@solana/web3.js';

/**
 * PDA derivation for the MerchantPayIn Anchor program.
 *
 * Seeds mirror the program's Rust code 1:1. If you change a seed in the
 * contract, you must change it here too — they must stay in sync.
 *
 * Note: `findProgramAddressSync` takes `Buffer | Uint8Array`. jsdom (used by
 * Vitest) swaps the global `TextEncoder` for one whose output isn't a true
 * `Uint8Array` subclass in every build — which makes web3.js' internal seed
 * concatenation produce garbage bytes and the nonce search fail. We normalise
 * every seed through a fresh `Uint8Array` copy to sidestep that.
 */

function asSeed(bytes: Uint8Array | Buffer | ArrayBufferView): Uint8Array {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  const out = new Uint8Array(view.length);
  out.set(view);
  return out;
}

function seedFromString(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  return asSeed(encoded);
}

/** Seeds: ["merchant_config", merchant_id]. */
export function deriveConfigPda(
  programId: PublicKey,
  merchantId: Uint8Array,
): [PublicKey, number] {
  if (merchantId.length !== 32) {
    throw new Error('merchantId must be 32 bytes');
  }
  return PublicKey.findProgramAddressSync(
    [seedFromString('merchant_config'), asSeed(merchantId)],
    programId,
  );
}

/** Seeds: ["sol_vault", config.key()]. */
export function deriveSolVaultPda(
  programId: PublicKey,
  configPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [seedFromString('sol_vault'), asSeed(configPda.toBytes())],
    programId,
  );
}

/** Seeds: ["token_totals", config.key(), mint.key()]. */
export function deriveTokenTotalsPda(
  programId: PublicKey,
  configPda: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      seedFromString('token_totals'),
      asSeed(configPda.toBytes()),
      asSeed(mint.toBytes()),
    ],
    programId,
  );
}

/** Hex string ("0x..." or plain) → 32-byte Uint8Array. Throws on invalid length. */
export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(`merchantId must be 32 bytes / 64 hex chars; got ${clean.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`Invalid hex character near position ${i * 2}`);
    out[i] = byte;
  }
  return out;
}
