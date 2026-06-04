# ADR-0003: Treat the customer browser as hostile — verify the signed payment-config before building any transaction

**Status:** Accepted

## Context

`@web3settle/merchant-sdk` is published to npm and executes **inside the end
customer's browser**, on a page the merchant controls, against a network the
attacker may control. The SDK's job is to take a USD amount and turn it into an
on-chain payment: it fetches `GET /api/storefronts/{id}/payment-config`, reads
the returned `contractAddress` (and per-chain token list / ABI version), builds
the calldata, and asks the user's wallet to sign and broadcast.

The platform is **non-custodial** (platform [ADR-0001]): customers pay
**directly** into the merchant's `MerchantPayIn` contract, and nobody — not even
the operator — can reverse or refund an on-chain transfer. That makes the
**contract address the single most security-critical field the SDK handles.**

The naive trust model is "the API response is the source of truth". In a browser
that is false:

- **Transport is attacker-reachable.** Poisoned DNS, a malicious/captive proxy,
  a compromised CDN edge, or a hostile browser extension can substitute the JSON
  body in flight. A plain shape check (Zod) passes happily on a *well-formed*
  response that points `contractAddress` at a **clone of MerchantPayIn** the
  attacker controls. The user signs, the funds land in the attacker's contract,
  and they are unrecoverable (premortem **F2**).
- **A backend compromise** (or a single rogue API instance) could likewise emit
  a valid-looking config that redirects funds, with no second factor.
- **The wallet's own review is weak** here: a clone contract at a plausible
  address, paying a plausible token amount, does not look wrong to a user
  clicking "confirm".

So the trust anchor cannot be "whatever the server said". It has to be something
the **shipped SDK artifact itself** carries and an in-transit attacker cannot
forge.

## Decision

**The SDK treats every byte it receives over the network as hostile and
re-verifies it against trust anchors baked into the published package before it
will build a transaction.** Concretely, `Web3SettleApiClient.fetchPaymentConfig`
([src/core/api-client.ts](../../src/core/api-client.ts)) gates the payment-config
response through **four fail-closed steps, in order**, and returns the config
only if all pass:

1. **Shape** — parse the wrapper `{ data, signedAt, signature }` with a Zod
   schema (`SignedPaymentConfigEnvelopeSchema`). Reject malformed bodies.
2. **Cryptographic provenance** — `verifyPaymentConfig(...)`
   ([src/core/payment-config-verifier.ts](../../src/core/payment-config-verifier.ts))
   checks an **Ed25519** signature over `signed_at + canonical_json(data)`
   against the SDK's **baked-in public key(s)**
   (`WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY`, plus a `_SECONDARY` rotation
   slot). The signing private key lives only in Vault server-side, so an
   in-transit attacker cannot forge a valid signature. Verification is **fully
   local** — it never phones a "well-known" endpoint to decide trust (that
   endpoint exists only for out-of-band drift detection).
3. **Replay window** — `signed_at` must parse as UTC and be within
   `PAYMENT_CONFIG_MAX_AGE_MS` (5 min, with 60 s of future skew tolerance), so a
   genuinely-signed-but-stale config can't be replayed after a contract
   migration.
4. **Address + ABI allow-lists** — the per-chain `contractAddress` must be in the
   baked-in `KNOWN_CONTRACT_ADDRESSES[chainId]` **or** explicitly elevated by the
   signed payload's `allowedContractAddresses` map; and `contractAbiVersion` must
   be in the baked-in `SUPPORTED_ABI_VERSIONS` set. Both live in
   [src/core/config.ts](../../src/core/config.ts).

The canonical-JSON serialization
([src/core/canonical-json.ts](../../src/core/canonical-json.ts)) is part of the
contract: it **must** match the backend signer
(`MerchantPaymentApi.Authentication.PaymentConfigSigner`) byte-for-byte, or every
signature fails.

The trust boundary is: **baked-in constants in the published SDK are trusted;
everything arriving over the wire is not, until it proves itself against those
constants.**

## Consequences

**Enables:**

