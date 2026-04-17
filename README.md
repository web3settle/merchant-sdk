# @web3settle/merchant-sdk

React component library for accepting crypto payments via Web3Settle. Drop in a provider and a pay button to take on-chain payments on **Ethereum, Polygon, Base, Solana, and TRON** directly from your users' wallets — no custody, no card data, no server-side signing.

**Distribution:** each chain family lives behind a separate subpath export so the bundler only pulls in what you actually use.

| Subpath | What it brings | Peer deps you must install |
|---|---|---|
| `@web3settle/merchant-sdk` | EVM (Ethereum / Polygon / Base) provider + button + modal + hooks | `wagmi`, `viem`, `@wagmi/core`, `@tanstack/react-query` |
| `@web3settle/merchant-sdk/solana` | Solana provider + button + modal + hooks + PDA helpers + raw instruction builders | `@solana/web3.js`, `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, plus the wallet-specific adapter packages you want (Phantom, Solflare, …) |
| `@web3settle/merchant-sdk/tron` | TRON provider + button + modal + hooks (TronLink-backed) | TronLink browser extension at runtime. The `tronweb` package is a peer for TypeScript types only — the SDK uses the extension's injected `window.tronWeb` |

EVM-only consumers never pay the bundle cost of the Solana / TRON stacks; Solana-only consumers never pull wagmi. Import only the subpaths you need.

## Features

- Five chains across three stacks: **Ethereum, Polygon, Base** (wagmi + viem), **Solana** (wallet-adapter + web3.js), **TRON** (TronLink)
- Unified `PaymentPipeline` interface so all three stacks present the same `quoteAmount → needsApproval → approve → execute → waitForReceipt` surface
- Native currency and fungible-token payments on every chain
- **EVM:** ERC-20 approval flow with exact-amount allowance (never unlimited)
- **Solana:** no-approval direct transfer; PDA derivation + hand-rolled Anchor instruction builders bundled (no `@coral-xyz/anchor` dependency)
- **TRON:** TRC-20 approve + pay, `SafeTRC20`-aware for non-return-value tokens like USDT-TRON
- Built-in wallet connection per chain (injected + WalletConnect on EVM; Phantom / Solflare / Backpack on Solana; TronLink)
- Real-time transaction status tracking with reorg-aware confirmation counts
- CoinGecko price feeds with in-memory caching + stale-while-revalidate fallback
- Dark theme glassmorphism UI with CSS-variable hooks for theming
- Zod-validated API responses at every boundary
- Tree-shakeable ES modules + CommonJS output, one subpath per chain family
- Full TypeScript type exports
- **i18n via i18next** — English and Brazilian Portuguese shipped; straightforward extension to any locale; separate `solana.*` and `tron.*` key namespaces
- Accessibility: role-dialog modal with focus trap, ESC close, screen-reader labels

## Install

```bash
npm install @web3settle/merchant-sdk wagmi viem @tanstack/react-query @wagmi/core
```

All four are **peer dependencies** — they must live in your app's own `node_modules` tree. The SDK itself adds only `zod` at runtime.

### Peer dependencies

| Package | Range |
|---|---|
| `react` | `^18.0.0 \|\| ^19.0.0` |
| `react-dom` | `^18.0.0 \|\| ^19.0.0` |
| `wagmi` | `^2.14.0` |
| `viem` | `^2.21.0` |
| `@wagmi/core` | `^2.16.0` |
| `@tanstack/react-query` | `^5.62.0` |

## Quick start

### 1. Wrap your app with the provider

```tsx
import { Web3SettleProvider } from '@web3settle/merchant-sdk';
import '@web3settle/merchant-sdk/styles.css';

