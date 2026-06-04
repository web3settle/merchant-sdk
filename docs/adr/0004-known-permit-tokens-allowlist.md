# ADR-0004: Refuse EIP-2612 permit signatures for tokens outside `KNOWN_PERMIT_TOKENS`

**Status:** Accepted

## Context

EIP-2612 `permit` lets a user grant an ERC-20 allowance with an **off-chain
signature** instead of a separate on-chain `approve()` tx — saving a wallet popup
and ~$0.50 of gas. The SDK supports this for the pay-token flow
([src/evm/permit.ts](../../src/evm/permit.ts)).

A permit signature is a **bearer instrument**: anyone holding it can submit the
`permit(...)` tx until the nonce increments or the deadline passes. The signed
EIP-712 payload binds the allowance to a specific token via the **domain**
`{ name, version, chainId, verifyingContract }`.

The browser threat model ([ADR-0003]) bites hard here. The SDK learns which
token to sign for from data that can be attacker-influenced, and it discovers the
domain `name`/`version` by **calling the token contract's own view functions**.
A **typo-squat / look-alike token** can return `name() = "USD Coin"` and
`version() = "2"` — identical to real USDC — while being an entirely different
`verifyingContract`. The user's wallet then shows a permit for "USD Coin", which
looks correct, and the **wallet review — the supposed last line of defence — is
defeated** (premortem **F3**). Signing a permit for an attacker-chosen token
hands them a bearer allowance against the user's balance of *that* token.

`detectPermitSupport()` only proves a token *implements* EIP-2612; it says
nothing about whether the token is **trustworthy**. We need an authenticity gate,
not just a capability check.

## Decision

**The SDK will not sign a permit for any token whose EIP-712 domain is not on a
baked-in allow-list, `KNOWN_PERMIT_TOKENS`.**

- The allow-list is a set of **digests**, not readable names. `permitDomainKey()`
  hashes the lowercased `name|version|chainId|verifyingContract` quadruple with
  SHA-256; `KNOWN_PERMIT_TOKENS` stores those digests
  ([src/core/config.ts](../../src/core/config.ts)). Because `verifyingContract` is
  part of the hashed input, a squat that spoofs `name()` still produces a
  **different digest** and is rejected. (Storing digests rather than plaintext
  also avoids shipping a readable target list in the bundle.)
- `signPermit()` calls `isPermitDomainKnown(...)` **before any wallet popup**. An
  unknown domain throws `UnknownPermitTokenError` (a typed, telemetry-safe
  error — its message names only the error code, no address).
- The `permit: 'auto'` path is expected to call `isPermitDomainKnown()` first and
  **fall back to a normal `approve()` tx** for unknown tokens, rather than
  catching the error — i.e. unknown tokens are not blocked from being paid, they
  just take the boring, safe path.
- This composes with the other permit hardenings in the same module, which are
  defence-in-depth beyond the allow-list and stand on their own:
  - **deadline cap** — `assertDeadlineFresh()` rejects past deadlines *and*
    deadlines beyond `MAX_PERMIT_DEADLINE_WINDOW_SECONDS` (60 min), so a leaked
    signature isn't a quasi-permanent bearer token;
  - **owner binding** — refuses to sign if the wallet's active account differs
    from the permit `owner`;
  - **chainId cross-check** — refuses if `walletClient.getChainId()` disagrees
    with the domain `chainId`, so a stale config can't yield a signature
    replayable on a different chain;
  - **signature shape / EIP-2 low-s** — `validatePermitSignature()` rejects
    `r=0`, `s=0`, high-s (malleable) and bad `v` on the wallet's reply before the
    caller can broadcast.

## Consequences

**Enables:**

- A look-alike/typo-squat token cannot obtain a silently-signed bearer allowance:
  the SDK refuses **before** the wallet popup, so the user is never asked to
  approve the trap. Closes premortem F3 at the SDK layer.
- Unknown-but-legitimate tokens still work — they fall back to `approve()` — so
  the safety gate doesn't reduce payment coverage.
- The allow-list ships in the artifact, so the protection holds even on a
  hostile network/origin (consistent with [ADR-0003]'s "trust the package, not
  the wire" anchor).

**Costs / constraints we accept:**

- **Adding a legitimately-safe token requires an SDK release** (recompute the
  digest via `permitDomainKey`, commit it to `KNOWN_PERMIT_TOKENS`). Same
  pin-and-upgrade tradeoff as [ADR-0003]; acceptable because the fallback is a
  working `approve()`, not a failure.
- The allow-list must be curated correctly. A wrong digest fails *closed*
  (fall back to approve), which is the safe direction.
- **Known test follow-up (tracked, intentionally not fixed in this docs-only
  change).** The allow-list gate was added to `signPermit` *after* the original
  `signPermit` happy-path tests were written. Those tests in
  [src/\_\_tests\_\_/permit.test.ts](../../src/__tests__/permit.test.ts) (e.g.
  *"signs and returns split v/r/s for a valid input"*) drive `signPermit` with
  `tokenName: 'USD Coin'` at token address `0x2222…2222` — a domain that is **not**
  in `KNOWN_PERMIT_TOKENS`. Under the current code they would throw
  `UnknownPermitTokenError` before reaching the wallet mock, i.e. they encode the
  **pre-allow-list** contract. The newer
  [permit-allowlist.test.ts](../../src/__tests__/permit-allowlist.test.ts)
  correctly asserts the refusal path. Reconciling `permit.test.ts` to the
  allow-list reality (seed a known domain into the trust list via a test
  override, or assert the refusal) is a **separate follow-up PR** — code/tests
  are out of scope for this ADR per the additive-docs constraint. This ADR is the
  durable record of *why* that reconciliation is needed and what the intended
  contract is.

## Alternatives considered

- **Trust `name()`/`version()` from the token contract** — rejected: those views
  are attacker-controlled for a squat; they're exactly what makes the wallet
  review untrustworthy.
- **Sign for any EIP-2612-capable token (capability ≠ trust)** — rejected:
  `detectPermitSupport` proving the interface exists says nothing about
  authenticity; this is the hole the ADR closes.
- **Rely solely on the user's wallet confirmation** — rejected: a permit for
  "USD Coin" at a look-alike address looks correct to a human; the wallet UI is
  not a sufficient control here.
- **Block unknown tokens entirely** — rejected: needlessly reduces payment
  coverage. Falling back to `approve()` keeps unknown-but-real tokens payable
  while removing the silent-permit risk.

## Links

- [src/evm/permit.ts](../../src/evm/permit.ts) — `signPermit`,
  `isPermitDomainKnown`, `permitDomainKey`, `UnknownPermitTokenError`,
  `assertDeadlineFresh`, `validatePermitSignature`
- [src/core/config.ts](../../src/core/config.ts) — `KNOWN_PERMIT_TOKENS`
- Tests: `src/__tests__/permit-allowlist.test.ts` (refusal path),
  `src/__tests__/permit.test.ts` (pre-allow-list happy paths — see follow-up note)
- [ADR-0003] — same "trust the baked-in artifact, not the wire" anchor

[ADR-0003]: 0003-browser-trust-boundary-signed-config.md
