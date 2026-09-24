# Changelog

All notable changes to `@web3settle/merchant-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Restore lint + build under ESLint 10 / Tailwind v4 (2026-09-24)

Toolchain only. **No public API change, and the version stays `0.5.0`.** Every
chain-cut guarantee is intact: `archive/solana/` is still unwired, the `exports`
map is still `. / ./tron / ./headless / ./wc / ./styles.css`, and the 137 / 900–902
drop guards still pass.

### Fixed — `npm run lint` crashed, now runs clean

`eslint-plugin-react` under ESLint 10 threw
`TypeError: contextOrFilename.getFilename is not a function` before linting a
single file. No published version of `eslint-plugin-react` (max 7.37.5, peers
`eslint ^3 … ^9.7`) or `eslint-plugin-jsx-a11y` (max 6.10.2, peers `… ^9`)
supports ESLint 10, so the honest minimal fix is to pin the linter, not the
plugins: **`eslint` and `@eslint/js` `^10` → `^9.39.5`**.

- **`.npmrc` is deleted.** The `legacy-peer-deps=true` workaround added during the
  chain cut existed only because ESLint 10 broke the peer graph. With eslint 9 the
  graph resolves strictly — `npm ci` now succeeds with no flags at all.
- ⚠️ eslint 9.39.5 installs with a *"no longer supported"* deprecation notice. That
  is the trade: a supported-but-broken linter versus an EOL-but-working one. The
  real exit is upstream — either those two plugins ship ESLint 10 support, or they
  get dropped. Tracked in `humanpending.md`.

With linting actually executing, 23 previously-masked errors surfaced. 14 were
mechanical and are fixed here:

| Rule | Count | How |
|---|---|---|
| `@typescript-eslint/no-unnecessary-type-assertion` | 7 | `eslint --fix` — redundant `as` removed |
| `@typescript-eslint/prefer-for-of` | 3 | index loops → `for…of` (incl. `permitDomainKey`) |
| `@typescript-eslint/prefer-optional-chain` | 2 | in `payment-config-verifier.ts` |
| `@typescript-eslint/require-await` | 2 | test double now returns `Promise.resolve` / `Promise.reject` |
| unused `eslint-disable` directive | 1 | replaced with a directive that states *why* the cast exists |

The `prefer-optional-chain` and `prefer-for-of` edits touch the **signed-config
verifier** and the **permit-allowlist digest function**, so they were applied by
hand rather than by a fixer and proven behaviour-neutral: `permit-allowlist`,
`payment-config-verifier` and `api-client` suites pass **26/26**.

The remaining 9 are `react-hooks/set-state-in-effect`, new in
`eslint-plugin-react-hooks` v7. They flag a pre-existing pattern in the payment
modals where an effect mirrors a `status` prop onto a local `step` state machine.
That fix is a real refactor of live payment-flow state and does not belong in a
CI-repair change, so the **rule is set to `warn`** with the rationale inline in
`eslint.config.js`. Lint reports `0 errors, 10 warnings` and exits 0. No security
or correctness rule was relaxed.

### Fixed — `npm run build` failed in two places

1. **Tailwind v4** moved its PostCSS plugin to a separate package; passing
   `tailwindcss` itself as a plugin throws. Added `@tailwindcss/postcss` and
   pointed `postcss.config.js` at it.
2. **`esbuild` was never installed**, so Vite died with
   `Cannot find package 'esbuild'`. Two causes, both fixed:
   - `overrides.esbuild` pinned `^0.25.0` while Vite 8.3.1 peers
     `^0.27.0 || ^0.28.0` — an unsatisfiable slot. Raised to **`^0.28.1`**, which
     also clears GHSA-gv7w-rqvm-qjhr (**high**, esbuild `< 0.28.1`) and
     GHSA-g7r4-m6w7-qqqr. The old `^0.25.0` pin was itself vulnerable to both.
   - Vite declares `esbuild` as an **optional** peer, so it is never installed
     transitively. Added it as an explicit devDependency.

### npm audit

**0 vulnerabilities**, down from 10 high / 16 moderate / 2 low. No `--force` was
used; the only version changes are the ones listed above.

### Still failing — deliberately untouched

The 4 `signPermit` cases in `src/__tests__/permit-allowlist.test.ts` still fail.
They hit ADR-0004's `KNOWN_PERMIT_TOKENS` gate with a token domain that is not
allow-listed, and the shipped allowlist holds one placeholder digest. Making them
pass means deciding the real allowlist contents — **the gate was not weakened and
the tests were not mocked out.** 165 passed / 4 failed, unchanged by this work.

## [Unreleased] — Chain cut: drop Polygon, archive Solana (2026-09-24)

Product decisions **D1** (drop Polygon permanently) and **D2** (archive Solana
out of mainline). Active chain families: **EVM (non-Polygon) + TRON**.

> **Version not bumped on purpose.** This is a breaking API change and needs a
> `0.6.0` release decision from the founder — bumping here would make CI publish
> a prerelease carrying breaking changes off `develop`. See the workspace-root
> `humanpending.md`.

### Removed — BREAKING

- **`@web3settle/merchant-sdk/solana` subpath.** Gone from `exports`, from the
  Vite entry map, and from the peer/dev dependency sets (`@solana/web3.js`,
  `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`). Sources moved
  to `archive/solana/` — outside `tsconfig` `include`, the Vitest `include`, and
  the ESLint `files` glob, so nothing typechecks, lints, tests or bundles them.
- **Solana-shaped holes in the shared surface**, rather than leaving them
  returning `null` for every chain: `SolanaCommitmentLevel`,
  `ConfirmationPolicy.commitmentLevel()`, `createHighValueConfirmationPolicy()`,
  and `SolanaGasBreakdown`.
- **`'solana'` from the union types** `ChainFamily`, `PaymentFamily` and
  `TelemetryChain`.
- **The `solana.*` i18n namespace** from `en` and `pt-BR`.
- **Polygon (chainId 137)** from `DEFAULT_CHAINS`, `CHAIN_ICONS`,
  `COINGECKO_CHAIN_IDS`, `KNOWN_CONTRACT_ADDRESSES`,
  `DEFAULT_CONFIRMATION_THRESHOLDS`, `CHAIN_FAMILY_REGISTRY`,
  `DEFAULT_SECONDS_TO_FINALITY`, the `price-feed` `matic-network` fallback, the
  wagmi chain list in `Web3SettleProvider`, and the EVM chain-id allowlists in
  `TopUpModal` / `evm/confirmationPolicy`.

### Added

- **Drop guards** in `src/__tests__/confirmationPolicy.test.ts`: chainId 137 and
  the Solana sentinels 900–902 must be absent from every registry, must resolve
  as *unknown* chains (12 confirmations, 0 s ETA) rather than as their old
  selves, and no registry entry may claim a family outside `evm | tron`. These
  fail if a dropped chain is re-added without a founder decision.
- `archive/solana/README.md` — quarantine banner and re-wiring checklist.

### Fixed — pre-existing, not caused by the cut

These three were blocking `tsc --noEmit`, which is the check that proves the cut
did not break the type surface. Fixed minimally so the cut is verifiable; each is
independent of the chain work:

- `tsconfig.json` — dropped the deprecated `baseUrl` (and the `@/*` `paths` alias
  it enabled, which nothing imported). TypeScript 6 makes `baseUrl` a hard error,
  so `npm run typecheck` aborted before reaching any source file.
- `src/hooks/useWallet.ts` — wagmi v3's `useBalance` no longer returns
  `formatted`; format `value`/`decimals` with viem's `formatUnits` so the SDK's
  public `balance: string | null` contract is unchanged.
- `src/css.d.ts` (new) — TypeScript 6 needs a declaration for the side-effect
  `import './styles.css'` in `src/styles.ts`.
- `.npmrc` (new) — pins `legacy-peer-deps=true`. `eslint-plugin-jsx-a11y@6.10.2`
  (its newest) declares `eslint: ^3 … ^9` while this package pins eslint ^10, so
  a clean `npm ci` fails ERESOLVE. The committed lockfile was already built that
  way; making it explicit keeps local installs, CI and the lockfile in agreement.

### Still broken — pre-existing, out of scope for this cut

Verified as failing identically on the pre-cut tree:

- `npm run lint` — `eslint-plugin-react` is incompatible with ESLint 10
  (`contextOrFilename.getFilename is not a function`). Needs eslint pinned to ^9
  or plugin releases that support 10.
- `npm run build` (the `vite build` half) — Tailwind v4 moved its PostCSS plugin
  to `@tailwindcss/postcss`; after that is fixed the build next fails on a
  missing `esbuild` (the root `overrides.esbuild` pin vs Vite 8 / rolldown).
- 4 tests in `src/__tests__/permit.test.ts` — `signPermit` gained the
  `KNOWN_PERMIT_TOKENS` gate (ADR-0004) but those cases still use a token domain
  that is not allow-listed, and the shipped allowlist holds one placeholder
  digest. Fixing it means deciding the real allowlist contents, not editing a
  test. 165 of 169 tests pass.

## [0.5.0] - 2026-05-09

### Added

- **Gas estimator (item 14.1)** — `estimateEvmGas`, `estimateEvmApproveGas`, `estimateSolanaGas` (with `buildSolanaEstimateInstruction`, `LAMPORTS_PER_SIGNATURE`), `estimateTronGas` / `computeTronCost` (with `DEFAULT_SUN_PER_ENERGY`). Single `GasEstimate` shape across all three chains: `{ native, usd, breakdown }`. The TopUpModal now renders a `≈ $X` network-fee badge under the quote when an estimate is available; failure to estimate hides the badge silently and never blocks pay.
- **Telemetry breadcrumbs (item 14.2)** — opt-in `onTelemetry` callback on `Web3SettleConfig`, plus `core/telemetry`: `buildTelemetryEvent`, `redactErrorMessage`, `hashWalletAddress`, `safeEmit`. EVM, Solana, and TRON payment hooks emit a single `TelemetryEvent` per failed pay-in with `{ chain, phase, errorCode, walletId, contractVersion, walletDigest, message }`. Privacy contract: no plain addresses (only an opaque SHA-256 prefix), no amounts, message is PII-redacted to ≤240 chars. The callback is wrapped in `safeEmit` so a buggy analytics handler can never break the payment flow.
- **Headless layer + Web Components (item 14.5)** — new subpath exports `@web3settle/merchant-sdk/headless` (`createPayButtonController`, `createWalletConnectController`, `createGasEstimateController`) and `@web3settle/merchant-sdk/wc` (`<web3settle-pay-button>` native HTMLElement). The headless controllers expose a `subscribe()` API with no React imports, so Vue/Svelte/vanilla JS callers can drive the same flow. The Web Component reuses the headless controller end-to-end.
- **EIP-712 permit signing (item 14.6)** — `evm/permit`: `detectPermitSupport`, `signPermit`, `buildPermitTypedData`, `validatePermitSignature`, `assertDeadlineFresh`. The pay-token EVM flow now accepts a `permit?: 'auto' | 'never' | 'require'` option (default `'auto'`): when the token implements EIP-2612, the SDK signs the typed-data permit and submits `permit(...)` directly instead of running a separate `approve()` tx. Saves the user one popup and ~$0.50 of gas.

### Changed

- `Web3SettleConfig` now carries optional `onTelemetry` and `contractVersion` fields. Both are threaded through `usePayment.startPayment` (and the Solana / TRON equivalents) so the modal does not need to wire them manually.
- New multi-entry build outputs: `dist/headless.{js,cjs}`, `dist/wc.{js,cjs}` alongside the existing entries.

## [0.4.0] - 2026-04-17

### Added

- **Solana subpath** (`@web3settle/merchant-sdk/solana`): `SolanaWeb3SettleProvider`, `SolanaPayButton`, `SolanaTopUpModal`, `SolanaWalletConnect`, `useSolanaPayment`, `useSolanaPipeline`, `SolanaPaymentPipeline`. Payment flow via `@solana/wallet-adapter-react` + `@solana/web3.js`; supports native SOL and any SPL token the merchant whitelists. PDA derivation helpers (`deriveConfigPda`, `deriveSolVaultPda`, `deriveTokenTotalsPda`, `hexToBytes32`) and raw instruction builders (`buildPayInNativeInstruction`, `buildPayInTokenInstruction`) exported for advanced flows. No `@coral-xyz/anchor` dependency — the SDK hand-rolls the Anchor discriminators.
- **TRON subpath** (`@web3settle/merchant-sdk/tron`): `TronWeb3SettleProvider`, `TronPayButton`, `TronTopUpModal`, `TronWalletConnect`, `useTronPayment`, `useTronPipeline`, `TronPaymentPipeline`. Uses TronLink's injected `window.tronWeb` at runtime; TRC-20 approve + pay flow, `SafeTRC20`-aware (tolerates non-return-value tokens like USDT-TRON). `feeLimit` configurable per provider.
- **Common `PaymentPipeline` interface** (exported from root): unified `quoteAmount` / `needsApproval` / `approve` / `execute` / `waitForReceipt` surface across EVM, Solana, and TRON. `PaymentPipelineError` with normalised `PaymentErrorKind` values (`user-rejected`, `insufficient-funds`, `wrong-network`, `reverted`, `timeout`, `unknown`).
- **i18n keys**: `solana.*` and `tron.*` namespaces in every shipped locale (`en`, `pt-BR`).
- **Tests**: Solana PDA + instruction-builder tests (pinned to node environment — see inline note for why); TRON pipeline tests with mocked TronWeb.
- New peer dependencies (optional, enforced per subpath): `@solana/web3.js`, `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `tronweb` (types-only).

### Changed

- **[BREAKING — for validation]** `ChainConfig.contractAddress` and `TokenConfig.address` now accept EVM hex, Solana base58, **and** TRON T-addresses. Each pipeline re-validates the format it needs at call time. Consumers who pinned their own Zod schemas to the old EVM-only regex should swap to the cross-chain one exported from the SDK.
- Subpath-aware multi-entry build: `dist/index.{js,cjs}` (EVM), `dist/solana.{js,cjs}`, `dist/tron.{js,cjs}`, plus a shared chunk for the `ChainSelector` / `TokenSelector` / `TransactionStatus` components.
- Updated `package.json` `exports` map with `./solana` and `./tron` conditional exports.

## [0.3.0] - 2026-04-17

### Changed

- **[BREAKING — LICENSE]** The SDK is no longer distributed under the MIT License. Effective this version the SDK is licensed under the **Web3Settle Software License** (proprietary, non-transferable, non-sublicensable). The full terms are in [LICENSE](./LICENSE); an industry-standard security-disclosure policy is in [SECURITY.md](./SECURITY.md). Existing consumers of prior versions are unaffected for those prior versions; all new installs and upgrades of this package from 0.3.0 onwards are subject to the new license.
- `package.json` `license` field updated from `"MIT"` to `"SEE LICENSE IN LICENSE"`.

## [0.2.0] - 2026-04-16

### Security

- Force-pin vulnerable transitive deps via `overrides`: axios ≥1.15.0 (CVE-2026-40175 / GHSA-3p68-rc4w-qgx5), hono ≥4.12.14 (cookie/ipRestriction/serveStatic/toSSG advisories), lodash ≥4.18.1 (CVE-2026-4800 / CVE-2026-2950), follow-redirects ≥1.16.0 (GHSA-r4q5-vmmm-2653), esbuild ≥0.25.0 (GHSA-67mh-4wv8-2f99)
- Bump `vitest` to 3.x to drop the vulnerable bundled vite/esbuild
- Add `overrides` block to `package.json` to cover future regressions of the same advisories
- New `Security` CI workflow: npm audit gate (fail on high), GitHub Dependency Review on PRs, CodeQL analysis (security-and-quality queries), TruffleHog verified-only secret scan
- `Web3SettleApiClient` now validates `storefrontId` and `sessionId` as UUIDs and uses the `URL` constructor for base URL validation instead of string concat
- ERC-20 approvals remain exact-amount (unchanged, reaffirmed)

### Changed

- **[BREAKING]** Moved `wagmi`, `viem`, `@wagmi/core`, `@tanstack/react-query` from `dependencies` to `peerDependencies` to match their externalized-at-build status and avoid duplicate copies in consumer bundles
- Rework Vite build externals via a regex matching root packages and their subpaths — drops ~1MB of walletconnect/coinbase/reown chunks that were previously bundled; published artifact is now exactly `index.js`, `index.cjs`, and `styles.css`
- `vite-plugin-dts` now rolls all declarations into a single `index.d.ts` file
- Switch to ESLint 9 flat config with `typescript-eslint` recommended-type-checked + stylistic-type-checked, `eslint-plugin-react`, `react-hooks`, and `jsx-a11y`
- Tighten `tsconfig.json` with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noImplicitOverride`, `noUncheckedIndexedAccess`
- `TopUpModal` now ships real dialog semantics: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus restoration on close, global Escape-key close, and labeled form controls. `autoFocus` removed in favor of ref-based focus
- Removed stray `React` default imports (project uses react-jsx runtime)
- Introduced `NATIVE_TOKEN_SENTINEL` and `TokenSelection` type to replace the redundant `string | 'native'` union

### Added

- New tests: `api-client-validation.test.ts` (UUID enforcement), `contract.test.ts` (parseTokenAmount behavior)
- `audit:ci` npm script and `prepublishOnly` guard running typecheck, lint, tests, and build
- `globals`, `typescript-eslint`, `@testing-library/user-event`, and `@vitest/coverage-v8` dev dependencies

## [0.1.0] - 2026-04-02

### Added

- `Web3SettleProvider` context provider wrapping wagmi, React Query, and SDK configuration
- `Web3SettlePayButton` component with primary, outline, and ghost variants
- `Web3SettleTopUpModal` multi-step payment flow: amount entry, wallet connection, chain/token selection, review, transaction status
- `ChainSelector` component with chain icons and token tooltip previews
- `TokenSelector` component with live balance display and USD equivalents
- `TransactionStatus` animated progress indicator for payment lifecycle
- `WalletConnect` component supporting injected wallets and WalletConnect v2
- `useWeb3Settle` hook for fetching and accessing payment configuration
- `usePayment` hook managing the full payment flow (chain switch, ERC-20 approval, native/token payment, receipt confirmation)
- `useWallet` hook with convenience fields wrapping wagmi account state
- `Web3SettleApiClient` with type-safe fetch, Zod response validation, and error handling
- Contract interaction utilities: `executePayInNative`, `executePayInToken`, `approveToken`, `checkAllowance`, `waitForReceipt`
- CoinGecko price feed with 60-second caching and static fallback prices
- Zod schemas for all configuration and API response types
- Dark theme glassmorphism UI with `w3s-` prefixed Tailwind classes
- Support for Ethereum, Polygon, and Base networks
- MIT license
