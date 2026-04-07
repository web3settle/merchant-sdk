# @web3settle/merchant-sdk

React component library for accepting crypto payments via Web3Settle. Drop in a provider and a pay button to enable on-chain payments across Ethereum, Polygon, and Base.

## Features

- Multi-chain support (Ethereum, Polygon, Base)
- Native currency and ERC-20 token payments
- Built-in wallet connection (injected + WalletConnect v2)
- Automatic ERC-20 approval flow
- Real-time transaction status tracking
- CoinGecko price feeds with caching
- Dark theme glassmorphism UI
- Zod-validated API responses
- Tree-shakeable ES module output
- TypeScript-first with full type exports

## Quick Start

### Install

```bash
npm install @web3settle/merchant-sdk wagmi viem @tanstack/react-query
```

### Wrap your app with the provider

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

### Add a pay button

```tsx
import { Web3SettlePayButton } from '@web3settle/merchant-sdk';

function Checkout() {
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

### Or open the modal directly

```tsx
import { useState } from 'react';
import { Web3SettleTopUpModal } from '@web3settle/merchant-sdk';

function TopUp() {
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

## Components

| Component | Description |
|-----------|-------------|
| `Web3SettleProvider` | Context provider wrapping wagmi, React Query, and SDK config |
| `Web3SettlePayButton` | Styled button that opens the payment modal |
| `Web3SettleTopUpModal` | Full multi-step payment flow modal |
| `ChainSelector` | Network selection with icons and token tooltips |
| `TokenSelector` | Token selection with live balance and USD display |
| `TransactionStatus` | Animated transaction progress indicator |
| `WalletConnect` | Wallet connection with connector list |

## Hooks

| Hook | Description |
|------|-------------|
| `useWeb3Settle()` | Access SDK config and payment configuration |
| `usePayment()` | Full payment lifecycle management |
| `useWallet()` | Wallet state with convenience fields |

## Configuration

### `Web3SettleConfig`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `apiBaseUrl` | `string` | Yes | API base URL |
| `storefrontId` | `string` | Yes | Your storefront UUID |
| `theme` | `'dark' \| 'light'` | No | UI theme (default: `'dark'`) |
| `onSuccess` | `(session) => void` | No | Callback on successful payment |
| `onError` | `(error) => void` | No | Callback on payment error |

### `PayButtonProps`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `amount` | `number` | -- | Payment amount in USD |
| `label` | `string` | `"Pay $X.XX"` | Button label |
| `variant` | `'primary' \| 'outline' \| 'ghost'` | `'primary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `disabled` | `boolean` | `false` | Disable the button |
| `className` | `string` | -- | Additional CSS classes |

## Contract Utilities

For direct contract interaction without the UI components:

```ts
import {
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  waitForReceipt,
  parseTokenAmount,
} from '@web3settle/merchant-sdk';
```

## Supported Chains

| Chain | ID | Native Currency | Default Tokens |
|-------|----|----------------|----------------|
| Ethereum | 1 | ETH | USDC, USDT |
| Polygon | 137 | POL | USDC, USDT |
| Base | 8453 | ETH | USDC |

## Security Notes

- All API responses are validated with Zod schemas before use
- ERC-20 approvals request only the exact amount needed (no unlimited approvals)
- Transaction receipts are verified for revert status
- Wallet connections use standard EIP-1193 providers
- No private keys are handled by the SDK

## Development

```bash
npm install
npm run dev          # Build with watch
npm run build        # Production build
npm run test         # Run tests
npm run typecheck    # Type checking
npm run lint         # Lint
```

## Peer Dependencies

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## License

MIT
