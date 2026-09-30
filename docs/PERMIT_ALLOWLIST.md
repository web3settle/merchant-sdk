# Permit allowlist (`KNOWN_PERMIT_TOKENS`) — contents and procedure

ADR-0004 / premortem F3: under `permit: 'auto'` the SDK signs an EIP-2612 permit only for a token
whose EIP-712 domain quadruple `(name, version, chainId, verifyingContract)` is baked into the SDK.
Everything else uses `approve()`; `permit: 'require'` throws `UnknownPermitTokenError`. The set
holds `permitDomainKey` digests (SHA-256 of `name|version|chainId|lowercased address`).

## Contents (0.6.0 — HP-5)

Verified against the chains on **2026-09-30** with `scripts/verify-permit-domains.mjs`
(public RPCs, read-only): every token's `DOMAIN_SEPARATOR()` equals the EIP-712 domain rebuilt from
its own `name()` / `version()`, the chain id and its address.

| Token | Quadruple | `PERMIT_TYPEHASH` | Digest |
|---|---|---|---|
| USDC Ethereum | `USD Coin` · `2` · `1` · `0xa0b8…eb48` | EIP-2612 | `8c11539d…9fc3db50` |
| DAI Ethereum | `Dai Stablecoin` · `1` · `1` · `0x6b17…1d0f` | **DAI-style** `Permit(holder,spender,nonce,expiry,allowed)` | `48082c4e…e61628d8` |
| USDC Base | `USD Coin` · `2` · `8453` · `0x8335…2913` | EIP-2612 | `ccfe7e53…a0fce586` |

The 0.5.0 set held one placeholder digest that matched no real token, so `permit: 'auto'` never
used a permit anywhere; the four `signPermit` unit tests failed on that gate (HP-4 / HP-5). They
now target the allow-listed USDC domain and reach the guard each one is named after; a separate
test keeps the unknown-domain refusal.

### DAI is trusted but not signed for

DAI is on the list by owner decision (HP-5). Its permit is **not** EIP-2612 — the SDK's typed data
and `permit(owner, spender, value, deadline, v, r, s)` call cannot be redeemed by DAI's
`permit(holder, spender, nonce, expiry, allowed, v, r, s)`. So `detectPermitSupport` reads
`PERMIT_TYPEHASH()` when a token exposes it and reports any non-EIP-2612 value as
`{ supported: false, reason: 'non-eip2612-permit' }`; `permit: 'auto'` then uses `approve()` for DAI.
Tokens that do not expose the view (OpenZeppelin `ERC20Permit`) are unaffected. A DAI-style permit
path would be new work; the digest is already in place for it.

## Adding a token

1. Add it to `TOKENS` in `scripts/verify-permit-domains.mjs` and run the script. It must print
   `domainSeparatorMatches: true` and `permit: "EIP-2612"` (or no `PERMIT_TYPEHASH` view).
2. Copy the printed `digest` into `KNOWN_PERMIT_TOKENS` (`src/core/config.ts`) with the quadruple in
   a comment, and add the quadruple to `REAL_DOMAINS` in `src/__tests__/permit-allowlist.test.ts`
   (that test pins the set exactly).
3. Cite the address source (issuer docs / explorer label) in the PR. Only an SDK release expands
   the set — a backend deploy cannot.
