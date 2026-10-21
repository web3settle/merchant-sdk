import { describe, it, expect, vi } from 'vitest';
import { decodeFunctionData, type WalletClient } from 'viem';
import { PAYMENT_CONTRACT_ABI } from '../core/config';
import {
  buildPayInCall,
  executePayInNativeWithReference,
  executePayInTokenWithReference,
} from '../core/contract';
import {
  InvalidPaymentReferenceError,
  MissingPaymentReferenceError,
  isPaymentReference,
  resolveAttribution,
} from '../core/payment-reference';

// Selectors of MerchantPayIn V3.2.3 as compiled (smart-contracts evm/out MerchantPayIn.json
// methodIdentifiers, 2026-09-30). If the SDK ABI drifts from the contract, these fail.
const SELECTOR = {
  payInNative: '0x36b45c5b',
  payInToken: '0x0dff7042',
  payInNativeWithReference: '0x817da306',
  payInTokenWithReference: '0xa7d020be',
} as const;

// What POST /api/payment/create returns: the request id's 16 bytes, left-aligned, zero-padded.
const REF = '0x8f14e45fceea167a5a36dedd4bea254300000000000000000000000000000000' as const;
const CONTRACT = '0x675f8cc6d9b5b02bd8eb0920d860ce748dd1b3a0' as const;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

describe('buildPayInCall — what reaches the chain', () => {
  it('native + reference encodes payInNativeWithReference(ref) and sends the amount as value', () => {
    const call = buildPayInCall({ token: 'native', amount: 10n ** 16n, paymentReference: REF });
    expect(call.data.slice(0, 10)).toBe(SELECTOR.payInNativeWithReference);
    expect(call.value).toBe(10n ** 16n);
    const decoded = decodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, data: call.data });
    expect(decoded.functionName).toBe('payInNativeWithReference');
    expect(decoded.args).toEqual([REF]);
  });

  it('token + reference encodes payInTokenWithReference(token, amount, ref) with zero value', () => {
    const call = buildPayInCall({ token: USDC_BASE, amount: 9_990_000n, paymentReference: REF });
    expect(call.data.slice(0, 10)).toBe(SELECTOR.payInTokenWithReference);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: PAYMENT_CONTRACT_ABI, data: call.data });
    expect(decoded.functionName).toBe('payInTokenWithReference');
    expect(decoded.args).toEqual([USDC_BASE, 9_990_000n, REF]);
  });

  it('without a reference encodes the plain (unattributed) calls', () => {
    expect(buildPayInCall({ token: 'native', amount: 1n }).data).toBe(SELECTOR.payInNative);
    expect(buildPayInCall({ token: USDC_BASE, amount: 1n }).data.slice(0, 10)).toBe(SELECTOR.payInToken);
  });

  it.each([
    ['too short', '0x1234'],
    ['not hex', `0x${'zz'.repeat(32)}`],
    ['the zero word', `0x${'00'.repeat(32)}`],
    ['missing 0x', REF.slice(2)],
  ])('refuses a reference that is %s', (_label, bad) => {
    expect(() =>
      buildPayInCall({ token: 'native', amount: 1n, paymentReference: bad as `0x${string}` }),
    ).toThrow(InvalidPaymentReferenceError);
  });
});

describe('resolveAttribution — the policy every pay path applies before the wallet', () => {
  it('defaults to attributed and refuses without a reference', () => {
    expect(() => resolveAttribution({})).toThrow(MissingPaymentReferenceError);
    expect(() => resolveAttribution({ paymentReference: null })).toThrow(MissingPaymentReferenceError);
    expect(() => resolveAttribution({ paymentReference: '' })).toThrow(MissingPaymentReferenceError);
  });

  it('attributes when a valid reference is given', () => {
    expect(resolveAttribution({ paymentReference: REF })).toEqual({ mode: 'attributed', paymentReference: REF });
  });

  it('rejects a malformed reference even in the default mode', () => {
    expect(() => resolveAttribution({ paymentReference: '0xdead' })).toThrow(InvalidPaymentReferenceError);
  });

  it('plain payIn* only on the explicit unattributed opt-in', () => {
    expect(resolveAttribution({ mode: 'unattributed' })).toEqual({ mode: 'unattributed' });
  });

  it('refuses the contradiction of unattributed + a reference', () => {
    expect(() => resolveAttribution({ mode: 'unattributed', paymentReference: REF })).toThrow(
      InvalidPaymentReferenceError,
    );
  });

  it('isPaymentReference accepts mixed case but not the zero word', () => {
    expect(isPaymentReference(REF.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(isPaymentReference(`0x${'0'.repeat(64)}`)).toBe(false);
    expect(isPaymentReference(42)).toBe(false);
  });
});

describe('execute*WithReference — the transaction handed to the wallet', () => {
  function recordingWallet() {
    const sendTransaction = vi.fn().mockResolvedValue(`0x${'aa'.repeat(32)}`);
    const wallet = {
      getAddresses: vi.fn().mockResolvedValue(['0x3333333333333333333333333333333333333333']),
      sendTransaction,
      chain: undefined,
    } as unknown as WalletClient;
    return { wallet, sendTransaction };
  }

  it('native: to = the merchant contract, value = amount, calldata carries the reference', async () => {
    const { wallet, sendTransaction } = recordingWallet();
    await executePayInNativeWithReference(wallet, CONTRACT, 5n, REF);
    const tx = sendTransaction.mock.calls[0][0] as { to: string; value: bigint; data: `0x${string}` };
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(5n);
    expect(tx.data).toBe(buildPayInCall({ token: 'native', amount: 5n, paymentReference: REF }).data);
  });

  it('token: no value, calldata is payInTokenWithReference', async () => {
    const { wallet, sendTransaction } = recordingWallet();
    await executePayInTokenWithReference(wallet, CONTRACT, USDC_BASE, 7n, REF);
    const tx = sendTransaction.mock.calls[0][0] as { to: string; value?: bigint; data: `0x${string}` };
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBeUndefined();
    expect(tx.data.slice(0, 10)).toBe(SELECTOR.payInTokenWithReference);
  });

  it('never prompts the wallet for a malformed reference', async () => {
    const { wallet, sendTransaction } = recordingWallet();
    await expect(
      executePayInNativeWithReference(wallet, CONTRACT, 5n, '0x00'),
    ).rejects.toThrow(InvalidPaymentReferenceError);
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
