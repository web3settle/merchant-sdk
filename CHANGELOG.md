# Changelog

All notable changes to `@web3settle/merchant-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
