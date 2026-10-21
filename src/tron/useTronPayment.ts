import { useCallback, useState } from 'react';
import { PaymentStatus, type ChainConfig, type TokenSelection } from '../core/types';
import { classifyError, PaymentPipelineError } from '../core/pipeline';
import { resolveAttribution, type PayInMode, type ResolvedAttribution } from '../core/payment-reference';
import { useTronWeb3SettleContext } from './TronProvider';
import {
  buildTelemetryEvent,
  hashWalletAddress,
  safeEmit,
  todayUtc,
  type TelemetryCallback,
  type TelemetryPhase,
} from '../core/telemetry';

export interface TronStartPaymentOpts {
  /**
   * The bytes32 `paymentReference` your backend got from `POST /api/payment/create` for this
   * order. The hook then calls `payInNativeWithReference` / `payInTokenWithReference`
   * (MerchantPayIn V3.2.3) and the gateway attributes the deposit to that request — same contract
   * as the EVM `usePayment`.
   */
  paymentReference?: `0x${string}`;
  /**
   * `'attributed'` (default) requires `paymentReference` and refuses to prompt the wallet without
   * one. `'unattributed'` sends the plain `payIn*` — the deposit reaches your webhook with no
   * `paymentRequestId` / `metadata`. Explicit opt-in only.
   */
  mode?: PayInMode;
  /**
   * Pre-quoted amount in the asset's smallest unit (sun, or raw TRC-20 units), decimal string.
   * When set the hook sends exactly this instead of quoting again — so the amount the payment was
   * created for and the amount sent cannot drift apart (the gateway links only a deposit of at
   * least the requested amount).
   */
  atomicAmount?: string;
  onTelemetry?: TelemetryCallback;
  walletId?: string;
  contractVersion?: string;
  /** Storefront identifier — folded into the wallet-digest salt (premortem F8). */
  storefrontId?: string;
}

interface UseTronPaymentReturn {
  status: PaymentStatus;
  txHash: string | null;
  error: string | null;
  startPayment: (
    amount: number,
    chain: ChainConfig,
    token: TokenSelection,
    opts?: TronStartPaymentOpts,
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
        return 'Transaction timed out waiting for confirmation';
      case 'unknown':
        return err.message;
    }
  }
  if (classifyError(err) === 'user-rejected') return 'Transaction rejected by user';
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

/** Payment hook for the TRON subpath. Mirrors `usePayment()` from the EVM root. */
export function useTronPayment(): UseTronPaymentReturn {
  const { pipeline, wallet } = useTronWeb3SettleContext();

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
      opts: TronStartPaymentOpts = {},
    ) => {
      if (!wallet.connected || !wallet.address) {
        setError('TRON wallet not connected');
        setStatus(PaymentStatus.Error);
        return;
      }

      // Decide attribution before anything reaches the wallet: attributed mode (the default)
      // never prompts without a valid reference.
      let attribution: ResolvedAttribution;
      try {
        attribution = resolveAttribution({ paymentReference: opts.paymentReference, mode: opts.mode });
      } catch (err) {
        setError(classifyMessage(err));
        setStatus(PaymentStatus.Error);
        return;
      }
      const paymentReference = attribution.mode === 'attributed' ? attribution.paymentReference : undefined;

      setStatus(PaymentStatus.Connecting);
      setTxHash(null);
      setError(null);

      let phase: TelemetryPhase = 'connect';
      try {
        phase = 'quote';
        const raw = opts.atomicAmount !== undefined
          ? BigInt(opts.atomicAmount)
          : await pipeline.quoteAmount(amount, chain, token);

        if (await pipeline.needsApproval(chain, token, raw)) {
          phase = 'approve';
          setStatus(PaymentStatus.Approving);
          const approveTx = await pipeline.approve(chain, token, raw);
          // Confirm the approval lands before submitting the pay-in — otherwise
          // the pay-in would revert with "insufficient allowance".
          const approveReceipt = await pipeline.waitForReceipt(approveTx);
          if (!approveReceipt.success) {
            throw new PaymentPipelineError('reverted', 'Approval transaction failed');
          }
        }

        phase = 'send';
        setStatus(PaymentStatus.Sending);
        const hash = await pipeline.execute(chain, token, raw, { paymentReference });
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
          const digest = await hashWalletAddress(wallet.address, opts.storefrontId, todayUtc());
          const errKind = err instanceof PaymentPipelineError ? err.kind : classifyError(err);
          safeEmit(opts.onTelemetry, buildTelemetryEvent({
            chain: 'tron',
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
    [pipeline, wallet.connected, wallet.address],
  );

  return { status, txHash, error, startPayment, reset };
}
