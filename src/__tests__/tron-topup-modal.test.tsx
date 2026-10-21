import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaymentStatus, type PaymentConfig } from '../core/types';

// The TRON Top-Up modal: what it refuses to send, and that re-opening it starts from a fresh form.

const CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const WALLET = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const REF = '0x8f14e45fceea167a5a36dedd4bea254300000000000000000000000000000000' as const;

const pipeline = {
  family: 'tron' as const,
  quoteAmount: vi.fn(),
  needsApproval: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
  waitForReceipt: vi.fn(),
};
const createPayment = vi.fn();

vi.mock('../tron/TronProvider', () => ({
  useTronWeb3SettleContext: () => ({
    pipeline,
    wallet: { connected: true, address: WALLET, connecting: false, error: null },
    connect: vi.fn(),
    disconnect: vi.fn(),
    config: { apiBaseUrl: 'https://api.example.test', storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd', createPayment },
  }),
}));

// The storefront's payment config as the modal sees it. Tests swap it mid-flow to model a refetch.
let paymentConfig: PaymentConfig;
vi.mock('../hooks/useWeb3Settle', () => ({
  useWeb3Settle: () => ({ paymentConfig, isLoading: false, error: null, refetch: vi.fn(), config: {} }),
}));

// TokenSelector reads wagmi's public client for balances; there is no EVM client on the TRON path.
vi.mock('wagmi', () => ({ usePublicClient: () => undefined }));

const { TronTopUpModal } = await import('../tron/TronTopUpModal');

function tronConfig(): PaymentConfig {
  return {
    storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd',
    commissionBps: 300,
    contractAbiVersion: 'V3.2',
    allowedContractAddresses: {},
    chains: [
      {
        chainId: 728126428,
        name: 'Tron',
        contractAddress: CONTRACT,
        tokens: [{ address: USDT, symbol: 'USDT', decimals: 6 }],
        explorerUrl: 'https://tronscan.org',
        nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
      },
    ],
  };
}

/** Enter $10, pick the Tron chain and USDT, land on the review step. */
async function goToReview(ui: ReturnType<typeof render>) {
  fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('radio', { name: /Tron/ }));
  // The chain radio's tooltip also mentions USDT — anchor on the token radio's own label.
  fireEvent.click(await screen.findByRole('radio', { name: /^USDT/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review Payment' }));
  expect(screen.getByRole('heading', { name: 'Review Payment' })).toBeTruthy();
  return ui;
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentConfig = tronConfig();
  pipeline.quoteAmount.mockResolvedValue(10_000_000n);
  pipeline.needsApproval.mockResolvedValue(false);
  pipeline.execute.mockResolvedValue('txid-1');
  pipeline.waitForReceipt.mockResolvedValue({ success: true, blockNumber: 1, raw: {} });
  createPayment.mockResolvedValue({ paymentReference: REF, requestId: 'req-1' });
});

describe('TronTopUpModal — confirm', () => {
  it('invoices with the token decimals from the payment config and pays with the reference', async () => {
    const ui = render(<TronTopUpModal isOpen onClose={vi.fn()} />);
    await goToReview(ui);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Payment' }));
    expect(await screen.findByRole('heading', { name: 'Complete' })).toBeTruthy();

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ token: USDT, tokenSymbol: 'USDT', decimals: 6, atomicAmount: '10000000', amount: '10', amountUsd: 10 }),
    );
    expect(pipeline.execute).toHaveBeenCalledWith(paymentConfig.chains[0], USDT, 10_000_000n, { paymentReference: REF });
  });

  it('refuses when the selected token has no decimals in the payment config — no quote, no createPayment, no pay-in', async () => {
    const ui = render(<TronTopUpModal isOpen onClose={vi.fn()} />);
    await goToReview(ui);

    // The storefront drops USDT while the user is on the review step (config refetch).
    paymentConfig = { ...tronConfig(), chains: [{ ...tronConfig().chains[0], tokens: [] }] };
    ui.rerender(<TronTopUpModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Payment' }));

    expect(screen.getByRole('alert').textContent).toMatch(/Cannot determine the decimals/);
    expect(pipeline.quoteAmount).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
    expect(pipeline.execute).not.toHaveBeenCalled();
    // Still on the review step — nothing was sent, the user can go back and pick again.
    expect(screen.getByRole('heading', { name: 'Review Payment' })).toBeTruthy();
  });
});

describe('TronTopUpModal — steps', () => {
  it('re-opening starts from a fresh amount step (nothing kept from the previous round)', async () => {
    const ui = render(<TronTopUpModal isOpen onClose={vi.fn()} />);
    await goToReview(ui);

    ui.rerender(<TronTopUpModal isOpen={false} onClose={vi.fn()} />);
    ui.rerender(<TronTopUpModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Enter Amount' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Amount (USD)').value).toBe('');
  });

  it('skips the amount step when the merchant fixes the amount (connected wallet → straight to the token step)', () => {
    render(<TronTopUpModal isOpen onClose={vi.fn()} amount={25} />);
    expect(screen.queryByLabelText('Amount (USD)')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Select Payment' })).toBeTruthy();
  });

  it('shows the result step while the payment failed and returns to review on Try Again', async () => {
    pipeline.execute.mockRejectedValue(new Error('User rejected the transaction'));
    const ui = render(<TronTopUpModal isOpen onClose={vi.fn()} />);
    await goToReview(ui);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Payment' }));
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByRole('heading', { name: 'Review Payment' })).toBeTruthy();
  });
});

// Keep the enum referenced so a rename in core/types is caught here too.
void PaymentStatus;
