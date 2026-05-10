import { describe, it, expect, vi } from 'vitest';
import type { WalletClient } from 'viem';
import {
  assertDeadlineFresh,
  buildPermitTypedData,
  signPermit,
  validatePermitSignature,
  MAX_PERMIT_DEADLINE_WINDOW_SECONDS,
} from '../evm/permit';

const OWNER = '0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const SPENDER = '0x1111111111111111111111111111111111111111' as const;
const TOKEN = '0x2222222222222222222222222222222222222222' as const;

// 65-byte signature (132 hex chars) shaped like a real EIP-712 reply. r and s
// are non-zero, s is in the low half, v is 27. Used as the wallet's mock reply
// in the signPermit happy-path tests.
const VALID_SIG = ('0x' +
  '11'.repeat(32) +              // r
  '22'.repeat(32) +              // s
  '1b'                           // v = 27
) as `0x${string}`;

function fakeWallet(opts: {
  account?: `0x${string}`;
  chainId?: number;
  signature?: `0x${string}`;
  signError?: string;
} = {}) {
  const account = opts.account ?? OWNER;
  const chainId = opts.chainId ?? 1;
  const signature = opts.signature ?? VALID_SIG;
  return {
    getAddresses: vi.fn().mockResolvedValue([account]),
    getChainId: vi.fn().mockResolvedValue(chainId),
    signTypedData: vi.fn().mockImplementation(() => {
      if (opts.signError) return Promise.reject(new Error(opts.signError));
      return Promise.resolve(signature);
    }),
  } as unknown as WalletClient;
}

describe('assertDeadlineFresh', () => {
  it('accepts a deadline within the SDK cap window', () => {
    const now = Math.floor(Date.now() / 1000);
    const deadline = BigInt(now + 30 * 60); // 30 minutes
    expect(() => assertDeadlineFresh(deadline)).not.toThrow();
  });

  it('rejects a deadline already in the past', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => assertDeadlineFresh(BigInt(now - 1))).toThrow(/not in the future/);
  });

  it('rejects an unbounded deadline (e.g. MAX_SAFE_INTEGER)', () => {
    // Acts as a no-expiry bearer permit — defeats the EIP-2612 deadline
    // mechanism. Must be rejected so a bug in the caller can't sign one.
    expect(() => assertDeadlineFresh(BigInt(Number.MAX_SAFE_INTEGER))).toThrow(/exceeds the SDK cap/);
  });

  it('rejects a deadline more than the cap into the future', () => {
    const now = Math.floor(Date.now() / 1000);
    const tooFar = BigInt(now + MAX_PERMIT_DEADLINE_WINDOW_SECONDS + 60);
    expect(() => assertDeadlineFresh(tooFar)).toThrow(/exceeds the SDK cap/);
  });

  it('honors a caller-provided larger window when explicitly set', () => {
    // The cap is a default; advanced callers can opt out by supplying a wider
    // bound. This keeps the function flexible while making the safe path
    // automatic.
    const now = Math.floor(Date.now() / 1000);
    const twoHours = 60 * 60 * 2;
    expect(() => assertDeadlineFresh(BigInt(now + twoHours), now, twoHours + 1)).not.toThrow();
  });
});

describe('buildPermitTypedData', () => {
  it('packs the EIP-2612 domain with chainId, name, version, verifyingContract', () => {
    const td = buildPermitTypedData({
      chainId: 137,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      tokenVersion: '2',
      owner: OWNER,
      spender: SPENDER,
      value: 1_000_000n,
      nonce: 5n,
      deadline: 9_999_999_999n,
    });
    expect(td.domain).toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 137,
      verifyingContract: TOKEN,
    });
    expect(td.primaryType).toBe('Permit');
    // Permit struct must match EIP-2612 exactly (owner, spender, value, nonce, deadline).
    expect(td.types.Permit).toEqual([
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ]);
  });

  it('defaults version to "1" when omitted', () => {
    const td = buildPermitTypedData({
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'DAI',
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      nonce: 0n,
      deadline: 9_999_999_999n,
    });
    expect(td.domain.version).toBe('1');
  });
});

describe('validatePermitSignature', () => {
  it('accepts a well-formed signature with low-s and v=27', () => {
    expect(validatePermitSignature(VALID_SIG)).toEqual({ valid: true });
  });

  it('rejects a wrong-length string', () => {
    const short = '0xdeadbeef' as `0x${string}`;
    const out = validatePermitSignature(short);
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Expected 132 hex chars/);
  });

  it('rejects an r=0 signature', () => {
    const sig = ('0x' + '00'.repeat(32) + '22'.repeat(32) + '1b') as `0x${string}`;
    expect(validatePermitSignature(sig).valid).toBe(false);
  });

  it('rejects a high-s signature (EIP-2 malleability)', () => {
    // s = secp256k1 N - 1 → high half of the curve order.
    const highS = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140';
    const sig = ('0x' + '11'.repeat(32) + highS + '1b') as `0x${string}`;
    expect(validatePermitSignature(sig).valid).toBe(false);
  });

  it('rejects an out-of-range v', () => {
    const sig = ('0x' + '11'.repeat(32) + '22'.repeat(32) + 'ff') as `0x${string}`;
    expect(validatePermitSignature(sig).valid).toBe(false);
  });
});

describe('signPermit', () => {
  function freshDeadline(): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
  }

  it('signs and returns split v/r/s for a valid input', async () => {
    const wallet = fakeWallet();
    const out = await signPermit({
      walletClient: wallet,
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      tokenVersion: '2',
      owner: OWNER,
      spender: SPENDER,
      value: 1_000_000n,
      nonce: 0n,
      deadline: freshDeadline(),
    });
    expect(out.signature).toBe(VALID_SIG);
    expect([27, 28]).toContain(out.v);
    expect(out.r).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(out.s).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('refuses to sign when the wallet account differs from the permit owner', async () => {
    const wallet = fakeWallet({ account: '0x9999999999999999999999999999999999999999' });
    await expect(signPermit({
      walletClient: wallet,
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      nonce: 0n,
      deadline: freshDeadline(),
    })).rejects.toThrow(/does not match permit owner/);
  });

  it('refuses to sign when the wallet chainId disagrees with the permit chainId', async () => {
    // The wallet is on chain 137 but the caller is asking us to sign for chain 1.
    // The signed message would be replayable on the wallet's actual chain.
    const wallet = fakeWallet({ chainId: 137 });
    await expect(signPermit({
      walletClient: wallet,
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      nonce: 0n,
      deadline: freshDeadline(),
    })).rejects.toThrow(/Wallet chainId 137 does not match permit chainId 1/);
  });

  it('refuses to sign with a MAX_SAFE_INTEGER deadline (no expiry)', async () => {
    const wallet = fakeWallet();
    await expect(signPermit({
      walletClient: wallet,
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      nonce: 0n,
      deadline: BigInt(Number.MAX_SAFE_INTEGER),
    })).rejects.toThrow(/exceeds the SDK cap/);
  });

  it('throws when the wallet returns a malformed signature', async () => {
    // r=0 → fails validatePermitSignature inside signPermit before returning.
    const badSig = ('0x' + '00'.repeat(32) + '22'.repeat(32) + '1b') as `0x${string}`;
    const wallet = fakeWallet({ signature: badSig });
    await expect(signPermit({
      walletClient: wallet,
      chainId: 1,
      tokenAddress: TOKEN,
      tokenName: 'USD Coin',
      owner: OWNER,
      spender: SPENDER,
      value: 1n,
      nonce: 0n,
      deadline: freshDeadline(),
    })).rejects.toThrow(/invalid permit signature/);
  });
});
