import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import type { ChainConfig, TopUpModalProps } from '../core/types';
import { NATIVE_TOKEN_SENTINEL, PaymentStatus } from '../core/types';
import { useWeb3SettleContext } from './Web3SettleProvider';
import { useWallet } from '../hooks/useWallet';
import { usePayment } from '../hooks/usePayment';
import { useQuote } from '../hooks/useQuote';
import { useWeb3Settle } from '../hooks/useWeb3Settle';
import { CHAIN_ICONS } from '../core/config';
import { getTokenBalance } from '../core/contract';
import { defaultConfirmationPolicy } from '../core/ConfirmationPolicy';

// Wagmi is configured for these EVM chains in Web3SettleProvider. Solana / Tron flow through
// dedicated sub-entrypoints (`@web3settle/merchant-sdk/solana`, `/tron`) — the main modal is
// EVM-only on purpose, so the storefront's non-EVM chains are filtered from the picker.
const SUPPORTED_EVM_CHAIN_IDS = new Set([1, 137, 8453]);

interface TokenOption {
  /** Selection sentinel: token address for ERC20s, the literal "native" for the gas token. */
  value: string;
  /** Display symbol (e.g., USDT, ETH). */
  symbol: string;
  /** Decimals — used when formatting on-chain balances and quoted amounts. */
  decimals: number;
  /** Whether this option is the chain's native asset. */
  isNative: boolean;
  /** Optional icon URL. */
  iconUrl?: string;
}

function buildTokenOptions(chain: ChainConfig): TokenOption[] {
  const options: TokenOption[] = [];
  if (chain.nativeCurrency) {
    options.push({
      value: NATIVE_TOKEN_SENTINEL,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      isNative: true,
    });
  }
  for (const t of chain.tokens) {
    options.push({
      value: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      isNative: false,
      iconUrl: t.iconUrl,
    });
  }
  return options;
}

/**
 * Picks the most useful default token: stablecoins win over volatile assets so the merchant's
 * USD price translates cleanly. Falls back to native if nothing else is configured.
 */
