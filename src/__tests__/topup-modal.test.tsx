import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaymentStatus, type PaymentConfig } from '../core/types';

// The EVM Top-Up modal's chain/token pre-selection and its reset on re-open.

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

vi.mock('../components/Web3SettleProvider', () => ({
  useWeb3SettleContext: () => ({ config: { apiBaseUrl: 'https://api.example.test', storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd' } }),
}));
vi.mock('wagmi', () => ({ usePublicClient: () => undefined }));
vi.mock('../hooks/useWallet', () => ({
  useWallet: () => ({
    address: undefined,
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    chainId: undefined,
    balance: null,
    balanceSymbol: null,
    connectors: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    error: null,
    displayAddress: null,
  }),
}));
const resetPayment = vi.fn();
vi.mock('../hooks/usePayment', () => ({
  usePayment: () => ({ startPayment: vi.fn(), status: PaymentStatus.Idle, txHash: null, error: null, reset: resetPayment }),
}));
vi.mock('../hooks/useQuote', () => ({
  useQuote: () => ({ quote: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
let paymentConfig: PaymentConfig;
vi.mock('../hooks/useWeb3Settle', () => ({
  useWeb3Settle: () => ({ paymentConfig, isLoading: false, error: null, refetch: vi.fn(), config: {} }),
}));

const { Web3SettleTopUpModal } = await import('../components/TopUpModal');

function config(): PaymentConfig {
  return {
    storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd',
    commissionBps: 300,
    contractAbiVersion: 'V3.2',
    allowedContractAddresses: {},
    chains: [
      {
        chainId: 1,
        name: 'Ethereum',
        contractAddress: '0x675f8cc6d9b5b02bd8eb0920d860ce748dd1b3a0',
        tokens: [
          { address: USDC_ETH, symbol: 'USDC', decimals: 6 },
          { address: USDT_ETH, symbol: 'USDT', decimals: 6 },
        ],
        explorerUrl: 'https://etherscan.io',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      },
      {
        chainId: 8453,
        name: 'Base',
        contractAddress: '0x675f8cc6d9b5b02bd8eb0920d860ce748dd1b3a0',
        tokens: [{ address: USDC_BASE, symbol: 'USDC', decimals: 6 }],
        explorerUrl: 'https://basescan.org',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      },
      // Not an EVM chain wagmi is configured for — must not be offered here.
      {
        chainId: 728126428,
        name: 'Tron',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        tokens: [],
        explorerUrl: 'https://tronscan.org',
      },
    ],
  };
}

const network = () => screen.getByLabelText<HTMLSelectElement>('Network');
const token = () => screen.getByLabelText<HTMLSelectElement>('Token');

beforeEach(() => {
  vi.clearAllMocks();
  paymentConfig = config();
});

describe('Web3SettleTopUpModal — pre-selection', () => {
  it('opens on the first EVM chain with its stablecoin preselected (USDT over USDC over native)', () => {
    render(<Web3SettleTopUpModal isOpen onClose={vi.fn()} />);
    expect(network().value).toBe('1');
    expect(Array.from(network().options).map((o) => o.text)).toEqual(['Ethereum', 'Base']);
    expect(token().value).toBe(USDT_ETH);
  });

  it('switching chain replaces a token the new chain does not offer with that chain\'s default', () => {
    render(<Web3SettleTopUpModal isOpen onClose={vi.fn()} />);
    fireEvent.change(network(), { target: { value: '8453' } });
    expect(network().value).toBe('8453');
    expect(token().value).toBe(USDC_BASE);
    // …and does not resurface the old pick when switching back.
    fireEvent.change(network(), { target: { value: '1' } });
    expect(token().value).toBe(USDT_ETH);
  });

  it('keeps the native token selected across a chain switch when both chains have one', () => {
    render(<Web3SettleTopUpModal isOpen onClose={vi.fn()} />);
    fireEvent.change(token(), { target: { value: 'native' } });
    expect(token().value).toBe('native');
    fireEvent.change(network(), { target: { value: '8453' } });
    expect(token().value).toBe('native');
  });
});

describe('Web3SettleTopUpModal — re-open', () => {
  it('starts from a fresh form and resets the payment hook', () => {
    const ui = render(<Web3SettleTopUpModal isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '42' } });
    fireEvent.change(network(), { target: { value: '8453' } });
    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('42');
    resetPayment.mockClear();

    ui.rerender(<Web3SettleTopUpModal isOpen={false} onClose={vi.fn()} />);
    ui.rerender(<Web3SettleTopUpModal isOpen onClose={vi.fn()} />);

    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('');
    expect(network().value).toBe('1');
    expect(token().value).toBe(USDT_ETH);
    expect(resetPayment).toHaveBeenCalledTimes(1);
  });
});