function App() {
  return (
    <Web3SettleProvider
      config={{
        apiBaseUrl: 'https://api.yoursite.com',
        storefrontId: 'your-storefront-uuid',
        onSuccess: (session) => console.log('Payment confirmed:', session.txHash),
        onError: (error) => console.error('Payment failed:', error),
      }}
      walletConnectProjectId="your-wc-project-id" // optional
    >
      <YourApp />
    </Web3SettleProvider>
  );
}
```

### 2. Add a pay button

```tsx
import { Web3SettlePayButton } from '@web3settle/merchant-sdk';

export function Checkout() {
  return (
    <Web3SettlePayButton
      amount={29.99}
      label="Pay with Crypto"
      variant="primary"
      size="lg"
    />
  );
}
```

### 3. Or open the modal directly

```tsx
import { useState } from 'react';
import { Web3SettleTopUpModal } from '@web3settle/merchant-sdk';

export function TopUp() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button onClick={() => setIsOpen(true)}>Top Up</button>
      <Web3SettleTopUpModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        amount={50}
        userId="user-123"
      />
    </>
  );
}
```

## Solana quick start

Install the Solana peer deps + the wallet adapters you want to offer:

```bash
npm install @web3settle/merchant-sdk \
  @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react \
  @solana/wallet-adapter-phantom @solana/wallet-adapter-solflare \
  @tanstack/react-query
```

Wrap your app with the Solana provider and drop in the Solana button. The `programId` is the deployed `MerchantPayIn` Anchor program ID; `merchantId` is the 32-byte identifier the backend uses to derive the merchant's config PDA (hex string, with or without `0x` prefix).

```tsx
import { useMemo } from 'react';
import {
  SolanaWeb3SettleProvider,
  SolanaPayButton,
} from '@web3settle/merchant-sdk/solana';
import '@web3settle/merchant-sdk/styles.css';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

export function App() {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <SolanaWeb3SettleProvider
      config={{ apiBaseUrl: 'https://api.yoursite.com', storefrontId: 'uuid' }}
      solana={{
        programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
        merchantId: '0x' + '01'.repeat(32),
      }}
      wallets={wallets}
      cluster="mainnet-beta"
    >
      <SolanaPayButton amount={29.99} label="Pay with SOL or SPL" />
    </SolanaWeb3SettleProvider>
  );
}
```

Advanced use: `useSolanaPipeline()` returns a `SolanaPaymentPipeline` bound to the current wallet — call `quoteAmount`, `execute`, `waitForReceipt` directly. `buildPayInNativeInstruction` and `buildPayInTokenInstruction` are exposed if you want to compose pay-ins into your own Solana transactions.

## TRON quick start

The TRON subpath uses the user's [TronLink extension](https://www.tronlink.org/) at runtime. No build-time TronWeb dependency is required.

```bash
npm install @web3settle/merchant-sdk @tanstack/react-query
# tronweb is a peer for TypeScript types only; no runtime install required if you don't need the types in your own code.
```

```tsx
import { TronWeb3SettleProvider, TronPayButton } from '@web3settle/merchant-sdk/tron';
import '@web3settle/merchant-sdk/styles.css';

export function App() {
  return (
    <TronWeb3SettleProvider
      config={{ apiBaseUrl: 'https://api.yoursite.com', storefrontId: 'uuid' }}
    >
      <TronPayButton amount={29.99} label="Pay with TRX or USDT-TRON" />
    </TronWeb3SettleProvider>
  );
}
```

`useTronPipeline()` gives you the `TronPaymentPipeline` for custom flows. The provider surfaces `{ address, connected, connecting, error }` via `useTronWeb3SettleContext().wallet`, and exposes `connect()` / `disconnect()` for manual control.

## Supporting multiple chains in the same app

EVM, Solana, and TRON each need their own provider — they use different wallet stacks and can't share a single `Web3SettleProvider`. Nest them, or pick at render time:

```tsx
import { Web3SettleProvider, Web3SettlePayButton } from '@web3settle/merchant-sdk';
import { SolanaWeb3SettleProvider, SolanaPayButton } from '@web3settle/merchant-sdk/solana';
import { TronWeb3SettleProvider, TronPayButton } from '@web3settle/merchant-sdk/tron';

