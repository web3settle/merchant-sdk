/**
 * EVM gas estimator (item 14.1).
 *
 * Returns a unified `GasEstimate` for the merchant's MerchantPayIn pay-in call
 * so the modal can show "≈ $0.27 fee" before the user signs. Closes GAP-17.
 *
 * Design choices:
 *   - We accept an optional `priceUsd` or `fetchPriceUsd` so the SDK never
 *     forces a network hit just to render a fee. Most merchants already have
 *     a quote in hand from `/quote`; passing the native-token price along is
 *     trivial. When omitted, the function returns `usd: null`.
 *   - The native-token estimate uses `eth_estimateGas` + `eth_gasPrice`.
 *     EIP-1559 networks return a baseFee + tip; the public client folds these
 *     into `gasPrice` for legacy callers, which is what we want here — a
 *     conservative ceiling rather than a precise tip recommendation.
 *   - For an ERC-20 pay-in we estimate `payInToken(token, amount)` directly.
 *     We do NOT roll the approval tx into the estimate — approvals only fire
 *     when allowance < amount, and most repeat customers won't see one.
 */
import {
  type Address,
  type PublicClient,
  encodeFunctionData,
  formatUnits,
} from 'viem';
import { PAYMENT_CONTRACT_ABI, ERC20_ABI } from '../core/config';
import { NATIVE_TOKEN_SENTINEL, type TokenSelection } from '../core/types';

/**
 * Unified shape returned by all three chain estimators. Native unit is
 * chain-specific (wei for EVM, lamports for Solana, sun for TRON), USD is
 * common.
 */
export interface GasEstimate {
  /** Total native fee, smallest unit (wei / lamports / sun). */
  native: bigint | number;
  /**
   * Approximate USD equivalent. `null` when the caller did not supply a
   * native-token price oracle — the SDK refuses to silently invent one.
   */
  usd: number | null;
  /** Per-chain breakdown for debugging / advanced UIs. */
  breakdown: EvmGasBreakdown | SolanaGasBreakdown | TronGasBreakdown;
}

export interface EvmGasBreakdown {
  family: 'evm';
  /** Gas units estimated for the call. */
  gasUnits: bigint;
  /** Gas price in wei (legacy) or effective wei-per-gas (EIP-1559 fold). */
  gasPriceWei: bigint;
  /** Whether the call was simulated against a native or token pay-in. */
  flow: 'native' | 'token';
}

// Re-exported by the chain-specific files so tests can typecheck.
export interface SolanaGasBreakdown {
  family: 'solana';
  /** Compute units required by the simulated tx. */
  computeUnits: number;
  /** Median priority fee in micro-lamports / CU at the moment of estimate. */
  microLamportsPerCu: number;
  /** Static SystemProgram tx fee (5000 lamports per signature). */
  baseLamports: number;
}

export interface TronGasBreakdown {
  family: 'tron';
  /** Energy units the call would consume. */
  energy: number;
  /** Bandwidth bytes the call would consume. */
  bandwidth: number;
  /** sun price per energy unit at estimate time (default 280 sun/energy). */
  sunPerEnergy: number;
}

/**
 * Optional fee oracle. The SDK can either be told the price up front, or be
 * given a fetch function the modal calls once. Passing both is fine —
 * `priceUsd` wins (zero-network path).
 */
export interface FeeOracleOptions {
  /** Price of the chain's native token in USD (e.g. 3500 for ETH). */
  priceUsd?: number;
  /**
   * Async fetcher invoked when `priceUsd` is omitted. Returns the price the
   * SDK should use for USD conversion. Throwing or returning a non-positive
   * number causes `usd: null` rather than a crash.
   */
  fetchPriceUsd?: (signal?: AbortSignal) => Promise<number>;
  /**
   * Multiplier applied to the raw estimate as a safety margin. Defaults to
   * 1.20. Set to 1.0 for advanced flows where the caller already pads.
   */
  safetyMultiplier?: number;
  /** Optional abort signal forwarded to `fetchPriceUsd`. */
  signal?: AbortSignal;
}

export interface EstimateEvmGasInput {
  /** Already-configured public client (chain-bound). */
  publicClient: PublicClient;
  /** Sender address — the EOA that would submit the pay-in. */
  account: Address;
  /** MerchantPayIn contract on the target chain. */
  contractAddress: Address;
  /** Native-token decimals — needed for the USD math. Defaults to 18. */
  nativeDecimals?: number;
  /** Either `"native"` for `payInNative`, or the ERC-20 contract address. */
  token: TokenSelection;
  /** Token amount (smallest unit for ERC-20, wei for native). */
  amount: bigint;
}

