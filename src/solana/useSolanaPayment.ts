import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PaymentStatus, type ChainConfig, type TokenSelection } from '../core/types';
import { classifyError, PaymentPipelineError } from '../core/pipeline';
import { useSolanaPipeline } from './SolanaProvider';

interface UseSolanaPaymentReturn {
  status: PaymentStatus;
  txHash: string | null;
  error: string | null;
  startPayment: (
    amount: number,
    chain: ChainConfig,
    token: TokenSelection,
  ) => Promise<void>;
  reset: () => void;
}

function classifyMessage(err: unknown): string {
  if (err instanceof PaymentPipelineError) {
    switch (err.kind) {
      case 'user-rejected':
        return 'Transaction rejected by user';
      case 'insufficient-funds':
        return 'Insufficient funds for this transaction';
      case 'wrong-network':
        return 'Wrong network — switch your wallet';
      case 'reverted':
        return 'Transaction failed on-chain';
      case 'timeout':
        return 'Transaction timed out';
      case 'unknown':
        return err.message;
    }
  }
  if (classifyError(err) === 'user-rejected') return 'Transaction rejected by user';
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

/** Payment hook for the Solana subpath. Mirrors `usePayment()` from the EVM root. */
export function useSolanaPayment(): UseSolanaPaymentReturn {
  const pipeline = useSolanaPipeline();
  const wallet = useWallet();

  const [status, setStatus] = useState<PaymentStatus>(PaymentStatus.Idle);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus(PaymentStatus.Idle);
    setTxHash(null);
    setError(null);
  }, []);

  const startPayment = useCallback(
    async (amount: number, chain: ChainConfig, token: TokenSelection) => {
      if (!wallet.publicKey) {
        setError('Wallet not connected');
        setStatus(PaymentStatus.Error);
        return;
      }

      setStatus(PaymentStatus.Connecting);
      setTxHash(null);
      setError(null);

      try {
        const raw = await pipeline.quoteAmount(amount, chain, token);

        setStatus(PaymentStatus.Sending);
        const hash = await pipeline.execute(chain, token, raw);
        setTxHash(hash);

        setStatus(PaymentStatus.Confirming);
        const receipt = await pipeline.waitForReceipt(hash);
        if (!receipt.success) {
          throw new PaymentPipelineError('reverted', 'Transaction failed on-chain');
        }

        setStatus(PaymentStatus.Success);
      } catch (err) {
        setError(classifyMessage(err));
        setStatus(PaymentStatus.Error);
      }
    },
    [pipeline, wallet.publicKey],
  );

  return { status, txHash, error, startPayment, reset };
}