export function MultiChainCheckout({ chain, amount }) {
  if (chain === 'solana') {
    return (
      <SolanaWeb3SettleProvider config={…} solana={…} wallets={…}>
        <SolanaPayButton amount={amount} />
      </SolanaWeb3SettleProvider>
    );
  }
  if (chain === 'tron') {
    return (
      <TronWeb3SettleProvider config={…}>
        <TronPayButton amount={amount} />
      </TronWeb3SettleProvider>
    );
  }
  return (
    <Web3SettleProvider config={…}>
      <Web3SettlePayButton amount={amount} />
    </Web3SettleProvider>
  );
}
```

All three pipelines implement the same `PaymentPipeline` interface exported from the root:

```ts
import type { PaymentPipeline, PaymentReceipt, PaymentErrorKind } from '@web3settle/merchant-sdk';
```

so you can build your own chain-agnostic UI if the default modals don't suit.

## API reference

### Components

| Component | Description |
|-----------|-------------|
| `Web3SettleProvider` | Context provider wrapping `WagmiProvider`, `QueryClientProvider`, and SDK config. Required root. |
| `Web3SettlePayButton` | Styled button that opens the payment modal. Three variants × three sizes. |
| `Web3SettleTopUpModal` | Full multi-step payment flow modal (amount → wallet → token → review → status). |
| `ChainSelector` | Network selection with icons and token tooltips. `role="radiogroup"` + keyboard-accessible. |
| `TokenSelector` | Token selection with live balance and USD display. Falls back gracefully if RPC is unreachable. |
| `TransactionStatus` | Animated transaction progress indicator (sending → confirming → success) + explorer link. |
| `WalletConnect` | Wallet connection UI listing every configured wagmi connector. |

### Hooks

| Hook | Description |
|------|-------------|
| `useWeb3Settle()` | Access SDK config + cached payment configuration loaded from the API. Exposes `refetch()`. |
| `usePayment()` | Full payment lifecycle: chain switch, USD→token conversion, approval, pay-in, receipt wait. Returns `{ status, txHash, error, startPayment, reset }`. |
| `useWallet()` | Wagmi-wrapped convenience hook: `{ address, isConnected, chainId, balance, balanceSymbol, displayAddress, connectors, connect, disconnect, error }`. |

### Low-level utilities

Useful if you want to drive payments without the UI, or integrate with an existing checkout.

```ts
import {
  // Contract interaction
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  getTokenBalance,
  getTokenDecimals,
  waitForReceipt,
  parseTokenAmount,
  // Price feeds
  getNativeTokenPrice,
  getTokenPrice,
  usdToNativeAmount,
  usdToTokenAmount,
  clearPriceCache,
  // API client
  Web3SettleApiClient,
  Web3SettleApiError,
} from '@web3settle/merchant-sdk';
```

### Constants, schemas, and types

```ts
import {
  // Constants
  PAYMENT_CONTRACT_ABI,
  ERC20_ABI,
  DEFAULT_CHAINS,
  CHAIN_ICONS,
  COINGECKO_CHAIN_IDS,
  SESSION_POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
  PRICE_CACHE_TTL_MS,
  NATIVE_TOKEN_SENTINEL,
  // Zod schemas (validate at runtime)
  TokenConfigSchema,
  ChainConfigSchema,
  PaymentConfigSchema,
  PaymentSessionSchema,
  CreateSessionResponseSchema,
  Web3SettleConfigSchema,
  // Enums
  PaymentStatus,
} from '@web3settle/merchant-sdk';

