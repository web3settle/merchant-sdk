import React from 'react';
import { PaymentStatus, type TransactionStatusProps } from '../core/types';

const STEP_CONFIG = [
  { status: PaymentStatus.Sending, label: 'Sending transaction' },
  { status: PaymentStatus.Confirming, label: 'Confirming on-chain' },
  { status: PaymentStatus.Success, label: 'Payment confirmed' },
] as const;

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w3s-animate-spin ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="w3s-opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="w3s-opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getStepState(
  currentStatus: PaymentStatus,
  stepStatus: PaymentStatus,
): 'completed' | 'active' | 'pending' {
  const order = [PaymentStatus.Sending, PaymentStatus.Confirming, PaymentStatus.Success];
  const currentIndex = order.indexOf(currentStatus);
  const stepIndex = order.indexOf(stepStatus);

  if (currentIndex > stepIndex) return 'completed';
  if (currentIndex === stepIndex) return 'active';
  return 'pending';
}

export function TransactionStatus({ status, txHash, explorerUrl, error }: TransactionStatusProps) {
  if (status === PaymentStatus.Error) {
    return (
      <div className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-4 w3s-py-6">
        <div className="w3s-flex w3s-h-16 w3s-w-16 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-red-500/10">
          <ErrorIcon className="w3s-h-8 w3s-w-8 w3s-text-red-400" />
        </div>
        <div className="w3s-text-center">
          <h3 className="w3s-text-lg w3s-font-semibold w3s-text-white">
            Transaction Failed
          </h3>
          <p className="w3s-mt-1 w3s-text-sm w3s-text-slate-400">
            {error ?? 'An unexpected error occurred'}
          </p>
        </div>
        {txHash && explorerUrl && (
          <a
            href={`${explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w3s-text-sm w3s-text-indigo-400 hover:w3s-text-indigo-300 w3s-underline"
          >
            View on Explorer
          </a>
        )}
      </div>
    );
  }

  if (status === PaymentStatus.Success) {
    return (
      <div className="w3s-flex w3s-flex-col w3s-items-center w3s-gap-4 w3s-py-6">
        <div className="w3s-flex w3s-h-16 w3s-w-16 w3s-items-center w3s-justify-center w3s-rounded-full w3s-bg-green-500/10">
          <CheckIcon className="w3s-h-8 w3s-w-8 w3s-text-green-400" />
        </div>
        <div className="w3s-text-center">
          <h3 className="w3s-text-lg w3s-font-semibold w3s-text-white">
            Payment Successful
          </h3>
          <p className="w3s-mt-1 w3s-text-sm w3s-text-slate-400">
            Your transaction has been confirmed on-chain.
          </p>
        </div>
        {txHash && explorerUrl && (
          <a
            href={`${explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w3s-text-sm w3s-text-indigo-400 hover:w3s-text-indigo-300 w3s-underline"
          >
            View on Explorer
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="w3s-flex w3s-flex-col w3s-gap-4 w3s-py-4">
      {STEP_CONFIG.map((step, index) => {
        const state = getStepState(status, step.status);
        return (
          <div key={step.status} className="w3s-flex w3s-items-center w3s-gap-3">
            {/* Step indicator */}
            <div className="w3s-flex w3s-flex-col w3s-items-center">
              <div
                className={`
                  w3s-flex w3s-h-8 w3s-w-8 w3s-items-center w3s-justify-center w3s-rounded-full
                  w3s-transition-all w3s-duration-300
                  ${
                    state === 'completed'
                      ? 'w3s-bg-green-500/20 w3s-text-green-400'
                      : state === 'active'
                        ? 'w3s-bg-indigo-500/20 w3s-text-indigo-400'
                        : 'w3s-bg-white/5 w3s-text-slate-600'
                  }
                `}
              >
                {state === 'completed' ? (
                  <CheckIcon className="w3s-h-4 w3s-w-4" />
                ) : state === 'active' ? (
                  <SpinnerIcon className="w3s-h-4 w3s-w-4" />
                ) : (
                  <span className="w3s-text-xs">{index + 1}</span>
                )}
              </div>
              {index < STEP_CONFIG.length - 1 && (
                <div
                  className={`
                    w3s-h-6 w3s-w-0.5 w3s-transition-colors w3s-duration-300
                    ${state === 'completed' ? 'w3s-bg-green-500/40' : 'w3s-bg-white/10'}
                  `}
                />
              )}
            </div>

            {/* Step label */}
            <span
              className={`
                w3s-text-sm w3s-transition-colors w3s-duration-300
                ${
                  state === 'completed'
                    ? 'w3s-text-green-400'
                    : state === 'active'
                      ? 'w3s-text-white w3s-font-medium'
                      : 'w3s-text-slate-500'
                }
              `}
            >
              {step.label}
              {state === 'active' && '...'}
            </span>
          </div>
        );
      })}

      {txHash && explorerUrl && (
        <div className="w3s-mt-2 w3s-text-center">
          <a
            href={`${explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w3s-text-xs w3s-text-indigo-400 hover:w3s-text-indigo-300 w3s-underline"
          >
            View transaction on explorer
          </a>
        </div>
      )}
    </div>
  );
}
