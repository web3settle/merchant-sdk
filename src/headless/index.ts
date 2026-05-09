/**
 * Framework-agnostic "headless" layer (item 14.5).
 *
 * This module exposes the SDK's logic without any React rendering. The shapes
 * are intentionally plain functions returning plain objects so a non-React
 * stack — Vue composables, Svelte stores, Preact signals, vanilla JS, the
 * Web Component in `src/wc/` — can wire them up however it likes.
 *
 * The naming starts with `use` to mirror React conventions so React users can
 * import either layer interchangeably; nothing in this directory imports React.
 */
export {
  createPayButtonController,
  type PayButtonState,
  type PayButtonController,
  type PayButtonControllerOptions,
} from './usePayButton';
export {
  createWalletConnectController,
  type WalletConnectState,
  type WalletConnectController,
  type WalletConnectControllerOptions,
} from './useWalletConnect';
export {
  createGasEstimateController,
  type GasEstimateState,
  type GasEstimateController,
  type GasEstimateControllerOptions,
} from './useGasEstimate';
