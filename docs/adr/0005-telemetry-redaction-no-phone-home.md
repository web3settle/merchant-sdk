# ADR-0005: Telemetry is opt-in, never phones home, and redacts PII/secrets before emission

**Status:** Accepted

## Context

When a customer's pay-in fails on EVM / Solana / TRON, the merchant otherwise has
no visibility into *why* (user rejected? wrong network? gas? RPC down?). The SDK
needs a failure-breadcrumb mechanism — but it runs **in the end customer's
browser**, on the customer's device, holding their wallet address and live error
objects from wallet/RPC stacks.

That environment makes a careless telemetry design a **privacy and secret-leak
hazard**:

- A breadcrumb that includes the **wallet address** lets the merchant (or
  whatever third-party analytics they pipe it to) build a profile of an
  individual's on-chain activity — PII the SDK has no business exporting from the
  user's device by default.
- Raw `Error.message` / `Error.stack` from wallet and RPC libraries routinely
  carry **addresses, tx hashes, base58 pubkeys, session UUIDs, absolute
  filesystem paths** (leaking the integrator's username/source layout), and
  occasionally **long hex blobs that could be keys or raw signatures**. Forwarded
  verbatim into a logging pipeline, these become a durable leak.
- A naive "hash the address" is **reversible against a small known userbase**: an
  analyst with the shop's customer list can rebuild the digest table and unmask
  wallets (premortem **F8**).
- An SDK that **auto-uploads** telemetry from the customer's device to a vendor
  endpoint creates a tracking + compliance surface the merchant never opted into.

## Decision

**Telemetry is opt-in, strictly local, and aggressively redacted. The SDK never
transmits anything off-device on its own.**

Implemented in [src/core/telemetry.ts](../../src/core/telemetry.ts):

- **No phone-home.** Emission is a single **synchronous callback** the merchant
  optionally supplies (`TelemetryCallback`). The SDK never awaits it and never
  makes a network call of its own; shipping events to a server (Sentry/PostHog/…)
  is entirely the merchant's choice and code. If no callback is supplied, nothing
  is emitted.
- **Schema carries no PII / financial detail by construction.** A `TelemetryEvent`
  has `chain`, `phase`, a stable `errorCode`, optional `walletId` (provider name
  like `"phantom"`, never the address), optional `contractVersion`, a timestamp,
  an **opaque `walletDigest`**, and an optional redacted `message`. There is
  deliberately **no field** for the raw address, payment amount, token symbol, or
  signed payload.
- **Salted, non-reversible wallet digest.** `hashWalletAddress()` produces a
  16-char digest salted by `(storefrontId, UTC-day)` via SubtleCrypto SHA-256
  (with a weaker FNV-1a fallback only where SubtleCrypto is absent, e.g. old
  Node/JSDOM). The salt re-keys the digest space per shop per day, so the same
  wallet yields **different digests across shops and across days** — defeating the
  rebuild-the-table deanonymization (F8) while still letting a merchant bucket a
  user *within* one day.
- **Defensive message redaction.** `redactErrorMessage()` strips, before the
  message ever leaves the SDK: 0x addresses & tx hashes (incl. a bare 40-hex
  token), UUIDs, Solana/TRON base58 tokens, POSIX/Windows/`file://` absolute
  paths, and long (≥64-char) hex blobs (keys/raw signatures); then truncates to
  **240 chars**. The redaction list is documented in-code as "what we've actually
  seen leak through wallet/RPC errors."
- **Telemetry can never break payments.** `safeEmit()` wraps the callback so a
  throwing merchant handler is swallowed (warn-once) and never propagates into
  the pay-in path.

The principle: **this SDK is on someone else's device, so it stays strict by
default — anything finer-grained than an anonymized breadcrumb belongs in the
merchant's own server-side trail, where they already own the user identity.**

## Consequences

**Enables:**

- Merchants get actionable failure analytics (group by `phase` / `errorCode` /
  `walletDigest`) without the SDK exporting raw PII or secrets from the
  customer's browser.
- No built-in tracking/compliance surface: the SDK makes **zero** telemetry
  network calls; data movement is the merchant's explicit, auditable choice.
- A leaked analytics dataset can't be cross-day or cross-shop joined back to
  wallets without the per-shop/day salt.
- A buggy or malicious analytics callback cannot crash or stall a payment.

**Costs / constraints we accept:**

- The salted digest is **not stable across days** — intentional; long-horizon
  cohorting must happen on the merchant's server, not from this digest.
- Redaction is **best-effort pattern matching**: an exotic secret format could
  slip through. We mitigate by also capping length and by never putting
  structured sensitive fields (address/amount/payload) into the schema at all —
  so the free-text `message` is the *only* leak surface, and it is optional and
  redacted. The pattern list is a living allow-list of observed leaks and should
  be extended as new leak shapes appear.
- The FNV-1a fallback digest is weaker than SHA-256; it is confined to
  environments without SubtleCrypto (effectively tests / legacy Node), not modern
  browsers.

## Alternatives considered

- **Auto-upload telemetry to a Web3Settle endpoint** — rejected: creates an
  opt-out tracking surface from the customer's device and a compliance liability;
  contradicts the non-custodial, minimal-footprint posture. The merchant owns
  the transport.
- **Include the raw wallet address** (or a plain unsalted hash) — rejected: raw
  is PII; an unsalted truncated hash is reversible against a known userbase (F8).
- **Forward raw `Error.message`** — rejected: routinely leaks addresses, paths,
  UUIDs and key-shaped blobs.
- **Make emission async / fire-and-forget network** — rejected: reintroduces a
  phone-home and a failure/latency surface in the payment path. Synchronous
  callback keeps the SDK out of the network entirely.

## Links

- [src/core/telemetry.ts](../../src/core/telemetry.ts) — `TelemetryEvent`,
  `hashWalletAddress`, `redactErrorMessage`, `safeEmit`, `buildTelemetryEvent`,
  `todayUtc`
- Tests: `src/__tests__/telemetry.test.ts`
- [ADR-0003] (browser trust boundary) — same "the SDK runs on a hostile device"
  premise; this ADR governs what the SDK is allowed to emit *outward*.

[ADR-0003]: 0003-browser-trust-boundary-signed-config.md