/**
 * Estimate gas for a MerchantPayIn pay-in. Returns the unified `GasEstimate`.
 * Throws when the public client refuses to estimate (e.g. revert, RPC down) —
 * callers should wrap in try/catch and fall back to a "fee unavailable" UI.
 */
export async function estimateEvmGas(
  input: EstimateEvmGasInput,
  fee: FeeOracleOptions = {},
): Promise<GasEstimate> {
  const decimals = input.nativeDecimals ?? 18;
  const safety = fee.safetyMultiplier ?? 1.2;

  let data: `0x${string}`;
  let value = 0n;
  let flow: 'native' | 'token';

  if (input.token === NATIVE_TOKEN_SENTINEL) {
    flow = 'native';
    data = encodeFunctionData({
      abi: PAYMENT_CONTRACT_ABI,
      functionName: 'payInNative',
    });
    value = input.amount;
  } else {
    flow = 'token';
    data = encodeFunctionData({
      abi: PAYMENT_CONTRACT_ABI,
      functionName: 'payInToken',
      args: [input.token as Address, input.amount],
    });
  }

  // 1. Gas units. We pass the value through so payable functions don't fail
  //    on a zero-balance check; the public client will simulate either way.
  const gasUnitsRaw = await input.publicClient.estimateGas({
    account: input.account,
    to: input.contractAddress,
    data,
    value,
  });
  // Apply safety multiplier in integer math: round up so we never undershoot.
  const safetyBps = BigInt(Math.round(safety * 10_000));
  const gasUnits = (gasUnitsRaw * safetyBps + 9_999n) / 10_000n;

  // 2. Gas price. Public client returns the network's recommended price —
  //    on EIP-1559 chains this is base + tip folded.
  const gasPriceWei = await input.publicClient.getGasPrice();

  const totalWei = gasUnits * gasPriceWei;

  const usd = await convertNativeToUsd(totalWei, decimals, fee);

  return {
    native: totalWei,
    usd,
    breakdown: {
      family: 'evm',
      gasUnits,
      gasPriceWei,
      flow,
    },
  };
}

/**
 * Estimate gas for an ERC-20 `approve()` separately so callers can show a
 * combined fee when an allowance bump is required. This is only invoked from
 * the modal when `checkAllowance < amount`.
 */
export interface EstimateApproveGasInput {
  publicClient: PublicClient;
  account: Address;
  tokenAddress: Address;
  spenderAddress: Address;
  amount: bigint;
  nativeDecimals?: number;
}

export async function estimateEvmApproveGas(
  input: EstimateApproveGasInput,
  fee: FeeOracleOptions = {},
): Promise<GasEstimate> {
  const decimals = input.nativeDecimals ?? 18;
  const safety = fee.safetyMultiplier ?? 1.2;
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [input.spenderAddress, input.amount],
  });
  const gasUnitsRaw = await input.publicClient.estimateGas({
    account: input.account,
    to: input.tokenAddress,
    data,
  });
  const safetyBps = BigInt(Math.round(safety * 10_000));
  const gasUnits = (gasUnitsRaw * safetyBps + 9_999n) / 10_000n;
  const gasPriceWei = await input.publicClient.getGasPrice();
  const totalWei = gasUnits * gasPriceWei;
  const usd = await convertNativeToUsd(totalWei, decimals, fee);
  return {
    native: totalWei,
    usd,
    breakdown: {
      family: 'evm',
      gasUnits,
      gasPriceWei,
      flow: 'token',
    },
  };
}

/**
 * Convert smallest-unit native to USD using the supplied oracle. Returns null
 * when no oracle is available or the fetcher misbehaves.
 */
async function convertNativeToUsd(
  totalNative: bigint,
  decimals: number,
  fee: FeeOracleOptions,
): Promise<number | null> {
  let priceUsd = fee.priceUsd;
  if (priceUsd === undefined && fee.fetchPriceUsd) {
    try {
      priceUsd = await fee.fetchPriceUsd(fee.signal);
    } catch {
      return null;
    }
  }
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  const nativeAmount = Number(formatUnits(totalNative, decimals));
  if (!Number.isFinite(nativeAmount)) return null;
  return nativeAmount * priceUsd;
}
