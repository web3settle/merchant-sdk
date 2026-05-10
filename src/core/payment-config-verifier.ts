/**
 * Cryptographic provenance for the payment-config payload (premortem F2).
 *
 * The SDK fetches `/api/storefronts/{id}/payment-config` from the customer's
 * browser and uses the returned `contractAddress` verbatim when building the
 * on-chain transaction. Without a signature, a poisoned-DNS or CDN-edge MITM
 * can substitute a clone of MerchantPayIn — Zod-shape passes, the user signs
 * against the attacker contract, and the funds are unrecoverable.
 *
 * This module verifies the wrapper `{ data, signed_at, signature }` against
 * the SDK's baked-in Ed25519 public keys. Both the primary and secondary keys
 * are tried so an in-flight rotation does not break customers who happen to
 * fetch a payload signed seconds before the swap.
 *
 * The signature input format **must match** the backend's
 * `MerchantPaymentApi.Authentication.PaymentConfigSigner.Sign`:
 *     `signed_at_iso8601 + canonical_json(data)`.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { canonicalJson } from './canonical-json';
import {
  PAYMENT_CONFIG_MAX_AGE_MS,
  WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY,
  WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_SECONDARY,
} from './config';

/** Reasons the SDK refuses a signed payload. */
export type PaymentConfigVerifyFailure =
  | 'missing-signature'
  | 'malformed-signature'
  | 'signature-invalid'
  | 'signed-at-stale'
  | 'signed-at-malformed'
  | 'no-trusted-key';

export interface PaymentConfigVerifyOk {
  ok: true;
  /** Hex pubkey that successfully verified the signature (primary or secondary). */
  matchedKey: string;
}

export interface PaymentConfigVerifyErr {
  ok: false;
  reason: PaymentConfigVerifyFailure;
  /** Free-form developer hint. Suitable for telemetry — never includes raw payload. */
  detail?: string;
}

export type PaymentConfigVerifyResult = PaymentConfigVerifyOk | PaymentConfigVerifyErr;

/**
 * Trusted-key set the SDK is willing to verify against. Defaults to the
 * baked-in primary + secondary; overridable in tests.
 */
function trustedKeys(override?: { primary?: string; secondary?: string }): string[] {
  const primary = override?.primary ?? WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY;
  const secondary = override?.secondary ?? WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_SECONDARY;
  return [primary, secondary].filter((k): k is string => Boolean(k && k.length === 64));
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export interface VerifyInput {
  data: unknown;
  signed_at: string;
  signature: string;
  /** Optional override for testing. */
  now?: number;
  /** Optional override for testing. */
  trustedKeysOverride?: { primary?: string; secondary?: string };
}

/**
 * Verify the wrapper. Returns `{ ok: true }` only when:
 *   - the signature is a 128-char hex string,
 *   - the signature verifies against either the primary or secondary baked-in pubkey,
 *   - `signed_at` parses to a UTC timestamp within
 *     {@link PAYMENT_CONFIG_MAX_AGE_MS} of `now` (replay defense).
 *
 * The function is sync — it does not phone home to the well-known endpoint.
 * The well-known endpoint exists for out-of-band drift detection only; the
 * baked-in constant is the trust anchor.
 */
export function verifyPaymentConfig(input: VerifyInput): PaymentConfigVerifyResult {
  if (!input.signature) {
    return { ok: false, reason: 'missing-signature' };
  }
  if (input.signature.length !== 128) {
    return { ok: false, reason: 'malformed-signature', detail: `expected 128 hex chars, got ${input.signature.length}` };
  }
  const sigBytes = hexToBytes(input.signature);
  if (!sigBytes) {
    return { ok: false, reason: 'malformed-signature', detail: 'signature not hex' };
  }

  // signed_at freshness — defends against replay of an old (but legitimately-
  // signed) payload after a contract migration.
  const signedAtMs = Date.parse(input.signed_at);
  if (Number.isNaN(signedAtMs)) {
    return { ok: false, reason: 'signed-at-malformed', detail: input.signed_at.slice(0, 32) };
  }
  const now = input.now ?? Date.now();
  // Allow up to 60s of clock skew on the future side too — clients with skewed
  // clocks shouldn't be locked out of legitimate payloads.
  const ageMs = now - signedAtMs;
  if (ageMs > PAYMENT_CONFIG_MAX_AGE_MS) {
    return { ok: false, reason: 'signed-at-stale', detail: `${Math.round(ageMs / 1000)}s old` };
  }
  if (ageMs < -60_000) {
    return { ok: false, reason: 'signed-at-stale', detail: 'future-dated' };
  }

  const message = new TextEncoder().encode(input.signed_at + canonicalJson(input.data));
  const keys = trustedKeys(input.trustedKeysOverride);
  if (keys.length === 0) {
    return { ok: false, reason: 'no-trusted-key' };
  }
  for (const key of keys) {
    const pubBytes = hexToBytes(key);
    if (!pubBytes || pubBytes.length !== 32) continue;
    try {
      if (ed25519.verify(sigBytes, message, pubBytes)) {
        return { ok: true, matchedKey: key };
      }
    } catch {
      // Bad signature shape relative to this pubkey — try the next.
    }
  }
  return { ok: false, reason: 'signature-invalid' };
}
