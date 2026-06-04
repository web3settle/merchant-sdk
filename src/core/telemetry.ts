/**
 * Telemetry breadcrumbs for payment failures.
 *
 * Closes a real operational gap: when a customer's pay-in fails on EVM, Solana,
 * or TRON, the merchant currently has no visibility into _why_. We surface a
 * single, opt-in callback the merchant can wire to their own analytics
 * (Sentry, PostHog, Datadog, Segment, plain console). The SDK never phones
 * home — emission is purely synchronous, and the callback is the merchant's
 * problem to make async/durable.
 *
 * **Privacy contract.**
 * Events do **not** carry PII or financial detail:
 *   - no plain wallet address (only an opaque hash digest);
 *   - no payment amount or token symbol;
 *   - no transaction payload or signed message.
 * Anything more granular belongs in the merchant's own server-side trail, where
 * they already own the user identity. This SDK is on the customer's device — we
 * stay strict by default.
 */
import type { PaymentErrorKind } from './pipeline';

/** Chain family the telemetry event came from. Mirrors `PaymentFamily`. */
export type TelemetryChain = 'evm' | 'solana' | 'tron';

/** Payment-flow phases at which a failure can surface. */
export type TelemetryPhase =
  | 'connect'
  | 'switch-network'
  | 'quote'
  | 'approve'
  | 'permit'
  | 'estimate-gas'
  | 'send'
  | 'confirm';

/**
 * A single failure breadcrumb. Field names use SDK terminology, not the
 * underlying chain SDK's — so a Solana wallet-reject and an EVM user-reject
 * both surface the same `errorCode: 'user-rejected'`.
 */
export interface TelemetryEvent {
  /** Chain family the failure originated on. */
  chain: TelemetryChain;
  /** Phase of the pay-in flow that triggered it. Useful for grouping. */
  phase: TelemetryPhase;
  /** Stable error category — the same enum the pipelines classify on. */
  errorCode: PaymentErrorKind;
  /**
   * Wallet provider identifier reported by the connector (e.g. `"injected"`,
   * `"walletConnect"`, `"phantom"`, `"tronlink"`). Free-form string — keep it
   * stable enough to bucket on the merchant's analytics dashboard but never
   * include the address.
   */
  walletId?: string;
  /**
   * On-chain MerchantPayIn contract version, when known. Allows the merchant
   * to spot regressions caused by a contract upgrade. Free-form so we can
   * version EVM (`"3.1.0"`), TRON, and Solana program with different schemes.
   */
  contractVersion?: string;
  /** Unix epoch milliseconds at the moment the breadcrumb is built. */
  timestamp: number;
  /**
   * Opaque, deterministic digest of the connected address — letting merchants
   * group failures by user without ever seeing the actual address. SHA-256 or
   * a 16-char hex prefix is fine. Empty when no wallet was connected yet.
   */
  walletDigest?: string;
  /**
   * Free-text developer hint with the underlying error message after PII
   * redaction. The SDK truncates to 240 chars and strips anything that looks
   * like a 0x address, base58 pubkey, or UUID. Optional; merchants who don't
   * want any free text at all can ignore it.
   */
  message?: string;
}

/**
 * Optional callback the merchant supplies. Synchronous: the SDK does not await
 * this — if the merchant wants to ship to a server they must promise-wrap.
 * Throwing or rejecting from this callback must NEVER break the pay-in flow,
 * so all internal callers wrap it in `safeEmit()`.
 */
export type TelemetryCallback = (event: TelemetryEvent) => void;

/**
 * Wrap a callback invocation so a buggy merchant analytics handler can never
 * propagate into the payment code path. We swallow + warn (once).
 */
let warnedOnce = false;
export function safeEmit(
  callback: TelemetryCallback | undefined,
  event: TelemetryEvent,
): void {
  if (!callback) return;
  try {
    callback(event);
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        '[Web3Settle] telemetry callback threw — subsequent throws will be silenced.',
        err,
      );
    }
  }
}

/**
 * Hash a wallet address into a non-reversible 16-char hex digest using
 * SubtleCrypto, salted by storefrontId and the UTC day. Fallback to a short
 * FNV-1a-style hash when SubtleCrypto isn't available (older Node/JSDOM
 * contexts in tests). Always returns a string when the address is present.
 *
 * **Why salting (premortem F8).** A 64-bit truncated SHA-256 of the raw
 * address is reversible against a small known userbase: an analyst with the
 * shop's user list can rebuild the digest table and unmask wallets. The
 * `(storefrontId, day)` salt re-keys the digest space per day per shop:
 *   - Two shops of the same wallet get distinct digests → no cross-shop join.
 *   - The same shop on different days gets distinct digests → analytics still
 *     buckets a user across a day, but a leaked dataset can't be cross-day-
 *     linked without the salt.
 *
 * Pass {@link todayUtc} to compute the day key the SDK uses internally.
 */
