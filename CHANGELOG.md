# Changelog

All notable changes to `@web3settle/merchant-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
