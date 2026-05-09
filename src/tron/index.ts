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

// Gas / fee estimation (item 14.1)
export {
  estimateTronGas,
  computeTronCost,
  DEFAULT_SUN_PER_ENERGY,
} from './estimateGas';
export type {
  EstimateTronGasInput,
} from './estimateGas';

// Confirmation policy (Segment 2.2) — TRON-locked default (19 confirmations).
export { tronConfirmationPolicy } from './confirmationPolicy';
export type {
  ConfirmationPolicy,
  ConfirmationProgress,
  ChainFamily,
  SolanaCommitmentLevel,
} from '../core/ConfirmationPolicy';

// Telemetry helpers (re-export from core for convenience)
export {
  buildTelemetryEvent,
  hashWalletAddress,
  redactErrorMessage,
  safeEmit,
} from '../core/telemetry';
export type {
  TelemetryEvent,
  TelemetryCallback,
  TelemetryChain,
  TelemetryPhase,
} from '../core/telemetry';

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
