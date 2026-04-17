import { useCallback, useState } from 'react';
import type { PayButtonProps, ButtonSize, ButtonVariant } from '../core/types';
import { TronTopUpModal } from './TronTopUpModal';

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'w3s-px-4 w3s-py-2 w3s-text-sm',
  md: 'w3s-px-6 w3s-py-3 w3s-text-base',
  lg: 'w3s-px-8 w3s-py-4 w3s-text-lg',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'w3s-bg-red-600 w3s-text-white hover:w3s-bg-red-500',
  outline:
    'w3s-bg-transparent w3s-text-red-400 w3s-border-red-500/50 hover:w3s-bg-red-500/10',
  ghost: 'w3s-bg-transparent w3s-text-slate-300 hover:w3s-bg-white/10 hover:w3s-text-white',
};

export function TronPayButton({
  amount,
  label,
  className = '',
  variant = 'primary',
  size = 'md',
  disabled = false,
}: PayButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const handleClick = useCallback(() => {
    if (!disabled) setIsOpen(true);
  }, [disabled]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`w3s-inline-flex w3s-items-center w3s-gap-2 w3s-rounded-xl w3s-border w3s-border-transparent w3s-font-semibold w3s-transition-all w3s-cursor-pointer disabled:w3s-opacity-40 disabled:w3s-cursor-not-allowed ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      >
        {label ?? `Pay $${amount.toFixed(2)} (TRON)`}
      </button>
      <TronTopUpModal isOpen={isOpen} onClose={() => setIsOpen(false)} amount={amount} />
    </>
  );
}
