/**
 * Payment references (MerchantPayIn V3.2.3).
 *
 * The gateway attributes an on-chain deposit to a payment request only when the pay-in call
 * carries that request's `paymentReference` — the bytes32 returned by the merchant backend's
 * `POST /api/payment/create`. The contract emits it as `PaymentReference(bytes32 indexed)` right
 * after the usual `PayIn*` event; the gateway links the pair, moves the request
 * `pending → processing → confirmed`, and sends `payment.confirmed` with the request's
 * `paymentRequestId` and `metadata`.
 *
 * A plain `payInNative()` / `payInToken()` still pays the merchant, but the deposit is attributed
 * to no request (no `paymentRequestId`, no `metadata` on the webhook), so the merchant cannot tell
 * which order or user it was for. That is why attribution is the default everywhere in the SDK and
 * the plain calls are an explicit opt-in (`mode: 'unattributed'`).
 *
 * The reference is public and attacker-choosable; it only *selects* a request. The gateway decides
 * whether the deposit can settle it (same merchant/storefront/network/asset, at least the amount).
 */

/** A 0x-prefixed 32-byte hex string. */
export type PaymentReference = `0x${string}`;

/**
 * - `'attributed'` (default): call `payIn*WithReference(paymentReference)`. Refuses to send — before
 *   any wallet prompt — when no reference was supplied.
 * - `'unattributed'`: call the plain `payIn*`. The deposit is detected and settled but linked to no
 *   payment request. Only for flows that genuinely have no order (tips, donations).
 */
export type PayInMode = 'attributed' | 'unattributed';

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

/** Thrown when attributed mode (the default) is asked to pay without a payment reference. */
export class MissingPaymentReferenceError extends Error {
  public readonly code = 'MissingPaymentReference' as const;
  constructor(
    message = 'Refusing to pay without a paymentReference: create the payment on your backend ' +
      '(POST /api/payment/create) and pass its paymentReference, or opt into mode: "unattributed".',
  ) {
    super(message);
    this.name = 'MissingPaymentReferenceError';
  }
}

/** Thrown when a supplied reference is not a non-zero bytes32, or contradicts the mode. */
export class InvalidPaymentReferenceError extends Error {
  public readonly code = 'InvalidPaymentReference' as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPaymentReferenceError';
  }
}

/** True for a 0x-prefixed, 64-hex-digit, non-zero value. */
export function isPaymentReference(value: unknown): value is PaymentReference {
  return typeof value === 'string' && BYTES32_RE.test(value) && value.toLowerCase() !== ZERO_BYTES32;
}

export function assertPaymentReference(value: unknown): asserts value is PaymentReference {
  if (!isPaymentReference(value)) {
    throw new InvalidPaymentReferenceError(
      'paymentReference must be the non-zero bytes32 (0x + 64 hex digits) returned by POST /api/payment/create.',
    );
  }
}

export type ResolvedAttribution =
  | { mode: 'attributed'; paymentReference: PaymentReference }
  | { mode: 'unattributed' };

/**
 * The one decision every pay path (React hook, headless controller, Web Component, modal) makes
 * before touching the wallet. Pure, so the policy is tested once.
 */
export function resolveAttribution(opts: {
  paymentReference?: string | null;
  mode?: PayInMode;
}): ResolvedAttribution {
  const mode = opts.mode ?? 'attributed';
  const ref = opts.paymentReference ?? undefined;
  if (mode === 'unattributed') {
    if (ref !== undefined) {
      throw new InvalidPaymentReferenceError(
        'mode "unattributed" was requested together with a paymentReference; drop one of them.',
      );
    }
    return { mode: 'unattributed' };
  }
  if (ref === undefined || ref === '') throw new MissingPaymentReferenceError();
  assertPaymentReference(ref);
  return { mode: 'attributed', paymentReference: ref };
}