// TypeScript types (erased at build time)
import type {
  TokenConfig,
  ChainConfig,
  PaymentConfig,
  PaymentSession,
  CreateSessionResponse,
  Web3SettleConfig,
  PayButtonProps,
  TopUpModalProps,
  ChainSelectorProps,
  TokenSelectorProps,
  TransactionStatusProps,
  WalletConnectProps,
  ButtonVariant,
  ButtonSize,
  TokenSelection,
} from '@web3settle/merchant-sdk';
```

## Configuration

### `Web3SettleProvider` props

| Prop | Type | Required | Description |
|---|---|---|---|
| `config` | `Web3SettleConfig` | Yes | See table below. |
| `children` | `ReactNode` | Yes | Your app. |
| `walletConnectProjectId` | `string` | No | WalletConnect v2 project ID from `cloud.walletconnect.com`. Omit to use injected connectors only. |
| `queryClient` | `QueryClient` | No | Reuse your existing React Query client. The SDK creates one if omitted. |

### `Web3SettleConfig`

| Property | Type | Required | Description |
|---|---|---|---|
| `apiBaseUrl` | `string` | Yes | HTTPS URL of the Web3Settle backend (`MerchantPaymentApi`). |
| `storefrontId` | `string` | Yes | Your storefront UUID from the back office. |
| `theme` | `'dark' \| 'light'` | No | UI theme. Default `'dark'`. (Only `dark` ships today; `light` is reserved.) |
| `onSuccess` | `(session: PaymentSession) => void` | No | Fires after the tx is confirmed at the chain's required depth. |
| `onError` | `(error: Error) => void` | No | Fires on any unrecoverable failure (revert, user rejection, network error). |

### `PayButtonProps`

| Property | Type | Default | Description |
|---|---|---|---|
| `amount` | `number` | — | Payment amount in USD. |
| `label` | `string` | `"Pay $X.XX"` | Button label. |
| `variant` | `'primary' \| 'outline' \| 'ghost'` | `'primary'` | Visual style. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size. |
| `disabled` | `boolean` | `false` | Disable the button. |
| `className` | `string` | — | Additional CSS classes (merged after the variant/size classes). |

## Internationalisation (i18n)

The SDK ships with translations in **English (`en`)** and **Brazilian Portuguese (`pt-BR`)** and uses [`i18next`](https://www.i18next.com/) + [`react-i18next`](https://react.i18next.com/) under the hood. Strings are namespaced under `web3settle-sdk` so they never collide with your application's own translations.

### Turn it on

There are two modes, pick whichever matches how your app already handles i18n.

**Mode A — you already use `i18next`.** Merge the SDK's resource bundles into your existing instance:

```ts
// src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { addSdkResourcesTo } from '@web3settle/merchant-sdk';

void i18n
  .use(initReactI18next)
  .init({
    lng: 'pt-BR',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: { /* your app strings */ } },
      'pt-BR': { translation: { /* your app strings */ } },
    },
  })
  .then(() => {
    // Adds `web3settle-sdk` namespace bundles for every locale the SDK ships.
    addSdkResourcesTo(i18n);
  });

export default i18n;
```

The SDK components pick the language from your `i18n.language`. Changing it with `i18n.changeLanguage('pt-BR')` updates the SDK UI in the same frame.

**Mode B — you don't use `i18next` in your app.** Let the SDK create a standalone instance:

```ts
import { ensureSdkI18n } from '@web3settle/merchant-sdk';

const sdkI18n = ensureSdkI18n();
await sdkI18n.changeLanguage('pt-BR');
```

The SDK components will use this instance automatically.

### Supported locales at a glance

```ts
import { SUPPORTED_LOCALES, LOCALE_LABELS, SDK_NAMESPACE } from '@web3settle/merchant-sdk';

// SUPPORTED_LOCALES = ['en', 'pt-BR'] as const
// LOCALE_LABELS     = { en: 'English', 'pt-BR': 'Português (Brasil)' }
// SDK_NAMESPACE     = 'web3settle-sdk'
```

### Adding a new language

The SDK will happily translate into any language you register with it. The work is just a JSON file and three lines of glue code in your app.

**Step 1 — copy one of the shipped locale files as a starting point.** The shape is stable across versions; pick `en.json` (authoritative) or `pt-BR.json` (reference for gendered / length-sensitive translations).

```bash
# Grab the canonical English pack from the installed package:
cp node_modules/@web3settle/merchant-sdk/src/i18n/locales/en.json \
   src/locales/web3settle-sdk.es-ES.json
