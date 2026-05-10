// ── Components ───────────────────────────────────────────────────────────────
export { Web3SettleProvider } from './components/Web3SettleProvider';
export { Web3SettlePayButton } from './components/PayButton';
export { Web3SettleTopUpModal } from './components/TopUpModal';
export { ChainSelector } from './components/ChainSelector';
export { TokenSelector } from './components/TokenSelector';
export { TransactionStatus } from './components/TransactionStatus';
export { WalletConnect } from './components/WalletConnect';

// ── Hooks ────────────────────────────────────────────────────────────────────
export { useWeb3Settle } from './hooks/useWeb3Settle';
export { usePayment } from './hooks/usePayment';
export { useWallet } from './hooks/useWallet';

// ── EVM utilities ────────────────────────────────────────────────────────────
export {
  estimateEvmGas,
  estimateEvmApproveGas,
} from './evm/estimateGas';
export type {
  GasEstimate,
  EvmGasBreakdown,
  SolanaGasBreakdown,
  TronGasBreakdown,
  FeeOracleOptions,
  EstimateEvmGasInput,
  EstimateApproveGasInput,
} from './evm/estimateGas';
export {
  detectPermitSupport,
  signPermit,
  buildPermitTypedData,
  validatePermitSignature,
  assertDeadlineFresh,
  isPermitDomainKnown,
  permitDomainKey,
  UnknownPermitTokenError,
} from './evm/permit';
export type {
  PermitSupport,
  SignPermitInput,
  PermitSignature,
} from './evm/permit';

// ── Telemetry ────────────────────────────────────────────────────────────────
export {
  buildTelemetryEvent,
  hashWalletAddress,
  redactErrorMessage,
  safeEmit,
  todayUtc,
} from './core/telemetry';
export type {
  TelemetryEvent,
  TelemetryCallback,
  TelemetryChain,
  TelemetryPhase,
  BuildEventInput,
} from './core/telemetry';

// ── Confirmation policy (Segment 2.2) ───────────────────────────────────────
// Cross-chain abstraction over per-chain confirmation/finality. Storefronts
// should consume `defaultConfirmationPolicy` instead of branching on
// `chainId` to decide "is this safe yet". See `core/ConfirmationPolicy.ts`.
export {
  DefaultConfirmationPolicy,
  defaultConfirmationPolicy,
  createHighValueConfirmationPolicy,
  DEFAULT_CONFIRMATION_THRESHOLDS,
  CHAIN_FAMILY_REGISTRY,
  DEFAULT_SECONDS_TO_FINALITY,
} from './core/ConfirmationPolicy';
export type {
  ConfirmationPolicy,
  ConfirmationProgress,
  ChainFamily,
  SolanaCommitmentLevel,
} from './core/ConfirmationPolicy';
export { evmConfirmationPolicy } from './evm/confirmationPolicy';

// ── Core ─────────────────────────────────────────────────────────────────────
export { Web3SettleApiClient } from './core/api-client';
export {
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  getTokenBalance,
  getTokenDecimals,
  waitForReceipt,
  parseTokenAmount,
} from './core/contract';
export {
  getNativeTokenPrice,
  getTokenPrice,
  usdToNativeAmount,
  usdToTokenAmount,
  clearPriceCache,
} from './core/price-feed';
export {
  PAYMENT_CONTRACT_ABI,
  ERC20_ABI,
  DEFAULT_CHAINS,
  CHAIN_ICONS,
  COINGECKO_CHAIN_IDS,
  SESSION_POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
  PRICE_CACHE_TTL_MS,
  WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY,
  WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_SECONDARY,
  PAYMENT_CONFIG_MAX_AGE_MS,
  KNOWN_CONTRACT_ADDRESSES,
  SUPPORTED_ABI_VERSIONS,
  KNOWN_PERMIT_TOKENS,
} from './core/config';
export { canonicalJson } from './core/canonical-json';
export { verifyPaymentConfig } from './core/payment-config-verifier';
export type { PaymentConfigVerifyResult, PaymentConfigVerifyFailure } from './core/payment-config-verifier';

// ── Types ────────────────────────────────────────────────────────────────────
export {
  PaymentStatus,
  Web3SettleApiError,
  TokenConfigSchema,
  ChainConfigSchema,
  PaymentConfigSchema,
  PaymentSessionSchema,
  CreateSessionResponseSchema,
  Web3SettleConfigSchema,
  SignedPaymentConfigEnvelopeSchema,
} from './core/types';
export type {
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
} from './core/types';

// ── i18n (opt-in) ────────────────────────────────────────────────────────────
// Consumers who use i18next can inject SDK strings into their own instance via
// addSdkResourcesTo(i18n); or use ensureSdkI18n() to get a standalone instance.
export {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  SDK_NAMESPACE,
  ensureSdkI18n,
  addSdkResourcesTo,
} from './i18n';
export type { SupportedLocale } from './i18n';

// ── Styles (import separately: import '@web3settle/merchant-sdk/styles.css') ─
