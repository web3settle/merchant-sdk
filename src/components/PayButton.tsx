import React, { useState, useCallback } from 'react';
import type { PayButtonProps } from '../core/types';
import { Web3SettleTopUpModal } from './TopUpModal';

const SIZE_CLASSES: Record<string, string> = {
  sm: 'w3s-px-4 w3s-py-2 w3s-text-sm',
  md: 'w3s-px-6 w3s-py-3 w3s-text-base',
  lg: 'w3s-px-8 w3s-py-4 w3s-text-lg',
};

const VARIANT_CLASSES: Record<string, string> = {
  primary: `
    w3s-bg-indigo-600 w3s-text-white w3s-border-transparent
    hover:w3s-bg-indigo-500 hover:w3s-shadow-[0_0_20px_rgba(99,102,241,0.3)]
    active:w3s-bg-indigo-700
  `,
  outline: `
    w3s-bg-transparent w3s-text-indigo-400 w3s-border-indigo-500/50
    hover:w3s-bg-indigo-500/10 hover:w3s-border-indigo-400
    active:w3s-bg-indigo-500/20
  `,
  ghost: `
    w3s-bg-transparent w3s-text-slate-300 w3s-border-transparent
    hover:w3s-bg-white/10 hover:w3s-text-white
    active:w3s-bg-white/15
  `,
};

function CryptoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8.5 7.5a1.5 1.5 0 113 0v.25H13v1.5h-1.5V11h1v1.5h-1v1H10v-1H8.5v-1.5H10V9.25H8.5V7.75H7v-1.5h1.5V7.5z" />
    </svg>
  );
}

export function Web3SettlePayButton({
  amount,
  label,
  className = '',
  variant = 'primary',
  size = 'md',
  disabled = false,
}: PayButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = useCallback(() => {
    if (!disabled) {
      setIsModalOpen(true);
    }
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  const variantClass = VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`
          w3s-inline-flex w3s-items-center w3s-gap-2
          w3s-rounded-xl w3s-border
          w3s-font-semibold
          w3s-transition-all w3s-duration-200 w3s-cursor-pointer
          disabled:w3s-cursor-not-allowed disabled:w3s-opacity-40
          ${sizeClass}
          ${variantClass}
          ${className}
        `}
      >
        <CryptoIcon className="w3s-h-5 w3s-w-5" />
        {label ?? `Pay $${amount.toFixed(2)}`}
      </button>

      <Web3SettleTopUpModal
        isOpen={isModalOpen}
        onClose={handleClose}
        amount={amount}
      />
    </>
  );
}
