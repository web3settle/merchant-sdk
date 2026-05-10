import { describe, it, expect } from 'vitest';
import {
  permitDomainKey,
  isPermitDomainKnown,
  UnknownPermitTokenError,
  signPermit,
} from '../evm/permit';

describe('permitDomainKey', () => {
  it('produces stable hex digests', () => {
    const k1 = permitDomainKey('USD Coin', '2', 1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    const k2 = permitDomainKey('USD Coin', '2', 1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lowercases verifyingContract so casing differences do not split the digest', () => {
    const a = permitDomainKey('USD Coin', '2', 1, '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
    const b = permitDomainKey('USD Coin', '2', 1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(a).toBe(b);
  });

  it('produces distinct digests when the verifyingContract differs (typo-squat defence)', () => {
    const real = permitDomainKey('USD Coin', '2', 1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    const squat = permitDomainKey('USD Coin', '2', 1, '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(real).not.toBe(squat);
  });
});

describe('isPermitDomainKnown', () => {
  it('returns false for an arbitrary unknown token', () => {
    const known = isPermitDomainKnown(
      'Bogus Coin',
      '1',
      1,
      '0x1111111111111111111111111111111111111111',
    );
    expect(known).toBe(false);
  });
});

describe('signPermit refuses unknown tokens (premortem F3)', () => {
  it('throws UnknownPermitTokenError before contacting the wallet', async () => {
    const fakeWalletClient = {
      getAddresses: async () => ['0x1111111111111111111111111111111111111111'],
      signTypedData: async () => {
        throw new Error('Wallet should never have been called');
      },
    };
    await expect(
      signPermit({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        walletClient: fakeWalletClient as any,
        chainId: 1,
        tokenAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        tokenName: 'USD Coin',
        tokenVersion: '2',
        owner: '0x1111111111111111111111111111111111111111',
        spender: '0x2222222222222222222222222222222222222222',
        value: 1n,
        nonce: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      }),
    ).rejects.toBeInstanceOf(UnknownPermitTokenError);
  });
});