function pickDefaultToken(options: TokenOption[]): TokenOption | null {
  if (options.length === 0) return null;
  const preferredOrder = ['USDT', 'USDC', 'DAI'];
  for (const sym of preferredOrder) {
    const hit = options.find((o) => o.symbol.toUpperCase() === sym && !o.isNative);
    if (hit) return hit;
  }
  const firstErc20 = options.find((o) => !o.isNative);
  return firstErc20 ?? options[0] ?? null;
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`w3s-animate-spin ${className ?? ''}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="w3s-opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="w3s-opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  );
}

export function Web3SettleTopUpModal({
  isOpen,
  onClose,
  amount: fixedAmount,
}: TopUpModalProps) {
  const { config } = useWeb3SettleContext();
  const { paymentConfig, isLoading: configLoading, error: configError, refetch: refetchConfig } =
    useWeb3Settle();
  const wallet = useWallet();
  const { startPayment, status, txHash, error: paymentError, reset: resetPayment } = usePayment();

  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const amountInputId = useId();

  // ── State ────────────────────────────────────────────────────────────────
  // `enteredAmount` only matters when the merchant didn't fix `amount` via prop. The effective
  // amount used everywhere downstream (quote, payment) is the merge of fixedAmount + entered.
  const [enteredAmount, setEnteredAmount] = useState<string>('');
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [showConnectorList, setShowConnectorList] = useState(false);

  // Reset on open so opening the modal twice in a row doesn't keep stale state from the first
  // round (esp. payment status — closing on success and re-opening should give a fresh form).
  useEffect(() => {
    if (!isOpen) return;
    setEnteredAmount('');
    setSelectedChainId(null);
    setSelectedToken(null);
    setTokenBalance(null);
    setShowConnectorList(false);
    resetPayment();
  }, [isOpen, resetPayment]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const evmChains = useMemo(
    () => paymentConfig?.chains.filter((c) => SUPPORTED_EVM_CHAIN_IDS.has(c.chainId)) ?? [],
    [paymentConfig],
  );
  const selectedChain = evmChains.find((c) => c.chainId === selectedChainId) ?? null;
  const tokenOptions = useMemo(
    () => (selectedChain ? buildTokenOptions(selectedChain) : []),
    [selectedChain],
  );
  const selectedTokenOption = tokenOptions.find((t) => t.value === selectedToken) ?? null;

  const effectiveAmount = useMemo(() => {
    if (typeof fixedAmount === 'number' && fixedAmount > 0) return fixedAmount;
    const parsed = parseFloat(enteredAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [fixedAmount, enteredAmount]);

  // Auto-pick the first EVM chain so the user opens the modal already pointed at something.
  useEffect(() => {
    if (selectedChainId !== null) return;
    const first = evmChains[0];
    if (!first) return;
    setSelectedChainId(first.chainId);
  }, [evmChains, selectedChainId]);

  // Auto-pick the most useful token (USDT > USDC > first ERC20 > native) so the user only has
  // to override if they want a different one. Re-runs when the chain changes.
  useEffect(() => {
    if (tokenOptions.length === 0) {
      setSelectedToken(null);
      return;
    }
    const stillValid = selectedToken && tokenOptions.some((o) => o.value === selectedToken);
    if (stillValid) return;
    const def = pickDefaultToken(tokenOptions);
    setSelectedToken(def?.value ?? null);
  }, [tokenOptions, selectedToken]);

  // ── Quote ────────────────────────────────────────────────────────────────
  const quoteToken = selectedToken === NATIVE_TOKEN_SENTINEL ? 'native' : selectedToken;
  const { quote, isLoading: quoteLoading, error: quoteError } = useQuote(
    selectedChain?.name ?? null,
    quoteToken,
    effectiveAmount,
    { enabled: isOpen && status === PaymentStatus.Idle && !!selectedChain && !!quoteToken },
  );

  // ── Token balance (best-effort; non-blocking) ──────────────────────────
  // Reads the wallet's balance for the selected token so the user sees whether they can afford
  // the quoted amount before signing. Failures are silent — the on-chain tx will reject if the
  // user really is short, and showing "—" is better than blocking the flow on RPC noise.
  const publicClient = usePublicClient({
    chainId: selectedChain?.chainId,
  });
  useEffect(() => {
    let cancelled = false;
    setTokenBalance(null);
    if (!wallet.address || !publicClient || !selectedChain || !selectedTokenOption) return;

    const loadBalance = async () => {
      try {
        if (selectedTokenOption.isNative) {
          const bal = await publicClient.getBalance({ address: wallet.address as `0x${string}` });
          if (!cancelled) {
            setTokenBalance(Number(formatUnits(bal, selectedTokenOption.decimals)).toFixed(4));
          }
        } else {
          const bal = await getTokenBalance(
            publicClient,
            selectedTokenOption.value as `0x${string}`,
            wallet.address as `0x${string}`,
          );
          if (!cancelled) {
            setTokenBalance(Number(formatUnits(bal, selectedTokenOption.decimals)).toFixed(4));
          }
        }
      } catch {
        if (!cancelled) setTokenBalance(null);
      }
    };
    void loadBalance();
    return () => { cancelled = true; };
  }, [wallet.address, publicClient, selectedChain, selectedTokenOption]);

  // ── Payment success/error → consumer callbacks ──────────────────────────
  const { onSuccess, onError } = config;
  useEffect(() => {
    if (status === PaymentStatus.Success && txHash && onSuccess) {
      onSuccess({
        id: '00000000-0000-0000-0000-000000000000',
        amount: effectiveAmount ?? 0,
        status: 'confirmed',
        txHash,
        chain: selectedChain?.name,
        token: selectedTokenOption?.symbol,
      });
    }
  }, [status, txHash, onSuccess, effectiveAmount, selectedChain, selectedTokenOption]);

  useEffect(() => {
    if (status === PaymentStatus.Error && paymentError && onError) {
      onError(new Error(paymentError));
    }
  }, [status, paymentError, onError]);

  // ── Modal chrome (Esc to close, focus trap-lite) ────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  // ── Action: pay ──────────────────────────────────────────────────────────
  const isProcessing =
    status === PaymentStatus.Connecting ||
    status === PaymentStatus.Approving ||
    status === PaymentStatus.Sending ||
    status === PaymentStatus.Confirming;

  const canPay =
    wallet.isConnected &&
    !!selectedChain &&
    !!selectedToken &&
    !!quote &&
    !quoteLoading &&
    !quoteError &&
    !isProcessing;

  const handlePay = useCallback(() => {
    if (!canPay || !selectedChain || !selectedToken || !quote || !effectiveAmount) return;
    void startPayment(effectiveAmount, selectedChain, selectedToken, {
      atomicAmount: quote.amountToken,
    });
  }, [canPay, selectedChain, selectedToken, quote, effectiveAmount, startPayment]);

  if (!isOpen) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  const showSuccess = status === PaymentStatus.Success;
  const showError = status === PaymentStatus.Error && paymentError;

  return (
    <div
      ref={backdropRef}
      role="presentation"
      onClick={handleBackdropClick}
      className="
        w3s-fixed w3s-inset-0 w3s-z-50
        w3s-flex w3s-items-center w3s-justify-center
        w3s-bg-black/60 w3s-backdrop-blur-sm
        w3s-animate-[fadeIn_200ms_ease-out]
      "
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="
          w3s-relative w3s-w-full w3s-max-w-md w3s-mx-4
          w3s-rounded-2xl w3s-border w3s-border-white/10
          w3s-bg-[rgba(15,15,25,0.95)] w3s-backdrop-blur-xl
          w3s-shadow-[0_8px_32px_rgba(0,0,0,0.5)]
          w3s-overflow-hidden
          w3s-animate-[slideUp_300ms_ease-out]
          focus:w3s-outline-none
        "
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="w3s-flex w3s-items-center w3s-justify-between w3s-border-b w3s-border-white/10 w3s-px-6 w3s-py-4">
          <h2 id={titleId} className="w3s-text-lg w3s-font-semibold w3s-text-white">
            {showSuccess ? 'Payment confirmed' : 'Pay with crypto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w3s-text-slate-400 hover:w3s-text-white w3s-transition-colors w3s-cursor-pointer"
          >
            <CloseIcon className="w3s-h-5 w3s-w-5" />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div className="w3s-px-6 w3s-py-5">
          {configLoading ? (
            <LoadingState />
          ) : configError ? (
            <ConfigErrorState error={configError} onRetry={refetchConfig} />
          ) : evmChains.length === 0 ? (
            <NoChainsState />
          ) : showSuccess ? (
            <SuccessState
              txHash={txHash}
              explorerUrl={selectedChain?.explorerUrl}
              amountTokenDisplay={quote?.amountTokenDisplay}
              tokenSymbol={selectedTokenOption?.symbol}
              chainName={selectedChain?.name}
              onClose={onClose}
            />
          ) : isProcessing ? (
            <ProcessingState
              status={status}
              txHash={txHash}
              explorerUrl={selectedChain?.explorerUrl}
              chainId={selectedChain?.chainId}
            />
          ) : (
            <div className="w3s-flex w3s-flex-col w3s-gap-4">
              {/* Amount */}
              <div className="w3s-flex w3s-flex-col w3s-gap-1.5">
                <label
                  htmlFor={amountInputId}
                  className="w3s-text-xs w3s-font-medium w3s-uppercase w3s-tracking-wide w3s-text-slate-400"
                >
                  Amount
                </label>
                {typeof fixedAmount === 'number' ? (
                  <div
                    id={amountInputId}
                    role="text"
                    className="
                      w3s-flex w3s-items-baseline w3s-gap-1
                      w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
                      w3s-px-4 w3s-py-3
                    "
                  >
                    <span className="w3s-text-2xl w3s-font-semibold w3s-text-white">
                      ${fixedAmount.toFixed(2)}
                    </span>
                    <span className="w3s-text-sm w3s-text-slate-500">USD</span>
                  </div>
                ) : (
                  <div className="w3s-relative">
                    <span
                      aria-hidden="true"
                      className="w3s-absolute w3s-left-4 w3s-top-1/2 w3s--translate-y-1/2 w3s-text-lg w3s-text-slate-400"
                    >
                      $
                    </span>
                    <input
                      id={amountInputId}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={enteredAmount}
                      onChange={(e) => { setEnteredAmount(e.target.value); }}
                      placeholder="0.00"
                      className="
                        w3s-w-full w3s-rounded-xl w3s-border w3s-border-white/10
                        w3s-bg-white/5 w3s-py-3 w3s-pl-9 w3s-pr-14
                        w3s-text-2xl w3s-font-semibold w3s-text-white
                        w3s-outline-none
                        focus:w3s-border-indigo-500 focus:w3s-ring-1 focus:w3s-ring-indigo-500
                        w3s-transition-colors
                        placeholder:w3s-text-slate-600
                      "
                    />
                    <span
                      aria-hidden="true"
                      className="w3s-absolute w3s-right-4 w3s-top-1/2 w3s--translate-y-1/2 w3s-text-sm w3s-text-slate-500"
                    >
                      USD
                    </span>
                  </div>
                )}
              </div>

              {/* Pay-with row: chain + token side by side. Auto-pre-selected so the user only
                  taps if they want to override the default. */}
              <div className="w3s-flex w3s-flex-col w3s-gap-1.5">
                <span className="w3s-text-xs w3s-font-medium w3s-uppercase w3s-tracking-wide w3s-text-slate-400">
                  Pay with
                </span>
                <div className="w3s-grid w3s-grid-cols-2 w3s-gap-2">
                  <ChainPicker
                    chains={evmChains}
                    selectedChainId={selectedChainId}
                    onSelect={setSelectedChainId}
                  />
                  <TokenPicker
                    options={tokenOptions}
                    selectedToken={selectedToken}
                    onSelect={setSelectedToken}
                    balance={tokenBalance}
                  />
                </div>
              </div>

              {/* Quote panel — the prominent "you'll send X.YYY TOKEN" line so the user knows
                  exactly what they're about to sign. */}
              <QuotePanel
                amountUsd={effectiveAmount}
                tokenOption={selectedTokenOption}
                quote={quote}
                quoteLoading={quoteLoading}
                quoteError={quoteError}
                tokenBalance={tokenBalance}
              />

              {/* Inline error from a previously failed payment attempt. */}
              {showError && (
                <ErrorBanner
                  message={paymentError ?? 'Payment failed'}
                  onDismiss={resetPayment}
                />
              )}

              {/* Wallet + CTA. Single decision point: connect, or pay. */}
              {!wallet.isConnected ? (
                <ConnectWalletSection
                  connectors={wallet.connectors}
                  connect={wallet.connect}
                  isConnecting={wallet.isConnecting || wallet.isReconnecting}
                  error={wallet.error}
                  showList={showConnectorList || wallet.connectors.length > 1}
                  onShowList={() => setShowConnectorList(true)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={!canPay || !effectiveAmount}
                    className="
                      w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3
                      w3s-text-sm w3s-font-semibold w3s-text-white
                      w3s-transition-all w3s-duration-200 w3s-cursor-pointer
                      hover:w3s-bg-indigo-500
                      disabled:w3s-cursor-not-allowed disabled:w3s-opacity-40
                    "
                  >
                    {!effectiveAmount
                      ? 'Enter an amount'
                      : quoteLoading && !quote
                        ? 'Fetching rate…'
                        : quoteError
                          ? 'Rate unavailable — try a different token'
                          : quote
                            ? `Pay ${formatTokenAmount(quote.amountTokenDisplay, quote.tokenDecimals)} ${quote.tokenSymbol}`
                            : 'Pay'}
                  </button>
                  <WalletStatusLine
                    address={wallet.displayAddress}
                    onChange={() => { wallet.disconnect(); }}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="w3s-border-t w3s-border-white/5 w3s-px-6 w3s-py-3 w3s-text-center">
          <span className="w3s-text-xs w3s-text-slate-500">
            Powered by <span className="w3s-font-medium w3s-text-indigo-400">Web3Settle</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ChainPicker({
  chains,
  selectedChainId,
  onSelect,
}: {
  chains: ChainConfig[];
  selectedChainId: number | null;
  onSelect: (id: number) => void;
}) {
  // Native <select> instead of a custom dropdown: honors the OS picker on mobile, no
  // accessibility work to write, and the merchant doesn't need to think about z-index.
  return (
    <div className="w3s-relative">
      <select
        aria-label="Network"
        value={selectedChainId ?? ''}
        onChange={(e) => { onSelect(Number(e.target.value)); }}
        className="
          w3s-w-full w3s-appearance-none
          w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
          w3s-px-4 w3s-py-3 w3s-pr-9
          w3s-text-sm w3s-text-white
          focus:w3s-border-indigo-500 focus:w3s-outline-none focus:w3s-ring-1 focus:w3s-ring-indigo-500
          w3s-cursor-pointer
        "
      >
        {chains.map((c) => (
          <option key={c.chainId} value={c.chainId} className="w3s-bg-slate-900">
            {c.name}
          </option>
        ))}
      </select>
      <ChevronIcon className="w3s-pointer-events-none w3s-absolute w3s-right-3 w3s-top-1/2 w3s--translate-y-1/2 w3s-h-4 w3s-w-4 w3s-text-slate-400" />
      {selectedChainId !== null && CHAIN_ICONS[selectedChainId] && (
        // Hidden by default; just retains the icon mapping for a future visual variant.
        <span className="w3s-sr-only">{`Network icon: ${CHAIN_ICONS[selectedChainId]}`}</span>
      )}
    </div>
  );
}

function TokenPicker({
  options,
  selectedToken,
  onSelect,
  balance,
}: {
  options: TokenOption[];
  selectedToken: string | null;
  onSelect: (value: string) => void;
  balance: string | null;
}) {
  if (options.length === 0) {
    return (
      <div
        role="status"
        className="
          w3s-flex w3s-items-center w3s-justify-center
          w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
          w3s-px-4 w3s-py-3 w3s-text-xs w3s-text-slate-500
        "
      >
        No tokens
      </div>
    );
  }
  return (
    <div className="w3s-relative">
      <select
        aria-label="Token"
        value={selectedToken ?? ''}
        onChange={(e) => { onSelect(e.target.value); }}
        className="
          w3s-w-full w3s-appearance-none
          w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
          w3s-px-4 w3s-py-3 w3s-pr-9
          w3s-text-sm w3s-text-white
          focus:w3s-border-indigo-500 focus:w3s-outline-none focus:w3s-ring-1 focus:w3s-ring-indigo-500
          w3s-cursor-pointer
        "
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="w3s-bg-slate-900">
            {o.symbol}
            {o.isNative ? ' (native)' : ''}
          </option>
        ))}
      </select>
      <ChevronIcon className="w3s-pointer-events-none w3s-absolute w3s-right-3 w3s-top-1/2 w3s--translate-y-1/2 w3s-h-4 w3s-w-4 w3s-text-slate-400" />
      {balance !== null && (
        <div className="w3s-mt-1 w3s-text-[11px] w3s-text-slate-500 w3s-text-right">
          Balance: {balance}
        </div>
      )}
    </div>
  );
}

function QuotePanel({
  amountUsd,
  tokenOption,
  quote,
  quoteLoading,
  quoteError,
  tokenBalance,
}: {
  amountUsd: number | null;
  tokenOption: TokenOption | null;
  quote: ReturnType<typeof useQuote>['quote'];
  quoteLoading: boolean;
  quoteError: string | null;
  tokenBalance: string | null;
}) {
  const insufficientBalance = useMemo(() => {
    if (!quote || !tokenBalance) return false;
    return Number(tokenBalance) < quote.amountTokenDisplay;
  }, [quote, tokenBalance]);

  if (!amountUsd) {
    return (
      <div
        role="status"
        className="
          w3s-rounded-xl w3s-border w3s-border-dashed w3s-border-white/10 w3s-bg-white/[0.02]
          w3s-px-4 w3s-py-4 w3s-text-center w3s-text-xs w3s-text-slate-500
        "
      >
        Enter a USD amount above to see the rate.
      </div>
    );
  }
  if (!tokenOption) {
    return (
      <div
        role="status"
        className="
          w3s-rounded-xl w3s-border w3s-border-amber-500/20 w3s-bg-amber-500/5
          w3s-px-4 w3s-py-3 w3s-text-xs w3s-text-amber-300
        "
      >
        This network has no payable tokens configured by the merchant.
      </div>
    );
  }
  if (quoteError) {
    return (
      <div
        role="alert"
        className="
          w3s-rounded-xl w3s-border w3s-border-red-500/20 w3s-bg-red-500/5
          w3s-px-4 w3s-py-3 w3s-text-xs w3s-text-red-300
        "
      >
        Rate unavailable: {quoteError}
      </div>
    );
  }
  if (quoteLoading && !quote) {
    return (
      <div
        role="status"
        className="
          w3s-flex w3s-items-center w3s-gap-2
          w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
          w3s-px-4 w3s-py-3 w3s-text-xs w3s-text-slate-400
        "
      >
        <SpinnerIcon className="w3s-h-3.5 w3s-w-3.5 w3s-text-indigo-400" />
        Fetching live rate…
      </div>
    );
  }
  if (!quote) return null;

  return (
    <div
      className="
        w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
        w3s-px-4 w3s-py-3
        w3s-flex w3s-flex-col w3s-gap-2
      "
    >
      <div className="w3s-flex w3s-justify-between w3s-items-baseline">
        <span className="w3s-text-xs w3s-text-slate-400">You'll send</span>
        <span className="w3s-text-base w3s-font-semibold w3s-text-white">
          {formatTokenAmount(quote.amountTokenDisplay, quote.tokenDecimals)} {quote.tokenSymbol}
        </span>
      </div>
      <div className="w3s-flex w3s-justify-between w3s-items-baseline">
        <span className="w3s-text-[11px] w3s-text-slate-500">
          Rate: 1 {quote.tokenSymbol} = ${formatPriceUsd(quote.priceUsd)}
        </span>
        <span className="w3s-text-[11px] w3s-text-slate-500 w3s-font-mono">{quote.source}</span>
      </div>
      {insufficientBalance && (
        <div className="w3s-flex w3s-items-center w3s-gap-2 w3s-pt-1 w3s-border-t w3s-border-white/5">
          <AlertIcon className="w3s-h-3.5 w3s-w-3.5 w3s-text-amber-400" />
          <span className="w3s-text-[11px] w3s-text-amber-300">
            Your wallet has {tokenBalance} {quote.tokenSymbol}; you need {formatTokenAmount(quote.amountTokenDisplay, quote.tokenDecimals)}.
          </span>
        </div>
      )}
    </div>
  );
}

function ConnectWalletSection({
  connectors,
  connect,
  isConnecting,
  error,
  showList,
  onShowList,
}: {
  connectors: ReturnType<typeof useWallet>['connectors'];
  connect: ReturnType<typeof useWallet>['connect'];
  isConnecting: boolean;
  error: Error | null;
  showList: boolean;
  onShowList: () => void;
}) {
  // One connector → single button. Multiple → list (or click to expand). Either way, the
  // visual weight is "one decision: connect", not "step 2 of 5: pick a wallet provider".
  const onlyConnector = connectors.length === 1 ? connectors[0] : undefined;
  if (!showList && onlyConnector) {
    const c = onlyConnector;
    return (
      <div className="w3s-flex w3s-flex-col w3s-gap-2">
        <button
          type="button"
          onClick={() => connect({ connector: c })}
          disabled={isConnecting}
          className="
            w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3
            w3s-text-sm w3s-font-semibold w3s-text-white
            w3s-flex w3s-items-center w3s-justify-center w3s-gap-2
            w3s-transition-all w3s-duration-200 w3s-cursor-pointer
            hover:w3s-bg-indigo-500
            disabled:w3s-cursor-not-allowed disabled:w3s-opacity-50
          "
        >
          {isConnecting ? <SpinnerIcon className="w3s-h-4 w3s-w-4" /> : null}
          {isConnecting ? 'Connecting…' : `Connect ${c.name}`}
        </button>
        {error && <ErrorBanner message={error.message} />}
      </div>
    );
  }

  if (!showList) {
    return (
      <button
        type="button"
        onClick={onShowList}
        className="
          w3s-w-full w3s-rounded-xl w3s-bg-indigo-600 w3s-py-3
          w3s-text-sm w3s-font-semibold w3s-text-white
          w3s-transition-all w3s-duration-200 w3s-cursor-pointer
          hover:w3s-bg-indigo-500
        "
      >
        Connect wallet
      </button>
    );
  }

  return (
    <div className="w3s-flex w3s-flex-col w3s-gap-2">
      <span className="w3s-text-xs w3s-font-medium w3s-uppercase w3s-tracking-wide w3s-text-slate-400">
        Choose a wallet
      </span>
      {connectors.map((c) => (
        <button
          key={c.uid}
          type="button"
          onClick={() => connect({ connector: c })}
          disabled={isConnecting}
          className="
            w3s-flex w3s-items-center w3s-gap-3
            w3s-rounded-xl w3s-border w3s-border-white/10 w3s-bg-white/5
            w3s-px-4 w3s-py-3 w3s-text-left
            w3s-transition-all w3s-duration-200 w3s-cursor-pointer
            hover:w3s-border-white/20 hover:w3s-bg-white/10
            disabled:w3s-cursor-not-allowed disabled:w3s-opacity-50
          "
        >
          {c.icon ? (
            <img src={c.icon} alt="" aria-hidden="true" className="w3s-h-7 w3s-w-7 w3s-rounded-lg" />
          ) : (
            <div
              aria-hidden="true"
              className="
                w3s-flex w3s-h-7 w3s-w-7 w3s-items-center w3s-justify-center
                w3s-rounded-lg w3s-bg-indigo-500/20 w3s-text-xs w3s-font-bold w3s-text-indigo-300
              "
            >
              {c.name.slice(0, 1)}
            </div>
          )}
          <span className="w3s-text-sm w3s-font-medium w3s-text-white">{c.name}</span>
        </button>
      ))}
      {error && <ErrorBanner message={error.message} />}
    </div>
  );
}

function WalletStatusLine({
  address,
  onChange,
}: {
  address: string | null;
  onChange: () => void;
}) {
  return (
    <div className="w3s-flex w3s-items-center w3s-justify-between w3s-text-xs w3s-text-slate-500">
      <span>
        Wallet: <span className="w3s-font-mono w3s-text-slate-300">{address ?? '—'}</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="w3s-text-slate-400 hover:w3s-text-white w3s-transition-colors w3s-cursor-pointer"
      >
        Change
      </button>
    </div>
  );
}

function ProcessingState({
  status,
  txHash,
  explorerUrl,
  chainId,
}: {
  status: PaymentStatus;
  txHash: string | null;
  explorerUrl?: string;
  chainId?: number;
}) {
  const labelByStatus: Record<string, string> = {
    [PaymentStatus.Connecting]: 'Switching network…',
    [PaymentStatus.Approving]: 'Approving token spend…',
    [PaymentStatus.Sending]: 'Waiting for wallet signature…',
    [PaymentStatus.Confirming]: 'Confirming on-chain…',
  };
  // Segment 2.2: surface the policy-derived ETA + required-confirmations
  // hint so the user knows what they're waiting for. Falls back to the
  // generic "10-60 s" copy when no chainId is in scope.
  const policy = defaultConfirmationPolicy;
  const required =
    typeof chainId === 'number' ? policy.requiredConfirmations(chainId) : null;
  const etaSec =
    typeof chainId === 'number' ? policy.estimatedSecondsToFinality(chainId) : 0;
  const family = typeof chainId === 'number' ? policy.family(chainId) : null;
  const isSolana = family === 'solana';
  const hint =
    required && etaSec > 0
      ? isSolana
        ? `Awaiting commitment (~${Math.round(etaSec)} s)`
        : `Waiting for ${required} confirmations (~${Math.round(etaSec)} s)`
      : 'This usually takes 10–60 seconds.';
  return (
    <div role="status" aria-live="polite" className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-4 w3s-py-8">
      <SpinnerIcon className="w3s-h-10 w3s-w-10 w3s-text-indigo-400" />
      <div className="w3s-text-center">
        <div className="w3s-text-sm w3s-font-medium w3s-text-white">{labelByStatus[status] ?? 'Processing…'}</div>
        {status === PaymentStatus.Confirming && (
          <div
            data-testid="w3s-confirmation-hint"
            className="w3s-mt-1 w3s-text-xs w3s-text-slate-500"
          >
            {hint}
          </div>
        )}
      </div>
      {txHash && explorerUrl && (
        <a
          href={`${explorerUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w3s-text-xs w3s-text-indigo-400 hover:w3s-text-indigo-300 w3s-underline"
        >
          View on explorer ↗
        </a>
      )}
    </div>
  );
}

