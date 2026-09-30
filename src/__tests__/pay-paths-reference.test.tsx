import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { decodeFunctionData } from 'viem';
import { PAYMENT_CONTRACT_ABI } from '../core/config';
import { PaymentStatus, type ChainConfig } from '../core/types';

// The React hook, the headless controller and the Web Component each decide attribution before
// anything reaches a wallet. These tests pin that for the three surfaces merchants integrate.

const REF = '0x8f14e45fceea167a5a36dedd4bea254300000000000000000000000000000000' as const;
const CONTRACT = '0x675f8cc6d9b5b02bd8eb0920d860ce748dd1b3a0' as const;

const wallet = {
  getAddresses: vi.fn(),
  getChainId: vi.fn(),
  sendTransaction: vi.fn(),
  chain: undefined,
};
const publicClient = { waitForTransactionReceipt: vi.fn() };

vi.mock('wagmi', () => ({
  useWalletClient: () => ({ data: wallet }),
  usePublicClient: () => publicClient,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

const { usePayment } = await import('../hooks/usePayment');
const { createPayButtonController } = await import('../headless/usePayButton');

const BASE: ChainConfig = {
  chainId: 8453,
  name: 'Base',
  contractAddress: CONTRACT,
  tokens: [],
  explorerUrl: 'https://basescan.org',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  confirmations: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  wallet.getAddresses.mockResolvedValue(['0x3333333333333333333333333333333333333333']);
  wallet.getChainId.mockResolvedValue(8453);
  wallet.sendTransaction.mockResolvedValue(`0x${'ab'.repeat(32)}`);
  publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
});

describe('usePayment', () => {
  it('pays with payInNativeWithReference when given the paymentReference', async () => {
    const { result } = renderHook(() => usePayment());
    await act(() => result.current.startPayment(0.01, BASE, 'native', { atomicAmount: '10000000000000000', paymentReference: REF }));

    expect(result.current.status).toBe(PaymentStatus.Success);
    const tx = wallet.sendTransaction.mock.calls[0][0] as { to: string; value: bigint; data: `0x${string}` };
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(10_000_000_000_000_000n);
    const decoded = decodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, data: tx.data });
    expect(decoded).toEqual({ functionName: 'payInNativeWithReference', args: [REF] });
  });

  it('refuses to prompt the wallet without a reference (attributed is the default)', async () => {
    const { result } = renderHook(() => usePayment());
    await act(() => result.current.startPayment(0.01, BASE, 'native', { atomicAmount: '1' }));

    expect(result.current.status).toBe(PaymentStatus.Error);
    expect(result.current.error).toMatch(/Refusing to pay without a paymentReference/);
    expect(wallet.getChainId).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it('sends the plain payInNative only on the explicit unattributed opt-in', async () => {
    const { result } = renderHook(() => usePayment());
    await act(() => result.current.startPayment(0.01, BASE, 'native', { atomicAmount: '1', mode: 'unattributed' }));

    expect(result.current.status).toBe(PaymentStatus.Success);
    const tx = wallet.sendTransaction.mock.calls[0][0] as { data: `0x${string}` };
    expect(decodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, data: tx.data }).functionName).toBe('payInNative');
  });
});

describe('headless createPayButtonController', () => {
  const paymentConfig = {
    storefrontId: 'c9b88f30-7a20-4416-8bc9-2612684ec4cd',
    commissionBps: 300,
    chains: [BASE],
    contractAbiVersion: 'V3.2',
    allowedContractAddresses: {},
  };
  function controllerWith(runPayment?: Parameters<typeof createPayButtonController>[0]['runPayment']) {
    const apiClient = { fetchPaymentConfig: vi.fn().mockResolvedValue(paymentConfig) };
    return createPayButtonController({
      apiClient: apiClient as unknown as Parameters<typeof createPayButtonController>[0]['apiClient'],
      runPayment,
    });
  }

  it('hands runPayment the paymentReference in attributed mode', async () => {
    const runPayment = vi.fn().mockResolvedValue({ txHash: '0xabc' });
    const controller = controllerWith(runPayment);
    await controller.start(10, { paymentReference: REF });
    expect(runPayment).toHaveBeenCalledWith({ amount: 10, paymentConfig, paymentReference: REF, mode: 'attributed' });
    expect(controller.getState()).toMatchObject({ status: PaymentStatus.Success, txHash: '0xabc', paymentReference: REF });
  });

  it('with a runner, refuses to start without a reference and never calls the runner', async () => {
    const runPayment = vi.fn();
    const controller = controllerWith(runPayment);
    await controller.start(10);
    expect(controller.getState().status).toBe(PaymentStatus.Error);
    expect(controller.getState().error).toMatch(/Refusing to pay without a paymentReference/);
    expect(runPayment).not.toHaveBeenCalled();
  });

  it('passes no reference to the runner only on the explicit unattributed opt-in', async () => {
    const runPayment = vi.fn().mockResolvedValue({ txHash: '0xabc' });
    const controller = controllerWith(runPayment);
    await controller.start(10, { mode: 'unattributed' });
    expect(runPayment).toHaveBeenCalledWith({ amount: 10, paymentConfig, mode: 'unattributed' });
  });
});

describe('<web3settle-pay-button payment-reference>', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline in unit tests'));
    const { registerWebComponents } = await import('../wc/pay-button');
    registerWebComponents();
  });

  function button(attrs: Record<string, string>) {
    const el = document.createElement('web3settle-pay-button');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    const events: { type: string; detail: unknown }[] = [];
    for (const type of ['payment-started', 'payment-error']) {
      el.addEventListener(type, (e) => events.push({ type, detail: (e as CustomEvent).detail }));
    }
    el.shadowRoot?.querySelector('button')?.click();
    return events;
  }
  const base = { amount: '10', 'storefront-id': 'c9b88f30-7a20-4416-8bc9-2612684ec4cd', 'api-base-url': 'https://api.example.test' };

  it('announces the reference it will pay against', () => {
    const events = button({ ...base, 'payment-reference': REF });
    expect(events[0]).toEqual({ type: 'payment-started', detail: { amount: 10, paymentReference: REF } });
  });

  it('refuses a malformed reference without starting', () => {
    const events = button({ ...base, 'payment-reference': '0x1234' });
    expect(events).toEqual([
      { type: 'payment-error', detail: { amount: 10, message: expect.stringMatching(/Invalid payment-reference/) as unknown } },
    ]);
  });
});
