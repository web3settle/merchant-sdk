import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { toEventSelector, toFunctionSelector, type AbiEvent } from 'viem';
import { MERCHANT_PAY_IN_ABI } from '../tron/abi';
import { TronPaymentPipeline, buildTronPayInCall } from '../tron/pipeline';
import { estimateTronGas } from '../tron/estimateGas';
import { InvalidPaymentReferenceError } from '../core/payment-reference';
import { NATIVE_TOKEN_SENTINEL, PaymentStatus, type ChainConfig } from '../core/types';
import type { TronWebLike } from '../tron/tronweb-global';

// HP-25: TRON pay-ins carry the gateway's payment reference (MerchantPayIn V3.2.3), with the same
// attribution policy as the EVM root — attributed by default, the plain pay-in an explicit opt-in.

// Selectors of MerchantPayIn V3.2.3 as compiled for TRON (smart-contracts tron/build/contracts/
// MerchantPayIn.json, 2026-10-19). Identical to the EVM build: a selector is keccak of the
// signature. If the TRON ABI drifts from the contract, these fail.
const SELECTOR = {
  payInNative: '0x36b45c5b',
  payInToken: '0x0dff7042',
  payInNativeWithReference: '0x817da306',
  payInTokenWithReference: '0xa7d020be',
} as const;

const REF = '0x8f14e45fceea167a5a36dedd4bea254300000000000000000000000000000000' as const;
const BAD_REF = '0x1234' as unknown as `0x${string}`;
const CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

const chain: ChainConfig = {
  chainId: 728126428,
  name: 'Tron',
  contractAddress: CONTRACT,
  tokens: [{ address: USDT, symbol: 'USDT', decimals: 6 }],
  explorerUrl: 'https://tronscan.org',
  nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
};

describe('TRON ABI — what reaches the chain', () => {
  it('declares the four V3.2.3 pay-ins with the compiled selectors', () => {
    const fns = MERCHANT_PAY_IN_ABI.filter((e) => e.type === 'function');
    const selectors = Object.fromEntries(fns.map((f) => [f.name, toFunctionSelector(f)]));
    expect(selectors).toEqual(SELECTOR);
  });

  it('declares the PaymentReference(bytes32 indexed) event the gateway pairs with the PayIn', () => {
    const ev = MERCHANT_PAY_IN_ABI.find((e) => e.type === 'event');
    expect(ev).toMatchObject({ name: 'PaymentReference', inputs: [{ type: 'bytes32', indexed: true }] });
    // The gateway's deposit detector subscribes to this topic0 (keccak of the signature); if the
    // event name or input type ever changed, the deposit would never be attributed.
    expect(toEventSelector(ev as AbiEvent)).toBe('0xf04f7cca0f7bcff234db9a91f7c389ed61d2884aeab13f721976364380642dfa');
  });
});

describe('buildTronPayInCall', () => {
  it('native + reference → payInNativeWithReference(ref) with the amount as call value', () => {
    expect(buildTronPayInCall({ token: NATIVE_TOKEN_SENTINEL, amount: 10_000_000n, paymentReference: REF })).toEqual({
      method: 'payInNativeWithReference',
      args: [REF],
      value: '10000000',
    });
  });

  it('token + reference → payInTokenWithReference(token, amount, ref) with no call value', () => {
    expect(buildTronPayInCall({ token: USDT, amount: 5_000_000n, paymentReference: REF })).toEqual({
      method: 'payInTokenWithReference',
      args: [USDT, '5000000', REF],
    });
  });

  it('without a reference → the plain (unattributed) calls', () => {
    expect(buildTronPayInCall({ token: NATIVE_TOKEN_SENTINEL, amount: 1n })).toEqual({ method: 'payInNative', args: [], value: '1' });
    expect(buildTronPayInCall({ token: USDT, amount: 1n })).toEqual({ method: 'payInToken', args: [USDT, '1'] });
  });

  it.each([
    ['too short', '0x1234'],
    ['the zero word', `0x${'00'.repeat(32)}`],
    ['missing 0x', REF.slice(2)],
  ])('refuses a reference that is %s', (_label, bad) => {
    expect(() => buildTronPayInCall({ token: NATIVE_TOKEN_SENTINEL, amount: 1n, paymentReference: bad as unknown as `0x${string}` }))
      .toThrow(InvalidPaymentReferenceError);
  });
});