function SuccessState({
  txHash,
  explorerUrl,
  amountTokenDisplay,
  tokenSymbol,
  chainName,
  onClose,
}: {
  txHash: string | null;
  explorerUrl?: string;
  amountTokenDisplay?: number;
  tokenSymbol?: string;
  chainName?: string;
  onClose: () => void;
}) {
  return (
    <div role="status" className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-4 w3s-py-6">
      <div className="w3s-flex w3s-h-16 w3s-w-16 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-green-500/15">
        <CheckIcon className="w3s-h-8 w3s-w-8 w3s-text-green-400" />
      </div>
      <div className="w3s-text-center">
        <h3 className="w3s-text-lg w3s-font-semibold w3s-text-white">Payment confirmed</h3>
        {amountTokenDisplay && tokenSymbol && chainName && (
          <p className="w3s-mt-1 w3s-text-sm w3s-text-slate-400">
            {amountTokenDisplay.toFixed(Math.min(8, 6))} {tokenSymbol} sent on {chainName}
          </p>
        )}
      </div>
      {txHash && explorerUrl && (
        <a
          href={`${explorerUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w3s-text-xs w3s-text-indigo-400 hover:w3s-text-indigo-300 w3s-underline"
        >
          View on explorer ↗
        </a>
      )}
      <button
        type="button"
        onClick={onClose}
        className="
          w3s-w-full w3s-rounded-xl w3s-bg-white/5 hover:w3s-bg-white/10
          w3s-py-3 w3s-text-sm w3s-font-medium w3s-text-white
          w3s-transition-colors w3s-cursor-pointer
          w3s-mt-2
        "
      >
        Done
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-label="Loading" className="w3s-flex w3s-items-center w3s-justify-center w3s-py-12">
      <SpinnerIcon className="w3s-h-8 w3s-w-8 w3s-text-indigo-400" />
    </div>
  );
}

function ConfigErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-4 w3s-py-6">
      <div className="w3s-flex w3s-h-12 w3s-w-12 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-amber-500/15">
        <AlertIcon className="w3s-h-6 w3s-w-6 w3s-text-amber-400" />
      </div>
      <div className="w3s-text-center">
        <h3 className="w3s-text-base w3s-font-semibold w3s-text-white">Couldn't load payment options</h3>
        <p className="w3s-mt-1 w3s-text-xs w3s-text-slate-400">{error}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="
          w3s-rounded-xl w3s-bg-white/5 hover:w3s-bg-white/10
          w3s-px-4 w3s-py-2 w3s-text-xs w3s-font-medium w3s-text-white
          w3s-transition-colors w3s-cursor-pointer
        "
      >
        Try again
      </button>
    </div>
  );
}

function NoChainsState() {
  return (
    <div role="status" className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-3 w3s-py-8">
      <div className="w3s-flex w3s-h-12 w3s-w-12 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-amber-500/15">
        <AlertIcon className="w3s-h-6 w3s-w-6 w3s-text-amber-400" />
      </div>
      <div className="w3s-text-center w3s-max-w-xs">
        <h3 className="w3s-text-base w3s-font-semibold w3s-text-white">No payment options yet</h3>
        <p className="w3s-mt-1 w3s-text-xs w3s-text-slate-400">
          The merchant hasn't bound any supported networks to this storefront. Once they deploy
          a contract on Ethereum, Polygon, or Base and enable a token, this modal will let you pay.
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="
        w3s-flex w3s-items-start w3s-gap-3
        w3s-rounded-xl w3s-border w3s-border-red-500/20 w3s-bg-red-500/5
        w3s-px-4 w3s-py-3
      "
    >
      <AlertIcon className="w3s-h-4 w3s-w-4 w3s-text-red-400 w3s-flex-shrink-0 w3s-mt-0.5" />
      <div className="w3s-flex-1 w3s-text-xs w3s-text-red-300">{message}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="w3s-text-red-400 hover:w3s-text-red-300 w3s-cursor-pointer"
          aria-label="Dismiss"
        >
          <CloseIcon className="w3s-h-3.5 w3s-w-3.5" />
        </button>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTokenAmount(amount: number, decimals: number): string {
  // Show up to 8 fractional digits so very-small-decimals tokens (USDT/USDC at 6 decimals,
  // ETH at 18) still read sensibly. Trim trailing zeros for compactness.
  const fractionDigits = Math.min(8, Math.max(2, Math.min(decimals, 8)));
  return amount
    .toFixed(fractionDigits)
    .replace(/\.?0+$/, '');
}

function formatPriceUsd(price: number): string {
  // Sub-cent prices need more digits; supra-dollar prices need fewer.
  if (price < 0.01) return price.toFixed(8).replace(/\.?0+$/, '');
  if (price < 1) return price.toFixed(6).replace(/\.?0+$/, '');
  if (price < 100) return price.toFixed(4).replace(/\.?0+$/, '');
  return price.toFixed(2);
}
