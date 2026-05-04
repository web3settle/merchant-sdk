import { useState, useCallback, useRef } from 'react';
import { useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { parseUnits } from 'viem';
import { PaymentStatus, NATIVE_TOKEN_SENTINEL, type ChainConfig, type TokenSelection } from '../core/types';
import {
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  waitForReceipt,
} from '../core/contract';
import { usdToNativeAmount, usdToTokenAmount } from '../core/price-feed';

interface StartPaymentOptions {
  /**
   * Pre-fetched atomic token amount (smallest unit, decimal string) from the server-side
   * <c>/quote</c> endpoint. When provided, the hook skips its own CoinGecko-based conversion
   * and signs exactly this number — the chain-of-trust runs server → SDK → wallet. The legacy
   * client-side price-feed path remains as the fallback for non-EVM chains and for any caller
   * that hasn't been migrated to the quote endpoint.
   */
  atomicAmount?: string;
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

      try {
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
            const nativeAmount = await usdToNativeAmount(amount, chain.chainId, controller.signal);
            weiAmount = parseUnits(nativeAmount.toFixed(18), nativeDecimals);
          }

          setStatus(PaymentStatus.Sending);
          const hash = await executePayInNative(walletClient, contractAddress, weiAmount);
          setTxHash(hash);

          setStatus(PaymentStatus.Confirming);
          const receipt = await waitForReceipt(publicClient, hash, chain.confirmations);
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
          setStatus(PaymentStatus.Approving);
          const approveHash = await approveToken(
            walletClient,
            tokenAddress,
            contractAddress,
            rawAmount,
          );
          await waitForReceipt(publicClient, approveHash);
        }

        setStatus(PaymentStatus.Sending);
        const hash = await executePayInToken(
          walletClient,
          contractAddress,
          tokenAddress,
          rawAmount,
        );
        setTxHash(hash);

        setStatus(PaymentStatus.Confirming);
        const receipt = await waitForReceipt(publicClient, hash, chain.confirmations);
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }
        setStatus(PaymentStatus.Success);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus(PaymentStatus.Idle);
          return;
        }
        setError(classifyError(err));
        setStatus(PaymentStatus.Error);
      }
    },
    [walletClient, publicClient, switchChainAsync],
  );

  return { status, txHash, error, startPayment, reset };
}