- A poisoned-DNS / CDN / proxy / extension MITM that rewrites the contract
  address is **rejected before a single wallet popup** — the user never gets the
  chance to sign against an attacker contract.
- **Defence in depth against backend compromise**: because a *new* canonical
  contract address has to be added to `KNOWN_CONTRACT_ADDRESSES` (or the address
  must be elevated inside a *signed* payload), a compromised backend that merely
  serves a different address **cannot** redirect funds on its own — it would need
  the Vault signing key too. Trust is split across two systems.
- Key rotation without downtime: primary+secondary keys are both tried, so a
  payload signed seconds before a rotation still verifies.
- Telemetry-safe failures: each refusal has a typed `reason`
  (`signature-invalid`, `signed-at-stale`, `no-trusted-key`, …) carrying no raw
  payload (feeds [ADR-0005]).

**Costs / constraints we accept:**

- **Shipping a new canonical contract address requires an SDK release**, not just
  a backend deploy. This is the deliberate price of the split-trust property and
  must be called out to integrators (pin-and-upgrade, not silent rollover).
  `allowedContractAddresses` in the signed payload is the escape hatch for
  staged rollouts without a release.
- **Key management discipline is now load-bearing.** The signing key in Vault and
  the baked-in pubkey must stay in lockstep; a botched rotation fails *closed*
  (all payments refuse) rather than open — the correct but disruptive failure
  mode. The current `0x000…0` pubkey in `config.ts` is an explicit **dev/CI
  placeholder** and MUST be replaced before any real npm publish (it is
  cryptographically invalid, so it fails closed by construction).
- The backend serializer and the SDK's `canonicalJson` are a coupled pair across
  a repo boundary — a divergence breaks all signatures and must be guarded by a
  shared cross-language fixture.
- `KNOWN_CONTRACT_ADDRESSES` is **empty in 0.5.0** (pre-mainnet); until populated,
  the only accepted addresses are those elevated by a signed payload. That is
  fail-closed and acceptable for the current phase, but is a release-gating TODO
  for mainnet.

## Alternatives considered

- **Trust the API response (shape-check only)** — rejected: a well-formed body is
  exactly what a MITM produces; Zod validates structure, not authenticity. This
  is the vulnerability, not the fix.
- **TLS / cert pinning as the only defence** — rejected: TLS protects the channel
  but not against a compromised origin/CDN/extension or a malicious endpoint, and
  pinning is impractical for an SDK embedded on arbitrary merchant domains. The
  signature anchors trust in the *artifact*, independent of transport.
- **Fetch the trusted pubkey from a well-known URL at runtime** — rejected as the
  *trust* source: it just moves the MITM target to that URL. Kept only as an
  out-of-band drift check; the baked-in constant remains the anchor.
- **Allow-list addresses with no signature** — rejected: an allow-list alone
  can't authorize the staged/elevated addresses a real rollout needs, and a
  signature alone can't stop a fully-compromised backend. Requiring **both**
  (signature *and* allow-list) is what splits trust across two systems.

## Links

- [src/core/api-client.ts](../../src/core/api-client.ts) —
  `fetchPaymentConfig` 4-step gate
- [src/core/payment-config-verifier.ts](../../src/core/payment-config-verifier.ts),
  [src/core/canonical-json.ts](../../src/core/canonical-json.ts)
- [src/core/config.ts](../../src/core/config.ts) —
  `WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_*`, `PAYMENT_CONFIG_MAX_AGE_MS`,
  `KNOWN_CONTRACT_ADDRESSES`, `SUPPORTED_ABI_VERSIONS`
- Tests: `src/__tests__/payment-config-verifier.test.ts`,
  `src/__tests__/api-client-validation.test.ts`
- Platform [ADR-0001] (non-custodial) — the root cause: on-chain transfers are
  irreversible, so the contract address must be unforgeable.

[ADR-0001]: https://github.com/web3settle/web3settle/blob/main/docs/adr/0001-non-custodial-per-merchant-contracts.md
[ADR-0005]: 0005-telemetry-redaction-no-phone-home.md
