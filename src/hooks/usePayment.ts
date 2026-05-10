import { useState, useCallback, useRef } from 'react';
import { useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { parseUnits } from 'viem';
import { PaymentStatus, NATIVE_TOKEN_SENTINEL, type ChainConfig, type TokenSelection } from '../core/types';
import {
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  submitPermit,
  waitForReceipt,
} from '../core/contract';
import { usdToNativeAmount, usdToTokenAmount } from '../core/price-feed';
import { classifyError as classifyErrorKind } from '../core/pipeline';
import {
  buildTelemetryEvent,
  hashWalletAddress,
  safeEmit,
  todayUtc,
  type TelemetryCallback,
  type TelemetryPhase,
} from '../core/telemetry';
import { detectPermitSupport, signPermit, isPermitDomainKnown, UnknownPermitTokenError } from '../evm/permit';
import {
  defaultConfirmationPolicy,
  type ConfirmationPolicy,
} from '../core/ConfirmationPolicy';

interface StartPaymentOptions {
  /**
   * Pre-fetched atomic token amount (smallest unit, decimal string) from the server-side
   * <c>/quote</c> endpoint. When provided, the hook skips its own CoinGecko-based conversion
   * and signs exactly this number — the chain-of-trust runs server → SDK → wallet. The legacy
   * client-side price-feed path remains as the fallback for non-EVM chains and for any caller
   * that hasn't been migrated to the quote endpoint.
   */
  atomicAmount?: string;
  /**
   * Optional opt-in telemetry hook. The hook also reads a callback off the
   * `Web3SettleProvider` config; this prop wins for tests and ad-hoc calls.
   */
  onTelemetry?: TelemetryCallback;
  /** Wallet provider id for telemetry. e.g. "injected", "walletConnect". */
  walletId?: string;
  /** Contract version for telemetry. */
  contractVersion?: string;
  /**
   * Storefront identifier — folded into the wallet-digest salt so two shops
   * of the same wallet do not produce the same digest (premortem F8).
   */
  storefrontId?: string;
  /**
   * EIP-2612 permit policy (item 14.6).
   *
   *   - `"auto"` (default): probe the token; use permit when supported, fall
   *     back to `approve()` when not. This is the value most merchants want.
   *   - `"never"`: always use `approve()`. Useful when the merchant has CSP
   *     rules that block the EIP-712 sign popup.
   *   - `"require"`: only use permit. Throws if the token doesn't support it.
   *     Lets advanced merchants enforce the cheaper path.
   *
   * Permit lets the user sign an off-chain EIP-712 message instead of paying
   * gas for an `approve()` tx — saves ~$0.50 of gas + one wallet popup.
   */
  permit?: 'auto' | 'never' | 'require';
  /** Permit deadline in unix-seconds. Defaults to `now + 30*60`. */
  permitDeadlineSeconds?: number;
  /**
   * Confirmation policy (Segment 2.2). When supplied, the hook delegates depth
   * resolution (and Solana commitment selection) to the policy instead of
   * branching on `chain.chainId`. Defaults to {@link defaultConfirmationPolicy}.
   * `chain.confirmations` continues to take precedence when set — the policy
   * only fills in the gap when the per-chain override is absent.
   */
  confirmationPolicy?: ConfirmationPolicy;
}

interface UsePaymentReturn {
  status: PaymentStatus;
  txHash: string | null;
  error: string | null;
  startPayment: (
    amount: number,
    chain: ChainConfig,
    token: TokenSelection,
    opts?: StartPaymentOptions,
  ) => Promise<void>;
  reset: () => void;
}

function classifyError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('User rejected')) return 'Transaction rejected by user';
    if (msg.includes('insufficient funds')) return 'Insufficient funds for this transaction';
    return msg;
  }
  return 'An unexpected error occurred';
}