// A TronWeb whose contract records which method was invoked and with what.
function mockTronWeb() {
  const send = vi.fn().mockResolvedValue('txid-1');
  const calls: { method: string; args: unknown[] }[] = [];
  const contractObj: Record<string, unknown> = {};
  for (const method of ['payInNative', 'payInToken', 'payInNativeWithReference', 'payInTokenWithReference']) {
    contractObj[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return { send };
    };
  }
  const tronWeb = {
    defaultAddress: { base58: CONTRACT, hex: '0x41' + '00'.repeat(20) },
    ready: true,
    contract: () => ({ at: vi.fn().mockResolvedValue(contractObj) }),
    trx: { getConfirmedTransaction: vi.fn() },
    toSun: vi.fn(),
    address: { toHex: vi.fn(), fromHex: vi.fn() },
  };
  return { tronWeb, send, calls };
}

describe('TronPaymentPipeline.execute', () => {
  afterEach(() => {
    delete (window as unknown as { tronWeb?: unknown }).tronWeb;
  });

  it('sends payInNativeWithReference(ref) with the amount as callValue when given a reference', async () => {
    const { tronWeb, send, calls } = mockTronWeb();
    (window as unknown as { tronWeb: unknown }).tronWeb = tronWeb;
    const hash = await new TronPaymentPipeline().execute(chain, NATIVE_TOKEN_SENTINEL, 10_000_000n, { paymentReference: REF });
    expect(hash).toBe('txid-1');
    expect(calls).toEqual([{ method: 'payInNativeWithReference', args: [REF] }]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ callValue: '10000000' }));
  });

  it('sends payInTokenWithReference(token, amount, ref) for a TRC-20 pay-in', async () => {
    const { tronWeb, calls } = mockTronWeb();
    (window as unknown as { tronWeb: unknown }).tronWeb = tronWeb;
    await new TronPaymentPipeline().execute(chain, USDT, 5_000_000n, { paymentReference: REF });
    expect(calls).toEqual([{ method: 'payInTokenWithReference', args: [USDT, '5000000', REF] }]);
  });

  it('still sends the plain payInNative when no reference is given (unattributed opt-in)', async () => {
    const { tronWeb, calls } = mockTronWeb();
    (window as unknown as { tronWeb: unknown }).tronWeb = tronWeb;
    await new TronPaymentPipeline().execute(chain, NATIVE_TOKEN_SENTINEL, 1n);
    expect(calls).toEqual([{ method: 'payInNative', args: [] }]);
  });

  it('rejects an invalid reference before touching the wallet', async () => {
    const { tronWeb, calls } = mockTronWeb();
    (window as unknown as { tronWeb: unknown }).tronWeb = tronWeb;
    await expect(
      new TronPaymentPipeline().execute(chain, NATIVE_TOKEN_SENTINEL, 1n, { paymentReference: BAD_REF }),
    ).rejects.toBeInstanceOf(InvalidPaymentReferenceError);
    expect(calls).toEqual([]);
  });
});

describe('estimateTronGas with a reference', () => {
  function estimatorTronWeb() {
    const triggerConstantContract = vi.fn().mockResolvedValue({
      energy_used: 70_000,
      transaction: { raw_data_hex: '00'.repeat(300) },
      result: { result: true },
    });
    return {
      tw: {
        defaultAddress: { base58: CONTRACT, hex: '0x41' + '00'.repeat(20) },
        ready: true,
        contract: () => ({ at: vi.fn().mockResolvedValue({}) }),
        trx: { getConfirmedTransaction: vi.fn() },
        toSun: vi.fn(),
        address: { toHex: vi.fn(), fromHex: vi.fn() },
        transactionBuilder: { triggerConstantContract },
      } as unknown as TronWebLike,
      triggerConstantContract,
    };
  }

  it('estimates payInNativeWithReference(bytes32) with the reference as a bytes32 parameter', async () => {
    const { tw, triggerConstantContract } = estimatorTronWeb();
    await estimateTronGas({ contractAddress: CONTRACT, token: NATIVE_TOKEN_SENTINEL, amount: 10_000_000n, paymentReference: REF, sunPerEnergy: 280, tronWebOverride: tw });
    const args = triggerConstantContract.mock.calls[0];
    expect(args[1]).toBe('payInNativeWithReference(bytes32)');
    expect(args[3]).toEqual([{ type: 'bytes32', value: REF }]);
    expect(args[2]).toMatchObject({ callValue: 10_000_000 });
  });

  it('estimates payInTokenWithReference(address,uint256,bytes32) for a TRC-20 pay-in', async () => {
    const { tw, triggerConstantContract } = estimatorTronWeb();
    await estimateTronGas({ contractAddress: CONTRACT, token: USDT, amount: 5_000_000n, paymentReference: REF, sunPerEnergy: 280, tronWebOverride: tw });
    const args = triggerConstantContract.mock.calls[0];
    expect(args[1]).toBe('payInTokenWithReference(address,uint256,bytes32)');
    expect(args[3]).toEqual([
      { type: 'address', value: USDT },
      { type: 'uint256', value: '5000000' },
      { type: 'bytes32', value: REF },
    ]);
  });
});

