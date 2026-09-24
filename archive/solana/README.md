# Archived: Solana (2026-09-24)

Quarantined from mainline per product decision **D2**.
Not built, not deployed, not advertised.
Do not re-wire without an explicit founder decision.

## What moved here

| Path | Was |
|---|---|
| `SolanaProvider.tsx`, `SolanaPayButton.tsx`, `SolanaTopUpModal.tsx`, `SolanaWalletConnect.tsx` | `src/solana/` |
| `useSolanaPayment.ts`, `pipeline.ts`, `estimateGas.ts`, `confirmationPolicy.ts`, `instructions.ts`, `pda.ts`, `index.ts` | `src/solana/` |
| `__tests__/solana-estimateGas.test.ts`, `__tests__/solana-pda.test.ts` | `src/__tests__/` |

## Why it is inert

Nothing in the toolchain reaches outside `src/`:

- `tsconfig.json` — `include: ["src"]`
- `vitest.config.ts` — `include: ['src/__tests__/**']`
- `eslint.config.js` — `files: ['src/**/*.{ts,tsx}']`
- `vite.config.ts` — explicit entry map, and the `solana` entry is gone

So these files are not typechecked, linted, tested, or bundled. They are kept
as source history in a readable place, nothing more.

## What was removed from the public API at the same time

The `./solana` subpath export is gone, and so is every Solana-shaped hole it
left in the shared surface — `SolanaCommitmentLevel`, `ConfirmationPolicy`'s
`commitmentLevel()`, `createHighValueConfirmationPolicy()`, `SolanaGasBreakdown`,
the `'solana'` member of `ChainFamily` / `PaymentFamily` / `TelemetryChain`, and
the `solana.*` i18n namespace. Leaving them behind would have advertised a chain
the SDK can no longer select.

Re-wiring means restoring all of that, not just moving the folder back. See
`CHANGELOG.md` under *Unreleased — Chain cut*.

## Also dropped in the same cut (decision D1)

**Polygon**, permanently: chainId `137` is gone from `DEFAULT_CHAINS`,
`CHAIN_ICONS`, `COINGECKO_CHAIN_IDS`, `KNOWN_CONTRACT_ADDRESSES`, the
confirmation-threshold registry, the wagmi chain list, and the docs. There is no
archive for Polygon because there was no Polygon-specific code — only config
entries.