```

Open the file and translate every leaf string, leaving the keys unchanged. A complete pack looks like this:

```jsonc
// src/locales/web3settle-sdk.es-ES.json
{
  "payButton": {
    "default": "Pagar {{amount}} USD",
    "label": "Pagar con cripto"
  },
  "modal": {
    "title": "Recarga",
    "enterAmount": "Introduce el importe",
    "connectWallet": "Conectar monedero",
    "selectPayment": "Selecciona el pago",
    "reviewPayment": "Revisar pago",
    "processing": "Procesando",
    "complete": "Completado",
    "failed": "Error",
    "amountUsd": "Importe (USD)",
    "continue": "Continuar",
    "reviewButton": "Revisar pago",
    "confirmButton": "Confirmar pago",
    "done": "Hecho",
    "tryAgain": "Intentar de nuevo",
    "close": "Cerrar",
    "back": "Atrás"
  },
  "wallet": {
    "connect": "Conectar monedero",
    "connecting": "Conectando…",
    "connected": "Conectado",
    "disconnect": "Desconectar",
    "rejected": "Conexión rechazada por el usuario"
  },
  "chain": {
    "select": "Selecciona red",
    "tokensCount_one": "{{count}} token",
    "tokensCount_other": "{{count}} tokens"
  },
  "token": {
    "select": "Selecciona token",
    "native": "Nativo"
  },
  "status": {
    "sending": "Enviando transacción",
    "confirming": "Confirmando on-chain",
    "success": "Pago confirmado",
    "txFailed": "Transacción fallida",
    "paymentSuccessful": "Pago realizado",
    "paymentSuccessBody": "Tu transacción ha sido confirmada on-chain.",
    "viewOnExplorer": "Ver en el explorador",
    "viewTxOnExplorer": "Ver transacción en el explorador",
    "unexpectedError": "Ha ocurrido un error inesperado"
  },
  "errors": {
    "rejected": "Transacción rechazada por el usuario",
    "insufficientFunds": "Saldo insuficiente para esta transacción",
    "noWallet": "Monedero no conectado",
    "tokenNotFound": "Token {{token}} no encontrado en la configuración de red",
    "reverted": "Transacción revertida on-chain"
  },
  "branding": {
    "poweredBy": "Desarrollado por",
    "brand": "Web3Settle"
  }
}
```

**Step 2 — register the pack with the SDK's i18n instance.**

If you use **Mode A** (your own `i18next`):

```ts
import i18n from './i18n';
import { SDK_NAMESPACE } from '@web3settle/merchant-sdk';
import esES from './locales/web3settle-sdk.es-ES.json';

// Tell i18next that 'es-ES' exists and what its SDK pack looks like.
i18n.addResourceBundle('es-ES', SDK_NAMESPACE, esES, /* deep */ true, /* overwrite */ false);

// Let users switch to it:
await i18n.changeLanguage('es-ES');
```

If you use **Mode B** (SDK-owned instance):

```ts
import { ensureSdkI18n, SDK_NAMESPACE } from '@web3settle/merchant-sdk';
import esES from './locales/web3settle-sdk.es-ES.json';

