import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { TokenConfig, TokenSelection, TopUpModalProps } from '../core/types';
import { NATIVE_TOKEN_SENTINEL, PaymentStatus } from '../core/types';
import { useTronWeb3SettleContext } from './TronProvider';
import { useTronPayment } from './useTronPayment';
import { useWeb3Settle } from '../hooks/useWeb3Settle';
import { ChainSelector } from '../components/ChainSelector';
import { TokenSelector } from '../components/TokenSelector';
import { TransactionStatus } from '../components/TransactionStatus';
import { TronWalletConnect } from './TronWalletConnect';

type ModalStep = 'amount' | 'wallet' | 'token' | 'review' | 'processing' | 'result';

const STEP_TITLE: Record<ModalStep, (s: PaymentStatus) => string> = {
  amount: () => 'Enter Amount',
  wallet: () => 'Connect Wallet',
  token: () => 'Select Payment',
  review: () => 'Review Payment',
  processing: () => 'Processing',
  result: (s) => (s === PaymentStatus.Success ? 'Complete' : 'Failed'),
};

export function TronTopUpModal({ isOpen, onClose, amount: initialAmount, userId }: TopUpModalProps) {
  const { config, wallet, pipeline } = useTronWeb3SettleContext();
  const { paymentConfig, isLoading: configLoading } = useWeb3Settle();
  const { startPayment, status, txHash, error, reset } = useTronPayment();

  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const amountInputId = useId();

  const [step, setStep] = useState<ModalStep>('amount');
  const [amount, setAmount] = useState<string>(initialAmount ? String(initialAmount) : '');
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [selectedToken, setSelectedToken] = useState<TokenSelection | null>(null);
  // The merchant backend's createPayment step (paymentReference), mirrored from the EVM modal: its
  // failure is shown on the review step; `requestId` becomes the onSuccess session id.
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const selectedChain =
    paymentConfig?.chains.find((c) => c.chainId === selectedChainId) ?? null;
  const selectedTokenConfig: TokenConfig | null =
    selectedToken && selectedToken !== NATIVE_TOKEN_SENTINEL
      ? (selectedChain?.tokens.find((t) => t.address === selectedToken) ?? null)
      : null;
  const isNativePayment = selectedToken === NATIVE_TOKEN_SENTINEL;

  useEffect(() => {
    if (!isOpen) return;
    setStep(initialAmount ? 'wallet' : 'amount');
    setAmount(initialAmount ? String(initialAmount) : '');
    setSelectedChainId(null);
    setSelectedToken(null);
    setCreateError(null);
    setRequestId(null);
    reset();
  }, [isOpen, initialAmount, reset]);

  useEffect(() => {
    if (
      status === PaymentStatus.Sending ||
      status === PaymentStatus.Confirming ||
      status === PaymentStatus.Approving
    ) {
      setStep('processing');
    } else if (status === PaymentStatus.Success || status === PaymentStatus.Error) {
      setStep('result');
    }
  }, [status]);

  const { onSuccess, onError } = config;
  useEffect(() => {
    if (status !== PaymentStatus.Success || !txHash || !onSuccess) return;
    onSuccess({
      id: requestId ?? '00000000-0000-0000-0000-000000000000',
      amount: Number(amount),
      status: 'confirmed',
      txHash,
      chain: selectedChain?.name,
      token: isNativePayment
        ? selectedChain?.nativeCurrency?.symbol
        : selectedTokenConfig?.symbol,
    });
  }, [status, txHash, onSuccess, amount, selectedChain, isNativePayment, selectedTokenConfig, requestId]);

  useEffect(() => {
    if (status !== PaymentStatus.Error || !error || !onError) return;
    onError(new Error(error));
  }, [status, error, onError]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (step === 'amount' && amountInputRef.current) {
      amountInputRef.current.focus();
    } else {
      dialogRef.current?.focus();
    }
    return () => { previouslyFocused?.focus?.(); };
  }, [isOpen, step]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const handleAmountNext = useCallback(() => {
    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    setStep(wallet.connected ? 'token' : 'wallet');
  }, [amount, wallet.connected]);

  const handleWalletConnected = useCallback(() => { setStep('token'); }, []);

  const handleChainSelect = useCallback((chainId: number) => {
    setSelectedChainId(chainId);
    setSelectedToken(null);
  }, []);

  const handleTokenSelect = useCallback((tokenAddress: TokenSelection) => {
    setSelectedToken(tokenAddress);
  }, []);

  const handleReview = useCallback(() => {
    if (!selectedChainId || !selectedToken) return;
    setStep('review');
  }, [selectedChainId, selectedToken]);

  const { createPayment, payInMode } = config;
  const handleConfirm = useCallback(async () => {
    if (!selectedChain || !selectedToken || creatingPayment) return;
    setCreateError(null);
    const usd = Number(amount);
    // Attributed (the default): quote once, let the merchant backend create the payment for
    // exactly that amount and hand back its paymentReference, then prompt the wallet for the same
    // amount (atomicAmount) so what was requested and what is sent cannot drift apart.
    let paymentReference: `0x${string}` | undefined;
    let atomicAmount: string | undefined;
    if (payInMode !== 'unattributed') {
      if (!createPayment) {
        setCreateError(
          'Payments are not attributable: this storefront has no createPayment callback configured ' +
            '(Web3SettleConfig.createPayment), so the payment would reach the merchant without an order.',
        );
        return;
      }
      setCreatingPayment(true);
      try {
        const raw = await pipeline.quoteAmount(usd, selectedChain, selectedToken);
        const decimals = isNativePayment
          ? (selectedChain.nativeCurrency?.decimals ?? 6)
          : (selectedTokenConfig?.decimals ?? 6);
        atomicAmount = raw.toString();
        const created = await createPayment({
          chainId: selectedChain.chainId,
          chainName: selectedChain.name,
          token: selectedToken,
          tokenSymbol: isNativePayment
            ? (selectedChain.nativeCurrency?.symbol ?? 'TRX')
            : (selectedTokenConfig?.symbol ?? ''),
          decimals,
          atomicAmount,
          amount: formatAtomic(raw, decimals),
          amountUsd: usd,
          userId,
        });
        paymentReference = created.paymentReference;
        setRequestId(created.requestId ?? null);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Could not create the payment');
        return;
      } finally {
        setCreatingPayment(false);
      }
    }
    void startPayment(usd, selectedChain, selectedToken, {
      paymentReference,
      mode: payInMode,
      atomicAmount,
      onTelemetry: config.onTelemetry,
      contractVersion: config.contractVersion,
    });
  }, [amount, selectedChain, selectedToken, selectedTokenConfig, isNativePayment, creatingPayment, createPayment, payInMode, pipeline, startPayment, userId, config.onTelemetry, config.contractVersion]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'wallet':
        setStep('amount');
        break;
      case 'token':
        setStep(wallet.connected ? 'amount' : 'wallet');
        break;
      case 'review':
        setStep('token');
        break;
      case 'amount':
      case 'processing':
      case 'result':
        break;
    }
  }, [step, wallet.connected]);

  const handleResultAction = useCallback(() => {
    if (status === PaymentStatus.Error) {
      reset();
      setStep('review');
    } else {
      onClose();
    }
  }, [status, reset, onClose]);

  if (!isOpen) return null;

  const parsedAmount = parseFloat(amount);
  const isAmountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const showBack = step === 'wallet' || step === 'token' || step === 'review';

  return (
    <div
      ref={backdropRef}
      role="presentation"
      onClick={handleBackdropClick}
      className="w3s-fixed w3s-inset-0 w3s-z-50 w3s-flex w3s-items-center w3s-justify-center w3s-bg-black/60 w3s-backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w3s-relative w3s-w-full w3s-max-w-md w3s-mx-4 w3s-rounded-2xl w3s-border w3s-border-white/10 w3s-bg-[rgba(15,15,25,0.92)] w3s-backdrop-blur-xl w3s-shadow-[0_8px_32px_rgba(0,0,0,0.5)] w3s-overflow-hidden focus:w3s-outline-none"
      >
        <div className="w3s-flex w3s-items-center w3s-justify-between w3s-border-b w3s-border-white/10 w3s-px-6 w3s-py-4">
          <div className="w3s-flex w3s-items-center w3s-gap-2">
            {showBack && (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Back"
                className="w3s-mr-1 w3s-text-slate-400 hover:w3s-text-white w3s-cursor-pointer"
              >
                ←
              </button>
            )}
            <h2 id={titleId} className="w3s-text-lg w3s-font-semibold w3s-text-white">
              {STEP_TITLE[step](status)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w3s-text-slate-400 hover:w3s-text-white w3s-cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="w3s-px-6 w3s-py-5">
          {configLoading ? (
            <div role="status" className="w3s-flex w3s-items-center w3s-justify-center w3s-py-12">
              <div className="w3s-h-8 w3s-w-8 w3s-animate-spin w3s-rounded-full w3s-border-2 w3s-border-indigo-500 w3s-border-t-transparent" />
            </div>
          ) : (
            <>
              {step === 'amount' && (
                <div className="w3s-flex w3s-flex-col w3s-gap-4">
                  <div>
                    <label
                      htmlFor={amountInputId}
                      className="w3s-block w3s-text-sm w3s-font-medium w3s-text-slate-300 w3s-mb-2"
                    >
                      Amount (USD)
                    </label>
                    <input
                      id={amountInputId}
                      ref={amountInputRef}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); }}
                      placeholder="0.00"
                      className="w3s-w-full w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-py-3 w3s-px-4 w3s-text-2xl w3s-font-semibold w3s-text-white focus:w3s-border-indigo-500 w3s-outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAmountNext}
                    disabled={!isAmountValid}
                    className="w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3 w3s-text-sm w3s-font-semibold w3s-text-white hover:w3s-bg-indigo-500 disabled:w3s-opacity-40 w3s-cursor-pointer"
                  >
                    Continue
                  </button>
                </div>
              )}

              {step === 'wallet' && <TronWalletConnect onConnected={handleWalletConnected} />}

              {step === 'token' && paymentConfig && (
                <div className="w3s-flex w3s-flex-col w3s-gap-5">
                  <ChainSelector
                    chains={paymentConfig.chains}
                    selectedChainId={selectedChainId}
                    onSelect={handleChainSelect}
                  />
                  {selectedChain && (
                    <TokenSelector
                      tokens={selectedChain.tokens}
                      nativeCurrency={selectedChain.nativeCurrency}
                      selectedToken={selectedToken}
                      onSelect={handleTokenSelect}
                      walletAddress={wallet.address ?? undefined}
                      chainId={selectedChainId ?? undefined}
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleReview}
                    disabled={!selectedChainId || !selectedToken}
                    className="w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3 w3s-text-sm w3s-font-semibold w3s-text-white hover:w3s-bg-indigo-500 disabled:w3s-opacity-40 w3s-cursor-pointer"
                  >
                    Review Payment
                  </button>
                </div>
              )}

              {step === 'review' && selectedChain && (
                <div className="w3s-flex w3s-flex-col w3s-gap-4">
                  <div className="w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-p-4 w3s-flex w3s-flex-col w3s-gap-3">
                    <Row label="Amount" value={`$${parsedAmount.toFixed(2)} USD`} />
                    <Row label="Network" value={selectedChain.name} />
                    <Row
                      label="Token"
                      value={
                        isNativePayment
                          ? (selectedChain.nativeCurrency?.symbol ?? 'TRX')
                          : selectedTokenConfig?.symbol ?? ''
                      }
                    />
                    <Row
                      label="Wallet"
                      value={
                        wallet.address
                          ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                          : '—'
                      }
                      mono
                    />
                  </div>
                  {createError && (
                    <p role="alert" className="w3s-text-sm w3s-text-red-400">
                      {createError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => { void handleConfirm(); }}
                    disabled={creatingPayment}
                    className="w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3 w3s-text-sm w3s-font-semibold w3s-text-white hover:w3s-bg-indigo-500 disabled:w3s-opacity-40 w3s-cursor-pointer"
                  >
                    {creatingPayment ? 'Creating payment…' : 'Confirm Payment'}
                  </button>
                </div>
              )}

              {step === 'processing' && (
                <TransactionStatus
                  status={status}
                  txHash={txHash ?? undefined}
                  explorerUrl={selectedChain?.explorerUrl}
                  chainId={selectedChain?.chainId}
                />
              )}

              {step === 'result' && (
                <div className="w3s-flex w3s-flex-col w3s-gap-4">
                  <TransactionStatus
                    status={status}
                    txHash={txHash ?? undefined}
                    explorerUrl={selectedChain?.explorerUrl}
                    chainId={selectedChain?.chainId}
                    error={error ?? undefined}
                  />
                  <button
                    type="button"
                    onClick={handleResultAction}
                    className="w3s-w-full w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5 w3s-py-3 w3s-text-sm w3s-text-white hover:w3s-bg-white/10 w3s-cursor-pointer"
                  >
                    {status === PaymentStatus.Error ? 'Try Again' : 'Done'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="w3s-border-t w3s-border-white/5 w3s-px-6 w3s-py-3 w3s-text-center">
          <span className="w3s-text-xs w3s-text-slate-500">
            Powered by <span className="w3s-text-indigo-400">Web3Settle</span> · TRON
          </span>
        </div>
      </div>
    </div>
  );
}

/** Whole-unit decimal text for a smallest-unit amount (no viem on the TRON subpath). */
function formatAtomic(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="w3s-flex w3s-justify-between">
      <span className="w3s-text-sm w3s-text-slate-400">{label}</span>
      <span className={`w3s-text-sm w3s-text-white ${mono ? 'w3s-font-mono' : ''}`}>{value}</span>
    </div>
  );
}
