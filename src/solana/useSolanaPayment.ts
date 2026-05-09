import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PaymentStatus, type ChainConfig, type TokenSelection } from '../core/types';
import { classifyError, PaymentPipelineError } from '../core/pipeline';
import { useSolanaPipeline } from './SolanaProvider';
import {
  buildTelemetryEvent,
  hashWalletAddress,
  safeEmit,
  type TelemetryCallback,
  type TelemetryPhase,
} from '../core/telemetry';

interface SolanaStartPaymentOpts {
  onTelemetry?: TelemetryCallback;
  walletId?: string;
  contractVersion?: string;
}

interface UseSolanaPaymentReturn {
  status: PaymentStatus;
  txHash: string | null;
  error: string | null;
  startPayment: (
    amount: number,
    chain: ChainConfig,
    token: TokenSelection,
    opts?: SolanaStartPaymentOpts,
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
    async (
      amount: number,
      chain: ChainConfig,
      token: TokenSelection,
      opts: SolanaStartPaymentOpts = {},
    ) => {
      if (!wallet.publicKey) {
        setError('Wallet not connected');
        setStatus(PaymentStatus.Error);
        return;
      }

      setStatus(PaymentStatus.Connecting);
      setTxHash(null);
      setError(null);

      let phase: TelemetryPhase = 'connect';
      try {
        phase = 'quote';
        const raw = await pipeline.quoteAmount(amount, chain, token);

        phase = 'send';
        setStatus(PaymentStatus.Sending);
        const hash = await pipeline.execute(chain, token, raw);
        setTxHash(hash);

        phase = 'confirm';
        setStatus(PaymentStatus.Confirming);
        const receipt = await pipeline.waitForReceipt(hash);
        if (!receipt.success) {
          throw new PaymentPipelineError('reverted', 'Transaction failed on-chain');
        }

        setStatus(PaymentStatus.Success);
      } catch (err) {
        if (opts.onTelemetry) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const digest = await hashWalletAddress(wallet.publicKey?.toBase58());
          const errKind = err instanceof PaymentPipelineError ? err.kind : classifyError(err);
          safeEmit(opts.onTelemetry, buildTelemetryEvent({
            chain: 'solana',
            phase,
            errorCode: errKind,
            walletId: opts.walletId,
            contractVersion: opts.contractVersion,
            walletDigest: digest,
            rawMessage: errMsg,
          }));
        }
        setError(classifyMessage(err));
        setStatus(PaymentStatus.Error);
      }
    },
    [pipeline, wallet.publicKey],
  );

  return { status, txHash, error, startPayment, reset };
}
