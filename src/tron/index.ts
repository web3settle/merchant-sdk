// TRON subpath entry — import from `@web3settle/merchant-sdk/tron`.
//
// This module detects `window.tronWeb` at runtime (TronLink + compatibles).
// It does NOT import any specific TronWeb version at build time; the runtime
// instance is owned by the user's browser extension. The `tronweb` peer
// dependency in package.json exists only to pin the TypeScript types.

export {
  TronWeb3SettleProvider,
  useTronWeb3SettleContext,
  useTronPipeline,
} from './TronProvider';
export type { TronWalletState, TronWeb3SettleContextValue } from './TronProvider';
export { useTronPayment } from './useTronPayment';
export { TronPayButton } from './TronPayButton';
export { TronTopUpModal } from './TronTopUpModal';
export { TronWalletConnect } from './TronWalletConnect';
export type { TronWalletConnectProps } from './TronWalletConnect';
export { TronPaymentPipeline } from './pipeline';
export { MERCHANT_PAY_IN_ABI, TRC20_ABI } from './abi';
export {
  getTronWeb,
  isTronWebReady,
  requestTronAccounts,
} from './tronweb-global';
export type { TronWebLike, TronContractLike } from './tronweb-global';

// Re-exports from core for convenience.
export { PaymentStatus, NATIVE_TOKEN_SENTINEL, Web3SettleApiError } from '../core/types';
export type {
  Web3SettleConfig,
  PaymentConfig,
  PaymentSession,
  ChainConfig,
  TokenConfig,
  TokenSelection,
  ButtonVariant,
  ButtonSize,
  PayButtonProps,
  TopUpModalProps,
  WalletConnectProps,
} from '../core/types';
export type { PaymentPipeline, PaymentReceipt, PaymentErrorKind } from '../core/pipeline';
export { PaymentPipelineError } from '../core/pipeline';
