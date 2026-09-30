import { describe, it, expect, vi } from 'vitest';
import { keccak256, stringToBytes, type PublicClient } from 'viem';
import {
  permitDomainKey,
  isPermitDomainKnown,
  detectPermitSupport,
  EIP2612_PERMIT_TYPEHASH,
  UnknownPermitTokenError,
  signPermit,
} from '../evm/permit';
import { KNOWN_PERMIT_TOKENS } from '../core/config';

// The three domains ADR-0004 trusts (HP-5), exactly as the tokens report them on-chain
// (name(), version(), DOMAIN_SEPARATOR() re-derived — docs/PERMIT_ALLOWLIST.md).
const REAL_DOMAINS = [
  { label: 'USDC Ethereum', name: 'USD Coin', version: '2', chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { label: 'DAI Ethereum', name: 'Dai Stablecoin', version: '1', chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  { label: 'USDC Base', name: 'USD Coin', version: '2', chainId: 8453, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
] as const;

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

describe('KNOWN_PERMIT_TOKENS (HP-5 real digests)', () => {
  it.each(REAL_DOMAINS)('trusts $label', ({ name, version, chainId, address }) => {
    expect(isPermitDomainKnown(name, version, chainId, address)).toBe(true);
  });

  it('holds exactly those three digests — no placeholder, nothing extra', () => {
    const expected = new Set(REAL_DOMAINS.map((d) => permitDomainKey(d.name, d.version, d.chainId, d.address)));
    expect(new Set(KNOWN_PERMIT_TOKENS)).toEqual(expected);
  });

  it('does not trust the same name/version on the wrong chain (USDC Ethereum address on Base)', () => {
    expect(isPermitDomainKnown('USD Coin', '2', 8453, REAL_DOMAINS[0].address)).toBe(false);
  });

  it('does not trust a wrong version of a real token', () => {
    expect(isPermitDomainKnown('USD Coin', '1', 1, REAL_DOMAINS[0].address)).toBe(false);
  });
});

describe('detectPermitSupport — EIP-2612 compatibility', () => {
  const OWNER = '0x3333333333333333333333333333333333333333' as const;
  const DAI_STYLE_TYPEHASH = keccak256(
    stringToBytes('Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)'),
  );

  function tokenReturning(typehash: `0x${string}` | Error) {
    return {
      readContract: vi.fn(({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case 'name': return Promise.resolve('Some Token');
          case 'nonces': return Promise.resolve(7n);
          case 'version': return Promise.resolve('1');
          case 'DOMAIN_SEPARATOR': return Promise.resolve(`0x${'ab'.repeat(32)}`);
          case 'PERMIT_TYPEHASH':
            return typehash instanceof Error ? Promise.reject(typehash) : Promise.resolve(typehash);
          default: return Promise.reject(new Error(`unexpected ${functionName}`));
        }
      }),
    } as unknown as PublicClient;
  }

  it('EIP2612_PERMIT_TYPEHASH is the keccak of the EIP-2612 Permit struct', () => {
    expect(EIP2612_PERMIT_TYPEHASH).toBe(
      keccak256(stringToBytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')),
    );
  });

  it('reports a DAI-style permit as unsupported, so auto falls back to approve()', async () => {
    const out = await detectPermitSupport(tokenReturning(DAI_STYLE_TYPEHASH), REAL_DOMAINS[1].address, OWNER);
    expect(out).toEqual({ supported: false, reason: 'non-eip2612-permit' });
  });

  it('accepts a token whose PERMIT_TYPEHASH is EIP-2612 (USDC)', async () => {
    const out = await detectPermitSupport(tokenReturning(EIP2612_PERMIT_TYPEHASH), REAL_DOMAINS[0].address, OWNER);
    expect(out).toMatchObject({ supported: true, name: 'Some Token', version: '1', nonce: 7n });
  });

  it('accepts a token that does not expose PERMIT_TYPEHASH (OpenZeppelin ERC20Permit)', async () => {
    const out = await detectPermitSupport(tokenReturning(new Error('execution reverted')), REAL_DOMAINS[0].address, OWNER);
    expect(out.supported).toBe(true);
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
      getAddresses: () => Promise.resolve(['0x1111111111111111111111111111111111111111']),
      signTypedData: () => Promise.reject(new Error('Wallet should never have been called')),
    };
    await expect(
      signPermit({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately
        // partial wallet-client double; the point of this test is that signPermit
        // rejects BEFORE touching the wallet at all.
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
