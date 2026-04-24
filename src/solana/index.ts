// Solana subpath entry — import from `@web3settle/merchant-sdk/solana`.
//
// This module requires the following optional peer dependencies to be installed
// in the host app:
//   - @solana/web3.js
//   - @solana/wallet-adapter-base
//   - @solana/wallet-adapter-react
//
// Without them the subpath is a no-op at build time (the imports fail).

export { SolanaWeb3SettleProvider, useSolanaWeb3SettleContext, useSolanaPipeline } from './SolanaProvider';
export type { SolanaCluster } from './SolanaProvider';
export { useSolanaPayment } from './useSolanaPayment';
export { SolanaPayButton } from './SolanaPayButton';
export { SolanaTopUpModal } from './SolanaTopUpModal';
export { SolanaWalletConnect } from './SolanaWalletConnect';
export { SolanaPaymentPipeline } from './pipeline';
export type { SolanaPipelineConfig } from './pipeline';

// PDA helpers + instruction builders — exposed so advanced consumers can
// script payments without the UI.
export {
  deriveConfigPda,
  deriveSolVaultPda,
  deriveTokenTotalsPda,
  hexToBytes32,
} from './pda';
export {
  buildPayInNativeInstruction,
  buildPayInTokenInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from './instructions';
export type { PayInNativeAccounts, PayInTokenAccounts } from './instructions';

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
