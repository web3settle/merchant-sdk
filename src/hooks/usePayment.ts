import { useState, useCallback, useRef } from 'react';
import { useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { parseUnits } from 'viem';
import { PaymentStatus, type ChainConfig } from '../core/types';
import {
  executePayInNative,
  executePayInToken,
  approveToken,
  checkAllowance,
  waitForReceipt,
} from '../core/contract';
import { usdToNativeAmount, usdToTokenAmount } from '../core/price-feed';

interface UsePaymentReturn {
  status: PaymentStatus;
  txHash: string | null;
  error: string | null;
  startPayment: (amount: number, chain: ChainConfig, token: string | 'native') => Promise<void>;
  reset: () => void;
}

/**
 * Hook managing the full payment lifecycle:
 * 1. Switch chain (if needed)
 * 2. Convert USD amount to token amount
 * 3. Approve ERC-20 (if token payment and insufficient allowance)
 * 4. Send transaction (payInNative or payInToken)
 * 5. Wait for on-chain confirmation
 */
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
    setStatus(PaymentStatus.Idle);
    setTxHash(null);
    setError(null);
  }, []);

  const startPayment = useCallback(
    async (amount: number, chain: ChainConfig, token: string | 'native') => {
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

      abortRef.current = new AbortController();
      setStatus(PaymentStatus.Connecting);
      setTxHash(null);
      setError(null);

      try {
        // Switch chain if necessary
        const currentChainId = await walletClient.getChainId();
        if (currentChainId !== chain.chainId) {
          await switchChainAsync({ chainId: chain.chainId });
        }

        const contractAddress = chain.contractAddress as `0x${string}`;

        if (token === 'native') {
          // Native payment flow
          const nativeDecimals = chain.nativeCurrency?.decimals ?? 18;
          const nativeAmount = await usdToNativeAmount(
            amount,
            chain.chainId,
            abortRef.current.signal,
          );
          const weiAmount = parseUnits(nativeAmount.toFixed(18), nativeDecimals);

          setStatus(PaymentStatus.Sending);
          const hash = await executePayInNative(walletClient, contractAddress, weiAmount);
          setTxHash(hash);

          setStatus(PaymentStatus.Confirming);
          const receipt = await waitForReceipt(publicClient, hash, chain.confirmations);

          if (receipt.status === 'reverted') {
            throw new Error('Transaction reverted on-chain');
          }

          setStatus(PaymentStatus.Success);
        } else {
          // ERC-20 token payment flow
          const tokenAddress = token as `0x${string}`;
          const tokenConfig = chain.tokens.find((t) => t.address === token);
          if (!tokenConfig) {
            throw new Error(`Token ${token} not found in chain configuration`);
          }

          const tokenAmount = usdToTokenAmount(amount, tokenConfig.symbol);
          const rawAmount = parseUnits(tokenAmount.toFixed(tokenConfig.decimals), tokenConfig.decimals);

          // Check allowance
          const [ownerAddress] = await walletClient.getAddresses();
          if (!ownerAddress) throw new Error('No wallet account connected');

          const currentAllowance = await checkAllowance(
            publicClient,
            tokenAddress,
            ownerAddress,
            contractAddress,
          );

          // Approve if needed
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

          // Send payment
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
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus(PaymentStatus.Idle);
          return;
        }

        const message =
          err instanceof Error
            ? err.message.includes('User rejected')
              ? 'Transaction rejected by user'
              : err.message.includes('insufficient funds')
                ? 'Insufficient funds for this transaction'
                : err.message
            : 'An unexpected error occurred';

        setError(message);
        setStatus(PaymentStatus.Error);
      }
    },
    [walletClient, publicClient, switchChainAsync],
  );

  return { status, txHash, error, startPayment, reset };
}
