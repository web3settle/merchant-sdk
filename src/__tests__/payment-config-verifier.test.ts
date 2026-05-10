import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { canonicalJson } from '../core/canonical-json';
import { verifyPaymentConfig } from '../core/payment-config-verifier';
import { PAYMENT_CONFIG_MAX_AGE_MS } from '../core/config';

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function newKeypair(): { priv: Uint8Array; pub: string } {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = bytesToHex(ed25519.getPublicKey(priv));
  return { priv, pub };
}

const DATA = {
  storefrontId: '550e8400-e29b-41d4-a716-446655440000',
  contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  commissionBps: 250,
};

function sign(priv: Uint8Array, data: unknown, signedAt: string): string {
  const message = new TextEncoder().encode(signedAt + canonicalJson(data));
  return bytesToHex(ed25519.sign(message, priv));
}

describe('verifyPaymentConfig (premortem F2)', () => {
  it('accepts a fresh, signature-valid payload', () => {
    const { priv, pub } = newKeypair();
    const signedAt = new Date().toISOString();
    const signature = sign(priv, DATA, signedAt);
    const out = verifyPaymentConfig({
      data: DATA,
      signed_at: signedAt,
      signature,
      trustedKeysOverride: { primary: pub, secondary: '' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.matchedKey).toBe(pub);
  });

  it('rejects when the data is tampered (contractAddress swapped)', () => {
    const { priv, pub } = newKeypair();
    const signedAt = new Date().toISOString();
    const signature = sign(priv, DATA, signedAt);
    const tampered = { ...DATA, contractAddress: '0xATTACKER' };
    const out = verifyPaymentConfig({
      data: tampered,
      signed_at: signedAt,
      signature,
      trustedKeysOverride: { primary: pub, secondary: '' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('signature-invalid');
  });

  it('rejects a payload signed more than 5 minutes ago', () => {
    const { priv, pub } = newKeypair();
    const signedAt = new Date(Date.now() - PAYMENT_CONFIG_MAX_AGE_MS - 1000).toISOString();
    const signature = sign(priv, DATA, signedAt);
    const out = verifyPaymentConfig({
      data: DATA,
      signed_at: signedAt,
      signature,
      trustedKeysOverride: { primary: pub, secondary: '' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('signed-at-stale');
  });

  it('accepts a payload signed by the secondary key during rotation overlap', () => {
    const { priv, pub } = newKeypair();
    const otherPub = newKeypair().pub;
    const signedAt = new Date().toISOString();
    const signature = sign(priv, DATA, signedAt);
    // Primary is some other key; secondary is the one we signed with.
    const out = verifyPaymentConfig({
      data: DATA,
      signed_at: signedAt,
      signature,
      trustedKeysOverride: { primary: otherPub, secondary: pub },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.matchedKey).toBe(pub);
  });

  it('rejects when neither baked-in key matches', () => {
    const { priv } = newKeypair();
    const otherPub1 = newKeypair().pub;
    const otherPub2 = newKeypair().pub;
    const signedAt = new Date().toISOString();
    const signature = sign(priv, DATA, signedAt);
    const out = verifyPaymentConfig({
      data: DATA,
      signed_at: signedAt,
      signature,
      trustedKeysOverride: { primary: otherPub1, secondary: otherPub2 },
    });
    expect(out.ok).toBe(false);
  });

  it('rejects malformed signatures (wrong length, non-hex)', () => {
    const out1 = verifyPaymentConfig({
      data: DATA,
      signed_at: new Date().toISOString(),
      signature: 'abc',
    });
    expect(out1.ok).toBe(false);
    if (!out1.ok) expect(out1.reason).toBe('malformed-signature');

    const out2 = verifyPaymentConfig({
      data: DATA,
      signed_at: new Date().toISOString(),
      signature: 'g'.repeat(128),
    });
    expect(out2.ok).toBe(false);
  });
});

describe('canonicalJson key-order stability', () => {
  it('produces identical encoding for permuted keys', () => {
    const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
    const b = { a: 2, z: 1, m: { x: 2, y: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
