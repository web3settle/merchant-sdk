import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { TokenConfig, TokenSelection, TopUpModalProps } from '../core/types';
import { NATIVE_TOKEN_SENTINEL, PaymentStatus } from '../core/types';
import { useSolanaWeb3SettleContext } from './SolanaProvider';
import { useSolanaPayment } from './useSolanaPayment';
import { useWeb3Settle } from '../hooks/useWeb3Settle';
import { ChainSelector } from '../components/ChainSelector';
import { TokenSelector } from '../components/TokenSelector';
import { TransactionStatus } from '../components/TransactionStatus';
import { SolanaWalletConnect } from './SolanaWalletConnect';

type ModalStep = 'amount' | 'wallet' | 'token' | 'review' | 'processing' | 'result';

const STEP_TITLE: Record<ModalStep, (status: PaymentStatus) => string> = {
  amount: () => 'Enter Amount',
  wallet: () => 'Connect Wallet',
  token: () => 'Select Payment',
  review: () => 'Review Payment',
  processing: () => 'Processing',
  result: (s) => (s === PaymentStatus.Success ? 'Complete' : 'Failed'),
};

/**
 * Solana counterpart to `Web3SettleTopUpModal`. Shares `ChainSelector` +
 * `TokenSelector` + `TransactionStatus` with the EVM root but drives payments
 * through the Solana wallet-adapter instead of wagmi.
 *
 * The `TokenSelector` component is wagmi-aware (uses `usePublicClient` for
 * balances); it will simply show `--` balances on Solana chains since the
 * wagmi public client won't match. A Solana-native balance reader is future
 * work — the flow still works without it.
 */
export function SolanaTopUpModal({ isOpen, onClose, amount: initialAmount }: TopUpModalProps) {
  const { config } = useSolanaWeb3SettleContext();
  const { paymentConfig, isLoading: configLoading } = useWeb3Settle();
  const { publicKey, connected } = useWallet();
  const { startPayment, status, txHash, error, reset } = useSolanaPayment();

  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const amountInputId = useId();

  const [step, setStep] = useState<ModalStep>('amount');
  const [amount, setAmount] = useState<string>(initialAmount ? String(initialAmount) : '');
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [selectedToken, setSelectedToken] = useState<TokenSelection | null>(null);

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
      id: '00000000-0000-0000-0000-000000000000',
      amount: Number(amount),
      status: 'confirmed',
      txHash,
      chain: selectedChain?.name,
      token: isNativePayment
        ? selectedChain?.nativeCurrency?.symbol
        : selectedTokenConfig?.symbol,
    });
  }, [status, txHash, onSuccess, amount, selectedChain, isNativePayment, selectedTokenConfig]);

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
    setStep(connected ? 'token' : 'wallet');
  }, [amount, connected]);

  const handleWalletConnected = useCallback(() => {
    setStep('token');
  }, []);

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

  const handleConfirm = useCallback(() => {
    if (!selectedChain || !selectedToken) return;
    void startPayment(Number(amount), selectedChain, selectedToken);
  }, [amount, selectedChain, selectedToken, startPayment]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'wallet':
        setStep('amount');
        break;
      case 'token':
        setStep(connected ? 'amount' : 'wallet');
        break;
      case 'review':
        setStep('token');
        break;
      case 'amount':
      case 'processing':
      case 'result':
        break;
    }
  }, [step, connected]);

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
  const showBackButton = step === 'wallet' || step === 'token' || step === 'review';

  return (
    <div
      ref={backdropRef}
      role="presentation"
      onClick={handleBackdropClick}
      className="w3s-fixed w3s-inset-0 w3s-z-50 w3s-flex w3s-items-center w3s-justify-center w3s-bg-black/60 w3s-backdrop-blur-sm w3s-animate-[fadeIn_200ms_ease-out]"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w3s-relative w3s-w-full w3s-max-w-md w3s-mx-4 w3s-rounded-2xl w3s-border w3s-border-white/10 w3s-bg-[rgba(15,15,25,0.92)] w3s-backdrop-blur-xl w3s-shadow-[0_8px_32px_rgba(0,0,0,0.5)] w3s-overflow-hidden w3s-animate-[slideUp_300ms_ease-out] focus:w3s-outline-none"
      >
        <div className="w3s-flex w3s-items-center w3s-justify-between w3s-border-b w3s-border-white/10 w3s-px-6 w3s-py-4">
          <div className="w3s-flex w3s-items-center w3s-gap-2">
            {showBackButton && (
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

              {step === 'wallet' && <SolanaWalletConnect onConnected={handleWalletConnected} />}

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
                      walletAddress={publicKey?.toBase58()}
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
                          ? (selectedChain.nativeCurrency?.symbol ?? 'SOL')
                          : selectedTokenConfig?.symbol ?? ''
                      }
                    />
                    <Row
                      label="Wallet"
                      value={publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : '—'}
                      mono
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3 w3s-text-sm w3s-font-semibold w3s-text-white hover:w3s-bg-indigo-500 w3s-cursor-pointer"
                  >
                    Confirm Payment
                  </button>
                </div>
              )}

              {step === 'processing' && (
                <TransactionStatus
                  status={status}
                  txHash={txHash ?? undefined}
                  explorerUrl={selectedChain?.explorerUrl}
                />
              )}

              {step === 'result' && (
                <div className="w3s-flex w3s-flex-col w3s-gap-4">
                  <TransactionStatus
                    status={status}
                    txHash={txHash ?? undefined}
                    explorerUrl={selectedChain?.explorerUrl}
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
            Powered by <span className="w3s-text-indigo-400">Web3Settle</span> · Solana
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="w3s-flex w3s-justify-between">
      <span className="w3s-text-sm w3s-text-slate-400">{label}</span>
      <span className={`w3s-text-sm w3s-text-white ${mono ? 'w3s-font-mono' : ''}`}>{value}</span>
    </div>
  );
}