export async function hashWalletAddress(
  address: string | null | undefined,
  storefrontId?: string,
  dayUtc?: string,
): Promise<string | undefined> {
  if (!address) return undefined;
  const salt = `${storefrontId ?? ''}:${dayUtc ?? ''}:`;
  const input = `${salt}${address.toLowerCase()}`;
  // Best path: SubtleCrypto SHA-256 → first 16 hex chars.
  if (typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function') {
    try {
      const data = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const bytes = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < 8; i += 1) {
        hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
      }
      return hex;
    } catch {
      // fall through
    }
  }
  // Fallback: deterministic but weaker. Only for environments without SubtleCrypto.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Day key for the wallet-digest salt. UTC `YYYY-MM-DD` so two SDK instances
 * in different time zones agree on the bucket.
 */
export function todayUtc(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Strip values that look like wallet addresses, pubkeys, UUIDs, filesystem
 * paths, or long secrets from a developer error message. Keeps the message
 * under 240 chars.
 *
 * The redaction list reflects what we've seen leak through `Error.message` /
 * `Error.stack` in browser & Node SDKs:
 *   - EVM addresses + tx hashes (caller's wallet, our contract), incl. a
 *     bare 0x-less 40-hex address token.
 *   - UUIDs (session ids).
 *   - Solana / TRON base58 (caller's wallet), incl. a lone base58 token.
 *   - Absolute filesystem paths from stack traces (`/Users/`, `/home/`,
 *     `C:\`, `file://`) — these reveal username and source-file layout when
 *     the integrator pipes the message into a 3rd-party analytics pipeline.
 *   - Long unbroken hex blobs (≥64 chars) — catches private keys, raw
 *     signatures, or session tokens that occasionally surface in nested
 *     wallet errors.
 */
export function redactErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  let safe = message
    // EVM 0x-addresses (40 hex chars)
    .replace(/0x[a-fA-F0-9]{40}/g, '0x<redacted>')
    // EVM tx hashes (64 hex chars)
    .replace(/0x[a-fA-F0-9]{64}/g, '0x<redacted>')
    // Bare 40-hex address token (an 0x-less EVM address that slipped through a
    // nested wallet error). Word-boundary anchored to *exactly* 40 hex chars:
    // the trailing `\b` fails to match when a 41st hex char follows, so this
    // never bites into a 64-char tx-hash / private-key run (those are handled
    // by the rules above and the long-hex rule below).
    .replace(/\b[a-fA-F0-9]{40}\b/g, '<redacted>')
    // UUID-shaped strings
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '<uuid>')
    // POSIX absolute paths (`/Users/alice/...`, `/home/bob/...`, `/private/tmp/...`).
    // Catches stack-trace fragments that leak the integrator's username.
    .replace(/\/(?:Users|home|root|private|var|opt|srv|tmp)\/[^\s)"']+/gi, '<path>')
    // Windows-style absolute paths (`C:\Users\...`).
    .replace(/[A-Za-z]:\\[^\s)"']+/g, '<path>')
    // file:// URLs from JS stack traces.
    .replace(/file:\/\/[^\s)"']+/g, '<path>')
    // Long bare hex blobs (≥64 chars). Catches private keys, raw 65-byte
    // signatures, and session-token-shaped strings nested inside wallet
    // error messages. The 64-char floor avoids false positives on shorter
    // identifiers.
    .replace(/(?:0x)?[a-fA-F0-9]{64,}/g, '<hex>')
    // Solana / TRON base58 (26–44 chars, no 0/O/I/l) — only redact when the
    // substring is a standalone token (whitespace/punct bounded), so we stay
    // conservative on free text. Floor lowered from 32 to 26 so a lone base58
    // wallet token (incl. shorter TRON-style / truncated pubkeys) is redacted
    // when it stands alone, while still being far longer than any ordinary
    // English word.
    .replace(/(^|\s)[1-9A-HJ-NP-Za-km-z]{26,44}(?=\s|[,.;:]|$)/g, '$1<addr>');
  if (safe.length > 240) safe = `${safe.slice(0, 237)}...`;
  return safe;
}

/**
 * Build a `TelemetryEvent` from a thrown error + payment context. `errorCode`
 * uses the same `PaymentErrorKind` enum the pipelines emit, so merchants
 * filter on a stable schema.
 */
export interface BuildEventInput {
  chain: TelemetryChain;
  phase: TelemetryPhase;
  errorCode: PaymentErrorKind;
  walletId?: string;
  contractVersion?: string;
  walletDigest?: string;
  rawMessage?: string;
}

export function buildTelemetryEvent(input: BuildEventInput): TelemetryEvent {
  return {
    chain: input.chain,
    phase: input.phase,
    errorCode: input.errorCode,
    walletId: input.walletId,
    contractVersion: input.contractVersion,
    timestamp: Date.now(),
    walletDigest: input.walletDigest,
    message: redactErrorMessage(input.rawMessage),
  };
}
