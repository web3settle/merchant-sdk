import { describe, it, expect, vi } from 'vitest';
import {
  buildTelemetryEvent,
  hashWalletAddress,
  redactErrorMessage,
  safeEmit,
  type TelemetryEvent,
} from '../core/telemetry';

describe('buildTelemetryEvent', () => {
  it('builds an event with the supplied fields and a fresh timestamp', () => {
    const before = Date.now();
    const ev = buildTelemetryEvent({
      chain: 'evm',
      phase: 'send',
      errorCode: 'user-rejected',
      walletId: 'injected',
      contractVersion: '3.1.0',
      walletDigest: 'abcdef0123456789',
      rawMessage: 'something broke',
    });
    const after = Date.now();
    expect(ev.chain).toBe('evm');
    expect(ev.phase).toBe('send');
    expect(ev.errorCode).toBe('user-rejected');
    expect(ev.walletId).toBe('injected');
    expect(ev.contractVersion).toBe('3.1.0');
    expect(ev.walletDigest).toBe('abcdef0123456789');
    expect(ev.message).toBe('something broke');
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(after);
  });

  it('omits PII even when rawMessage embeds an EVM address and a tx hash', () => {
    const ev = buildTelemetryEvent({
      chain: 'evm',
      phase: 'confirm',
      errorCode: 'reverted',
      rawMessage:
        'tx 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000abcdef00000000 reverted on 0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    expect(ev.message).not.toMatch(/0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48/);
    expect(ev.message).toContain('<redacted>');
  });
});

describe('redactErrorMessage', () => {
  it('redacts EVM addresses, tx hashes, and UUIDs', () => {
    const msg = 'failure on 0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48 (session 550e8400-e29b-41d4-a716-446655440000)';
    const out = redactErrorMessage(msg);
    expect(out).toBe('failure on 0x<redacted> (session <uuid>)');
  });

  it('redacts a Solana base58 pubkey when whitespace-bounded', () => {
    const msg = 'rejected by 4Nd1mYbHGd5gKPVtSuPxCMC8gXSyfuwBkXk1JLPv2VEC';
    const out = redactErrorMessage(msg);
    expect(out).toMatch(/<addr>/);
  });

  it('returns undefined for undefined input', () => {
    expect(redactErrorMessage(undefined)).toBeUndefined();
  });

  it('truncates messages over 240 chars to keep payload bounded', () => {
    const msg = 'X'.repeat(500);
    const out = redactErrorMessage(msg) ?? '';
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.endsWith('...')).toBe(true);
  });

  it('redacts POSIX absolute paths from stack-trace fragments', () => {
    const msg = 'TypeError at /Users/alice/src/wallet/index.ts:42';
    const out = redactErrorMessage(msg) ?? '';
    expect(out).not.toContain('/Users/alice');
    expect(out).toContain('<path>');
  });

  it('redacts Windows absolute paths', () => {
    const msg = 'Failed loading C:\\Users\\bob\\AppData\\Local\\app\\index.js';
    const out = redactErrorMessage(msg) ?? '';
    expect(out).not.toMatch(/C:\\Users\\bob/);
    expect(out).toContain('<path>');
  });

  it('redacts file:// URLs', () => {
    const msg = 'thrown at file:///home/vscode/workspace/x/y.ts:10:5';
    const out = redactErrorMessage(msg) ?? '';
    expect(out).not.toContain('file:///home');
    expect(out).toContain('<path>');
  });

  it('redacts long unbroken hex blobs (private-key shaped)', () => {
    // A 64+ char hex run is consistent with a raw private key, raw signature,
    // or session token. Strip rather than risk leaking via 3rd-party
    // analytics.
    const msg = 'leaked secret 0x' + 'ab'.repeat(40); // 80 hex chars, way past the floor
    const out = redactErrorMessage(msg) ?? '';
    expect(out).not.toMatch(/ab{20,}/i);
    expect(out).toContain('<');
  });
});

describe('hashWalletAddress', () => {
  it('returns undefined for null/undefined input', async () => {
    await expect(hashWalletAddress(null)).resolves.toBeUndefined();
    await expect(hashWalletAddress(undefined)).resolves.toBeUndefined();
    await expect(hashWalletAddress('')).resolves.toBeUndefined();
  });

  it('returns a deterministic, non-reversible 16-char digest', async () => {
    const a = await hashWalletAddress('0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48');
    const b = await hashWalletAddress('0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]+$/);
    expect(a).not.toContain('0xA0b86991');
  });

  it('returns different digests for different addresses', async () => {
    const a = await hashWalletAddress('0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48');
    const b = await hashWalletAddress('0xB0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(a).not.toBe(b);
  });

  it('hashes case-insensitively (mixed-case addresses agree)', async () => {
    const lower = await hashWalletAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    const upper = await hashWalletAddress('0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
    expect(lower).toBe(upper);
  });

  // Premortem F8: the digest is salted by storefrontId+day so two shops can't
  // join their digest tables to unmask shared wallets.
  it('produces distinct digests for two storefronts of the same wallet (same day)', async () => {
    const day = '2026-05-10';
    const addr = '0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48';
    const shop1 = await hashWalletAddress(addr, 'storefront-aaaa', day);
    const shop2 = await hashWalletAddress(addr, 'storefront-bbbb', day);
    expect(shop1).not.toBe(shop2);
  });

  it('is stable for the same storefront and day', async () => {
    const a = await hashWalletAddress('0xa0b86991', 'storefront-x', '2026-05-10');
    const b = await hashWalletAddress('0xa0b86991', 'storefront-x', '2026-05-10');
    expect(a).toBe(b);
  });

  it('produces different digests for the same storefront on different days', async () => {
    const addr = '0xa0b86991';
    const today = await hashWalletAddress(addr, 'storefront-x', '2026-05-10');
    const tomorrow = await hashWalletAddress(addr, 'storefront-x', '2026-05-11');
    expect(today).not.toBe(tomorrow);
  });
});

describe('safeEmit', () => {
  it('invokes the callback with the supplied event', () => {
    const cb = vi.fn();
    const ev: TelemetryEvent = buildTelemetryEvent({
      chain: 'tron',
      phase: 'approve',
      errorCode: 'unknown',
    });
    safeEmit(cb, ev);
    expect(cb).toHaveBeenCalledWith(ev);
  });

  it('swallows callback throws so they cannot break payment flow', () => {
    const cb = vi.fn(() => {
      throw new Error('analytics broken');
    });
    const ev = buildTelemetryEvent({ chain: 'evm', phase: 'send', errorCode: 'unknown' });
    expect(() => safeEmit(cb, ev)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the callback is undefined', () => {
    const ev = buildTelemetryEvent({ chain: 'solana', phase: 'connect', errorCode: 'unknown' });
    expect(() => safeEmit(undefined, ev)).not.toThrow();
  });
});