export function usePayment(): UsePaymentReturn {
  const [status, setStatus] = useState<PaymentStatus>(PaymentStatus.Idle);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus(PaymentStatus.Idle);
    setTxHash(null);
    setError(null);
  }, []);

  const startPayment = useCallback(
    async (
      amount: number,
      chain: ChainConfig,
      token: TokenSelection,
      opts: StartPaymentOptions = {},
    ): Promise<void> => {
      if (!walletClient) {
        setError('Wallet not connected');
        setStatus(PaymentStatus.Error);
        return;
      }
      if (!publicClient) {
        setError('Public client not available');
        setStatus(PaymentStatus.Error);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus(PaymentStatus.Connecting);
      setTxHash(null);
      setError(null);

      // Pre-build the telemetry context once so all catch sites share state.
      let phase: TelemetryPhase = 'connect';
      const emit = async (rawErr: unknown) => {
        const callback = opts.onTelemetry;
        if (!callback) return;
        const errMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
        const [signer] = await walletClient.getAddresses().catch(() => [undefined]);
        const digest = await hashWalletAddress(signer, opts.storefrontId, todayUtc());
        safeEmit(callback, buildTelemetryEvent({
          chain: 'evm',
          phase,
          errorCode: classifyErrorKind(rawErr),
          walletId: opts.walletId,
          contractVersion: opts.contractVersion,
          walletDigest: digest,
          rawMessage: errMsg,
        }));
      };

      try {
        phase = 'switch-network';
        const currentChainId = await walletClient.getChainId();
        if (currentChainId !== chain.chainId) {
          await switchChainAsync({ chainId: chain.chainId });
        }

        const contractAddress = chain.contractAddress as `0x${string}`;

        if (token === NATIVE_TOKEN_SENTINEL) {
          const nativeDecimals = chain.nativeCurrency?.decimals ?? 18;
          let weiAmount: bigint;
          if (opts.atomicAmount) {
            // Server quote: trust the atomic amount verbatim.
            weiAmount = BigInt(opts.atomicAmount);
          } else {
            // Legacy CoinGecko path — kept for tests and pre-quote callers.
            phase = 'quote';
            const nativeAmount = await usdToNativeAmount(amount, chain.chainId, controller.signal);
            weiAmount = parseUnits(nativeAmount.toFixed(18), nativeDecimals);
          }

          phase = 'send';
          setStatus(PaymentStatus.Sending);
          const hash = await executePayInNative(walletClient, contractAddress, weiAmount);
          setTxHash(hash);

          phase = 'confirm';
          setStatus(PaymentStatus.Confirming);
          // Segment 2.2: depth comes from the policy (which honours
          // `chain.confirmations` when set, falls back to the SPD-canonical
          // table otherwise). Storefronts no longer need to branch on
          // chainId.
          const policy = opts.confirmationPolicy ?? defaultConfirmationPolicy;
          const depth = policy.resolve(chain);
          const receipt = await waitForReceipt(publicClient, hash, depth);
          if (receipt.status === 'reverted') {
            throw new Error('Transaction reverted on-chain');
          }
          setStatus(PaymentStatus.Success);
          return;
        }

        const tokenAddress = token as `0x${string}`;
        const tokenConfig = chain.tokens.find((t) => t.address === token);
        if (!tokenConfig) {
          throw new Error(`Token ${token} not found in chain configuration`);
        }

        let rawAmount: bigint;
        if (opts.atomicAmount) {
          rawAmount = BigInt(opts.atomicAmount);
        } else {
          const tokenAmount = usdToTokenAmount(amount, tokenConfig.symbol);
          rawAmount = parseUnits(
            tokenAmount.toFixed(tokenConfig.decimals),
            tokenConfig.decimals,
          );
        }

        const [ownerAddress] = await walletClient.getAddresses();
        if (!ownerAddress) throw new Error('No wallet account connected');

        const currentAllowance = await checkAllowance(
          publicClient,
          tokenAddress,
          ownerAddress,
          contractAddress,
        );

        if (currentAllowance < rawAmount) {
          // EIP-2612 permit path (item 14.6). Strategy:
          //   1. detect support (cheap — three view calls);
          //   2. sign EIP-712 typed data;
          //   3. submit `permit(...)` directly to the token (still on-chain,
          //      but allowed to be a meta-tx in future). The user sees one
          //      popup for sign + one for the pay-in instead of two full
          //      transactions for approve + pay-in.
          // Falls back gracefully when `permit !== "require"`.
          const permitMode = opts.permit ?? 'auto';
          let permitHandled = false;
          if (permitMode !== 'never') {
            phase = 'permit';
            const support = await detectPermitSupport(publicClient, tokenAddress, ownerAddress);
            if (support.supported && support.name && support.nonce !== undefined) {
              // Premortem F3: do not silently sign permits for token domains
              // we don't recognise. A typo-squat that returns name: "USD Coin"
              // defeats the user's wallet review (the address is the only
              // thing that differs). Auto path falls back to approve();
              // require path raises so callers can surface the issue.
              const versionToCheck = support.version ?? '1';
              const known = isPermitDomainKnown(
                support.name,
                versionToCheck,
                chain.chainId,
                tokenAddress,
              );
              if (!known) {
                if (permitMode === 'require') {
                  throw new UnknownPermitTokenError();
                }
                // permitMode === 'auto': leave permitHandled=false → approve() path runs.
              } else {
              const deadline = BigInt(
                opts.permitDeadlineSeconds ?? Math.floor(Date.now() / 1000) + 30 * 60,
              );
              const sig = await signPermit({
                walletClient,
                chainId: chain.chainId,
                tokenAddress,
                tokenName: support.name,
                tokenVersion: support.version,
                owner: ownerAddress,
                spender: contractAddress,
                value: rawAmount,
                nonce: support.nonce,
                deadline,
              });
              const permitHash = await submitPermit(walletClient, tokenAddress, {
                owner: ownerAddress,
                spender: contractAddress,
                value: rawAmount,
                deadline,
                v: sig.v,
                r: sig.r,
                s: sig.s,
              });
              await waitForReceipt(publicClient, permitHash);
              permitHandled = true;
              }
            } else if (permitMode === 'require') {
              throw new Error('Token does not support EIP-2612 permit');
            }
          }
          if (!permitHandled) {
            phase = 'approve';
            setStatus(PaymentStatus.Approving);
            const approveHash = await approveToken(
              walletClient,
              tokenAddress,
              contractAddress,
              rawAmount,
            );
            await waitForReceipt(publicClient, approveHash);
          }
        }

        phase = 'send';
        setStatus(PaymentStatus.Sending);
        const hash = await executePayInToken(
          walletClient,
          contractAddress,
          tokenAddress,
          rawAmount,
        );
        setTxHash(hash);

        phase = 'confirm';
        setStatus(PaymentStatus.Confirming);
        // Segment 2.2: same policy resolution as the native branch.
        const policy = opts.confirmationPolicy ?? defaultConfirmationPolicy;
        const depth = policy.resolve(chain);
        const receipt = await waitForReceipt(publicClient, hash, depth);
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }
        setStatus(PaymentStatus.Success);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus(PaymentStatus.Idle);
          return;
        }
        // Telemetry breadcrumb (item 14.2). Awaited so the digest hash lands
        // before we surface the error to the user — the callback itself is
        // sync, the await here is for the sha-256.
        await emit(err);
        setError(classifyError(err));
        setStatus(PaymentStatus.Error);
      }
    },
    [walletClient, publicClient, switchChainAsync],
  );

  return { status, txHash, error, startPayment, reset };
}