// ── the hook: attribution decided before the wallet ──
const pipeline = {
  family: 'tron' as const,
  quoteAmount: vi.fn(),
  needsApproval: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
  waitForReceipt: vi.fn(),
};
vi.mock('../tron/TronProvider', () => ({
  useTronWeb3SettleContext: () => ({
    pipeline,
    wallet: { connected: true, address: CONTRACT, connecting: false, error: null },
    config: { apiBaseUrl: 'http://x', storefrontId: 's' },
  }),
}));
const { useTronPayment } = await import('../tron/useTronPayment');

describe('useTronPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipeline.quoteAmount.mockResolvedValue(10_000_000n);
    pipeline.needsApproval.mockResolvedValue(false);
    pipeline.execute.mockResolvedValue('txid-9');
    pipeline.waitForReceipt.mockResolvedValue({ success: true, blockNumber: 1, raw: {} });
  });

  it('hands the paymentReference to the pipeline and succeeds', async () => {
    const { result } = renderHook(() => useTronPayment());
    await act(() => result.current.startPayment(1, chain, NATIVE_TOKEN_SENTINEL, { paymentReference: REF }));
    expect(result.current.status).toBe(PaymentStatus.Success);
    expect(result.current.txHash).toBe('txid-9');
    expect(pipeline.execute).toHaveBeenCalledWith(chain, NATIVE_TOKEN_SENTINEL, 10_000_000n, { paymentReference: REF });
  });

  it('sends exactly atomicAmount when given one, without quoting again', async () => {
    const { result } = renderHook(() => useTronPayment());
    await act(() => result.current.startPayment(1, chain, NATIVE_TOKEN_SENTINEL, { paymentReference: REF, atomicAmount: '123456' }));
    expect(pipeline.quoteAmount).not.toHaveBeenCalled();
    expect(pipeline.execute).toHaveBeenCalledWith(chain, NATIVE_TOKEN_SENTINEL, 123_456n, { paymentReference: REF });
  });

  it('refuses to prompt the wallet without a reference (attributed is the default)', async () => {
    const { result } = renderHook(() => useTronPayment());
    await act(() => result.current.startPayment(1, chain, NATIVE_TOKEN_SENTINEL));
    expect(result.current.status).toBe(PaymentStatus.Error);
    expect(result.current.error).toMatch(/Refusing to pay without a paymentReference/);
    expect(pipeline.quoteAmount).not.toHaveBeenCalled();
    expect(pipeline.execute).not.toHaveBeenCalled();
  });

  it("sends the plain pay-in only on the explicit mode: 'unattributed' opt-in", async () => {
    const { result } = renderHook(() => useTronPayment());
    await act(() => result.current.startPayment(1, chain, NATIVE_TOKEN_SENTINEL, { mode: 'unattributed' }));
    expect(result.current.status).toBe(PaymentStatus.Success);
    expect(pipeline.execute).toHaveBeenCalledWith(chain, NATIVE_TOKEN_SENTINEL, 10_000_000n, { paymentReference: undefined });
  });

  it('rejects a reference together with mode unattributed', async () => {
    const { result } = renderHook(() => useTronPayment());
    await act(() => result.current.startPayment(1, chain, NATIVE_TOKEN_SENTINEL, { mode: 'unattributed', paymentReference: REF }));
    expect(result.current.status).toBe(PaymentStatus.Error);
    expect(result.current.error).toMatch(/drop one of them/);
    expect(pipeline.execute).not.toHaveBeenCalled();
  });
});
