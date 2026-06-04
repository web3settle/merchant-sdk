# ARCHITECTURE — @web3settle/merchant-sdk

> Living architecture overview for the embeddable Web3Settle payment SDK, per
> the [`Discipline.md`](./Discipline.md) charter (§1, §9). For the *why* behind
> the load-bearing decisions, see [`docs/adr/`](./docs/adr/README.md).

## What this is

`@web3settle/merchant-sdk` is a **React + framework-agnostic TypeScript SDK** a
merchant embeds in their storefront to accept **non-custodial crypto payments**
across **EVM, Solana, and TRON**. It is published to a package registry and
**runs in the end customer's browser**. Its core job: take a USD amount, obtain a
verified payment-config and quote from the Web3Settle gateway, build the chain-
specific transaction, and drive the user's wallet to sign and broadcast a
payment **directly into the merchant's `MerchantPayIn` contract** (the platform
never custodies funds — root platform
[ADR-0001](https://github.com/web3settle/web3settle/blob/main/docs/adr/0001-non-custodial-per-merchant-contracts.md)).

Because it executes in a hostile environment (attacker-reachable network, the
customer's device), the **trust model and what the SDK refuses to do** are as
central to its architecture as the features it offers.

## Entry points / subpath structure

The package ships **multiple entry points** (`exports` in `package.json`), so a
consumer pulls in only the chain and rendering style they use. Solana and TRON
peer deps are **optional** — an EVM-only consumer never bundles them.

| Subpath | Source entry | Purpose |
|---|---|---|
| `.` (root) | [`src/index.ts`](./src/index.ts) | EVM React components + hooks, core (api-client, contract, price-feed, telemetry, confirmation policy, types, config), permit utils, i18n |
| `./solana` | [`src/solana/index.ts`](./src/solana/index.ts) | Solana provider, hooks, components, pipeline, PDA + instruction builders (optional `@solana/*` peers) |
| `./tron` | [`src/tron/index.ts`](./src/tron/index.ts) | TRON provider, hooks, components, pipeline; detects `window.tronWeb` at runtime (TronLink) |
| `./headless` | [`src/headless/index.ts`](./src/headless/index.ts) | Framework-agnostic controllers (`createPayButtonController`, …) — no React render; for Vue/Svelte/vanilla |
| `./wc` | [`src/wc/index.ts`](./src/wc/index.ts) | Native `<web3settle-pay-button>` Web Component (no Lit), reuses the headless controller |
| `./styles.css` | `src/styles.ts` → `dist/styles.css` | Opt-in stylesheet |

Layering (no cycles; UI layers depend inward on core):

```
React components (.)   Solana (./solana)   TRON (./tron)
        \                   |                  /
   Web Component (./wc) → headless controllers (./headless)
                      \         |         /
                        core/  (api-client, contract, pipeline interface,
                               payment-config-verifier, canonical-json,
                               telemetry, price-feed, ConfirmationPolicy,
                               config = baked-in trust anchors, types/zod)
```

## Trust model — what is verified before signing or submitting

The SDK trusts **constants baked into the published artifact**, and treats
**everything arriving over the network as hostile** until it proves itself
against those constants. See [ADR-0003](./docs/adr/0003-browser-trust-boundary-signed-config.md),
[ADR-0004](./docs/adr/0004-known-permit-tokens-allowlist.md),
[ADR-0005](./docs/adr/0005-telemetry-redaction-no-phone-home.md).

**Payment-config gate** — `Web3SettleApiClient.fetchPaymentConfig`
([`src/core/api-client.ts`](./src/core/api-client.ts)) fails closed unless **all
four** pass, in order:

1. **Shape** — Zod-parse the `{ data, signedAt, signature }` envelope.
2. **Provenance** — `verifyPaymentConfig` checks an **Ed25519** signature over
   `signed_at + canonical_json(data)` against the **baked-in pubkey(s)**
   (primary + secondary rotation slot). Fully local; no runtime fetch decides
   trust. ([`src/core/payment-config-verifier.ts`](./src/core/payment-config-verifier.ts),
   [`src/core/canonical-json.ts`](./src/core/canonical-json.ts))
3. **Replay window** — `signed_at` within `PAYMENT_CONFIG_MAX_AGE_MS` (5 min).
4. **Allow-lists** — per-chain `contractAddress` ∈ baked-in
   `KNOWN_CONTRACT_ADDRESSES` **or** elevated by the signed payload; and
   `contractAbiVersion` ∈ `SUPPORTED_ABI_VERSIONS`. ([`src/core/config.ts`](./src/core/config.ts))

**Permit signing gate** — `signPermit`
([`src/evm/permit.ts`](./src/evm/permit.ts)) refuses, **before any wallet popup**,
any token whose EIP-712 domain digest is not in `KNOWN_PERMIT_TOKENS`
(typo-squat defence), and additionally enforces a 60-min deadline cap, owner==
wallet binding, live-chainId cross-check, and EIP-2 low-s signature validation.

**Outbound data gate (telemetry)** — the SDK makes **no** telemetry network
calls; failure breadcrumbs go only to an optional synchronous merchant callback,
carry a **salted non-reversible** wallet digest (never the address), and run
every free-text message through `redactErrorMessage` (strips addresses, tx
hashes, UUIDs, base58, filesystem paths, long hex; 240-char cap).

Net effect: a poisoned-DNS/CDN/proxy/extension MITM, a partial backend
compromise, or a look-alike token cannot get the user to sign against an attacker
contract or hand out a bearer allowance — the SDK refuses first. Conversely, the
SDK **fails closed**: a botched key rotation or an unpopulated allow-list refuses
payments rather than accepting unverified ones.

## Multi-chain adapters

A single `PaymentPipeline` interface ([`src/core/pipeline.ts`](./src/core/pipeline.ts))
abstracts the three chain stacks so merchant UIs never branch on `chainId`:

| Family | Stack | Approval step | Amount unit | Tx-hash shape |
|---|---|---|---|---|
| EVM | wagmi + viem | yes (non-native, when allowance < amount) | wei | hex |
| Solana | `@solana/web3.js`; hand-rolled instructions + PDA derivation ([`src/solana/pda.ts`](./src/solana/pda.ts)) | **no** (transfer signed inline) | lamports / SPL raw | base58 |
| TRON | runtime `window.tronWeb` | yes (non-native) | sun | base58 |

Cross-chain **finality** is unified by `ConfirmationPolicy`
([`src/core/ConfirmationPolicy.ts`](./src/core/ConfirmationPolicy.ts)): EVM block
confirmations, Solana commitment levels, TRON confirmed-tx — one "is this safe
yet?" API. On Solana, per-merchant state is a set of **PDAs** (`merchant_config`,
`sol_vault`, `token_totals`) whose seeds mirror the Anchor program 1:1 — the
analogue of the EVM/TRON per-merchant contract address.

## Build & publish

> **Tooling note (override of the charter's "tsup" line).** The
> [`Discipline.md`](./Discipline.md) §7 example mandates `pnpm` + `tsup`. This
> repo's **actual, source-of-truth tooling** is **npm + Vite (library mode) +
> Vitest**, and this document reflects reality per charter rule R8/R11
> (calibrated reporting; match conventions, override for correctness). Adopting
> the charter does **not** retool the build. `Vitest` already aligns with §7.

- **Build:** `npm run build` → `tsc --noEmit` (typecheck) then **Vite library
  mode** ([`vite.config.ts`](./vite.config.ts)) with `@vitejs/plugin-react`,
  rollup multi-entry `lib`, and **`vite-plugin-dts`** (`rollupTypes`) for bundled
  `.d.ts`. Emits dual **ESM (`.js`) + CJS (`.cjs`)** plus a single `styles.css`.
  React / wagmi / viem / `@solana/*` / `tronweb` are kept **external** (consumers
  supply them).
- **Test:** **Vitest** (`npm test`, jsdom) — see `src/__tests__/` (api-client,
  payment-config-verifier, permit + permit-allowlist, telemetry, per-chain gas /
  pipeline / PDA, confirmation policy).
- **Lint/type:** ESLint (flat config) + `tsc --noEmit` strict.
- **Publish integrity** — `prepublishOnly` runs `npm ci --ignore-scripts` +
  typecheck + lint + test + build; `publishConfig` sets **`provenance: true`**.
  CI ([`.github/workflows/sdk-supplychain.yml`](./.github/workflows/sdk-supplychain.yml))
  additionally (premortem **F4**):
  - **rejects `^`/`~` on runtime `dependencies`** (exact-version only; devDeps may
    float) so a transitively-compromised minor can't land unreviewed;
  - `npm pack --provenance --dry-run` proves a provenance-signed tarball builds;
  - **asserts the tarball ships no `.ts` source and no `.env`** (only built
    `dist/` JS/CJS + `.d.ts`) so internals/secrets never reach consumers
    (SEC-DEP-006);
  - installs with `--ignore-scripts` so postinstall can't execute in CI.

## Customer-browser → SDK → gateway / chain flow

```
   END CUSTOMER'S BROWSER (hostile environment)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Merchant page                                                         │
 │  ┌───────────────────────── @web3settle/merchant-sdk ───────────────┐ │
 │  │  PayButton / WebComponent / headless controller                  │ │
 │  │        │                                                          │ │
 │  │        ▼                                                          │ │
 │  │  Web3SettleApiClient ──(1) GET payment-config / quote ───────────┼─┼──► Web3Settle GATEWAY (API)
 │  │        │  ◄── signed { data, signedAt, signature } ──────────────┼─┼──   serves Ed25519-signed config;
 │  │        ▼                                                          │ │     signing key only in Vault
 │  │  TRUST GATE (fail-closed):                                       │ │
 │  │   shape → Ed25519 vs BAKED-IN pubkey → freshness → addr/ABI      │ │
 │  │           allow-list      (ADR-0003)                             │ │
 │  │        │ verified contractAddress + amount                       │ │
 │  │        ▼                                                          │ │
 │  │  PaymentPipeline (EVM | Solana | TRON adapter)                   │ │
 │  │   • permit? → KNOWN_PERMIT_TOKENS gate + deadline/owner/chain    │ │
 │  │              checks (ADR-0004), else approve()                   │ │
 │  │   • build calldata / instruction / trigger                      │ │
 │  │        │                                                          │ │
 │  │        ▼ request signature                                       │ │
 │  │  USER WALLET (MetaMask / Phantom / TronLink) ── signs ───────────┼─┼──► BLOCKCHAIN
 │  │        │                                                          │ │     funds land DIRECTLY in the
 │  │        ▼ broadcast tx                                            │ │     merchant's MerchantPayIn
 │  │  ConfirmationPolicy: poll to required finality                  │ │     contract/PDA (non-custodial)
 │  │        │                                                          │ │
 │  │  telemetry breadcrumb (opt-in, redacted, salted digest,         │ │
 │  │   NO network from SDK) ──► merchant's own analytics (ADR-0005)  │ │
 │  └──────────────────────────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────────────────────┘

   The gateway only OBSERVES the chain (deposit detection) + relays signed
   webhooks; it is never in the funds hot-path. The chain is the system of
   record.  ── Trust anchor: the baked-in SDK artifact, NOT the wire.
```

## Pointers

- ADRs: [`docs/adr/README.md`](./docs/adr/README.md) — 0003 browser trust
  boundary, 0004 permit allow-list, 0005 telemetry redaction.
- Security policy / disclosure: [`SECURITY.md`](./SECURITY.md).
- Governance charter: [`Discipline.md`](./Discipline.md).
- Platform-wide ADRs (non-custodial, Compose-only) live in the monorepo root.