const sdkI18n = ensureSdkI18n();
sdkI18n.addResourceBundle('es-ES', SDK_NAMESPACE, esES, true, false);
await sdkI18n.changeLanguage('es-ES');
```

**Step 3 — (optional) advertise the locale in your language switcher.**

`SUPPORTED_LOCALES` and `LOCALE_LABELS` exported by the SDK are *not* mutable — they describe the bundles the SDK ships with. If you want your own language switcher to list Spanish as well, maintain your own array in your app and include whatever languages you've added via `addResourceBundle`.

```tsx
const ALL_LOCALES = [
  { code: 'en',    label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'es-ES', label: 'Español (España)' },
];
```

### Keeping translations in sync across releases

When we add a new string in a minor version, the English entry is authoritative. Missing keys in custom locale files fall back to English automatically — nothing breaks, but the un-translated string will appear in English until you copy the new key over. We recommend running a diff against `node_modules/@web3settle/merchant-sdk/src/i18n/locales/en.json` after every version bump.

### Interpolation and pluralisation

Translations use [i18next interpolation](https://www.i18next.com/translation-function/interpolation) syntax for substitution and the standard [`_one` / `_other` suffixes](https://www.i18next.com/translation-function/plurals) for plurals:

```json
"chain": {
  "tokensCount_one":   "{{count}} token",
  "tokensCount_other": "{{count}} tokens"
}
```

Follow [CLDR plural categories](https://cldr.unicode.org/index/cldr-spec/plural-rules) for the languages you add (some languages need `_few`, `_many`, `_zero`, etc.).

### Right-to-left languages

Visual RTL support (`dir="rtl"`) is **not** applied automatically — your host app's root element should set `dir` based on the active locale. The SDK's layout uses logical properties (`ms-`, `me-`, `start`, `end`) wherever Tailwind supports them, so it adapts correctly when the host sets `dir="rtl"`.

## Supported chains

| Chain | Stack | Native | Default whitelist | SDK subpath |
|---|---|---|---|---|
| Ethereum | EVM / wagmi | ETH | USDC, USDT | root |
| Polygon | EVM / wagmi | POL | USDC, USDT | root |
| Base | EVM / wagmi | ETH | USDC | root |
| Solana mainnet-beta | wallet-adapter + web3.js | SOL | SPL tokens (any the merchant whitelists) | `/solana` |
| TRON mainnet | TronLink | TRX | TRC-20 (incl. USDT-TRON via `SafeTRC20`) | `/tron` |

All five use the same `MerchantPayIn` V3.0 contract model — immutable commission set at initialize, token whitelist managed by the admin role, no renegotiation path.

## Security notes

- All API responses are validated with Zod schemas before use.
- ERC-20 approvals request only the exact amount needed — **never** unlimited.
- Transaction receipts are verified for `status === 'success'`; reverts surface as an `Error`.
- Wallet connections use standard EIP-1193 providers via wagmi; the SDK does not read or persist private keys.
- `Web3SettleApiClient` validates `storefrontId` + `sessionId` as UUIDs at construction time and builds URLs via the `URL` constructor (no string concat).
- Modal: `role="dialog"` + `aria-modal` + focus restoration + ESC-key close. Click-outside closes on mouse but the Escape handler is always present for keyboard-only users.

## Browser support

Modern evergreen browsers with ES2020 support (Chrome 94+, Firefox 93+, Safari 15+, Edge 94+).

## Development

```bash
npm install
npm run dev          # Build with watch
npm run build        # Production build (tsc + Vite lib)
npm run test         # Run Vitest (61 tests)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (flat config, strict type-checked)
npm run audit:ci     # Fail on high/critical vulns
```

## Bundle output

Built artefacts in `dist/`:

| File | Purpose |
|---|---|
| `index.js` | ESM entry point. |
| `index.cjs` | CommonJS entry point. |
| `index.d.ts` | Rolled-up TypeScript declarations. |
| `styles.css` | Tailwind-compiled stylesheet. Import separately via `@web3settle/merchant-sdk/styles.css`. |
| `styles.js` / `styles.cjs` | 40-byte side-effect entry that imports `styles.css` (used by tooling). |

Source maps accompany every `.js` / `.cjs` output.

## License

Proprietary — Copyright © 2026 Web3Settle.com. See [LICENSE](./LICENSE) for the full terms. Redistribution, sublicensing, and embedding this SDK into third-party products requires written permission from Web3Settle.com.
