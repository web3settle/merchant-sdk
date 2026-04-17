// @vitest-environment node
// PDA derivation is pure crypto (sha256 over the raw seeds + program id). It
// has no DOM dependencies and runs identically in node + browser. Under
// jsdom, @solana/web3.js' seed-concatenation path occasionally fails the
// off-curve search due to a TextEncoder / Uint8Array identity quirk — so we
// pin this file to node.
import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  deriveConfigPda,
  deriveSolVaultPda,
  deriveTokenTotalsPda,
  hexToBytes32,
} from '../solana/pda';
import {
  buildPayInNativeInstruction,
  buildPayInTokenInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '../solana/instructions';

const TEST_PROGRAM = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
// Non-trivial merchant id. A zeroed id would collide with an on-curve point
// for some program/seed combinations and make PDA derivation fail.
const TEST_MERCHANT_ID = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);

describe('hexToBytes32', () => {
  it('accepts plain hex', () => {
    const bytes = hexToBytes32('00'.repeat(32));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it('accepts 0x-prefixed hex', () => {
    const bytes = hexToBytes32('0x' + 'ab'.repeat(32));
    expect(bytes[0]).toBe(0xab);
    expect(bytes[31]).toBe(0xab);
  });

  it('rejects shorter input', () => {
    expect(() => hexToBytes32('abcd')).toThrow(/32 bytes/);
  });

  it('rejects non-hex characters', () => {
    expect(() => hexToBytes32('zz'.repeat(32))).toThrow(/hex/);
  });
});

describe('derivePda', () => {
  it('derives a deterministic config PDA', () => {
    const [pda1, bump1] = deriveConfigPda(TEST_PROGRAM, TEST_MERCHANT_ID);
    const [pda2, bump2] = deriveConfigPda(TEST_PROGRAM, TEST_MERCHANT_ID);
    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  it('different merchant ids derive different PDAs', () => {
    const idA = new Uint8Array(32);
    idA[0] = 1;
    const [pdaA] = deriveConfigPda(TEST_PROGRAM, idA);
    const [pdaZero] = deriveConfigPda(TEST_PROGRAM, TEST_MERCHANT_ID);
    expect(pdaA.equals(pdaZero)).toBe(false);
  });

  it('sol vault PDA depends on config PDA', () => {
    const [configPda] = deriveConfigPda(TEST_PROGRAM, TEST_MERCHANT_ID);
    const [vaultPda] = deriveSolVaultPda(TEST_PROGRAM, configPda);
    expect(vaultPda.equals(configPda)).toBe(false);
  });

  it('token totals PDA varies per mint', () => {
    const [configPda] = deriveConfigPda(TEST_PROGRAM, TEST_MERCHANT_ID);
    const mintA = new PublicKey('So11111111111111111111111111111111111111112');
    const mintB = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const [pdaA] = deriveTokenTotalsPda(TEST_PROGRAM, configPda, mintA);
    const [pdaB] = deriveTokenTotalsPda(TEST_PROGRAM, configPda, mintB);
    expect(pdaA.equals(pdaB)).toBe(false);
  });

  it('rejects merchant ids that are not exactly 32 bytes', () => {
    const short = new Uint8Array(10);
    expect(() => deriveConfigPda(TEST_PROGRAM, short)).toThrow(/32 bytes/);
  });
});

describe('buildPayInNativeInstruction', () => {
  it('builds an instruction with the correct program + account shape', () => {
    const sender = new PublicKey('11111111111111111111111111111112');
    const ix = buildPayInNativeInstruction(
      { programId: TEST_PROGRAM, merchantId: TEST_MERCHANT_ID, sender },
      1_000_000_000n,
    );
    expect(ix.programId.equals(TEST_PROGRAM)).toBe(true);
    expect(ix.keys).toHaveLength(4);
    expect(ix.keys[0]?.pubkey.equals(sender)).toBe(true);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[3]?.pubkey.equals(SystemProgram.programId)).toBe(true);
  });

  it('encodes the amount as a little-endian u64 after the 8-byte discriminator', () => {
    const sender = new PublicKey('11111111111111111111111111111112');
    const amount = 0x0102030405060708n;
    const ix = buildPayInNativeInstruction(
      { programId: TEST_PROGRAM, merchantId: TEST_MERCHANT_ID, sender },
      amount,
    );
    // Bytes 0-7 are the discriminator; 8-15 are the u64 LE.
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    expect(view.getBigUint64(8, true)).toBe(amount);
  });
});

describe('buildPayInTokenInstruction', () => {
  it('includes the SPL and associated-token programs in the account list', () => {
    const sender = new PublicKey('11111111111111111111111111111112');
    const mint = new PublicKey('So11111111111111111111111111111111111111112');
    const senderAta = new PublicKey('11111111111111111111111111111113');
    const vaultAta = new PublicKey('11111111111111111111111111111114');

    const ix = buildPayInTokenInstruction(
      {
        programId: TEST_PROGRAM,
        merchantId: TEST_MERCHANT_ID,
        sender,
        tokenMint: mint,
        senderTokenAccount: senderAta,
        vaultTokenAccount: vaultAta,
      },
      100n,
    );

    const programs = ix.keys.map((k) => k.pubkey.toBase58());
    expect(programs).toContain(TOKEN_PROGRAM_ID.toBase58());
    expect(programs).toContain(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  });
});
