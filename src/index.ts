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
} from './core/config';

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
