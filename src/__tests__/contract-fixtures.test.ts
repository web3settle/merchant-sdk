/**
 * Cross-repo contract test (C1, SDK half). The files under `src/__fixtures__/contract/` are
 * vendored from gateway-core-backend `tests/fixtures/contract/` (source commit in that directory's
 * README), where a test regenerates them from the REAL backend serializers. Here they go through
 * the SDK's real Zod schemas and the real Ed25519 verifier, with the fixture's TEST-ONLY public
 * key as the trusted key (the verifier's `trustedKeysOverride` / `now` test seam — the baked-in
 * production key is not touched). A field rename, a canonical-JSON change or a signature-input
 * change on either side breaks this file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import signedConfig from '../__fixtures__/contract/payment-config.signed.json';
import quote from '../__fixtures__/contract/quote.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PaymentConfigSchema,
  QuoteResponseSchema,
  SignedPaymentConfigEnvelopeSchema,
} from '../core/types';
import { verifyPaymentConfig } from '../core/payment-config-verifier';
import { Web3SettleApiClient } from '../core/api-client';
import * as configModule from '../core/config';

const TEST_PUB = readFileSync(path.join(__dirname, '../__fixtures__/contract/test-ed25519.pub'), 'utf8').trim();
const SIGNED_AT_MS = Date.parse(signedConfig.signedAt);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('payment-config.signed.json (GET /api/storefronts/{id}/payment-config)', () => {
  it('is the envelope the SDK parses: { data, signedAt, signature, publicKey }', () => {
    const envelope = SignedPaymentConfigEnvelopeSchema.parse(signedConfig);
    expect(envelope.publicKey).toBe(TEST_PUB);
    const data = PaymentConfigSchema.parse(envelope.data);
    expect(data.chains[0]).toMatchObject({ chainId: 8453, name: 'Base', confirmations: 12 });
    expect(data.chains[0].tokens[0]).toEqual({ address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 });
    expect(data.allowedContractAddresses['8453']).toEqual([data.chains[0].contractAddress]);
  });

  it('verifies: Ed25519 over signedAt + canonicalJson(data) against the TEST key', () => {
    const out = verifyPaymentConfig({
      data: signedConfig.data,
      signed_at: signedConfig.signedAt,
      signature: signedConfig.signature,
      now: SIGNED_AT_MS,
      trustedKeysOverride: { primary: TEST_PUB, secondary: '' },
    });
    expect(out).toEqual({ ok: true, matchedKey: TEST_PUB });
  });

  it('a renamed or re-valued field breaks the signature (canonical JSON covers every key)', () => {
    const renamed = { ...signedConfig.data, commissionBasisPoints: 250 } as Record<string, unknown>;
    delete renamed.commissionBps;
    for (const data of [renamed, { ...signedConfig.data, commissionBps: 251 }]) {
      const out = verifyPaymentConfig({
        data,
        signed_at: signedConfig.signedAt,
        signature: signedConfig.signature,
        now: SIGNED_AT_MS,
        trustedKeysOverride: { primary: TEST_PUB, secondary: '' },
      });
      expect(out).toMatchObject({ ok: false, reason: 'signature-invalid' });
    }
  });

  it('declares a contractAbiVersion this SDK speaks (the client fails closed otherwise)', () => {
    expect(
      configModule.SUPPORTED_ABI_VERSIONS.has(signedConfig.data.contractAbiVersion),
      `fixture contractAbiVersion "${signedConfig.data.contractAbiVersion}" is not in SUPPORTED_ABI_VERSIONS ${JSON.stringify([...configModule.SUPPORTED_ABI_VERSIONS])}`,
    ).toBe(true);
  });

  it('is accepted end to end by Web3SettleApiClient.fetchPaymentConfig (test key trusted, clock pinned)', async () => {
    vi.spyOn(configModule, 'WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY', 'get').mockReturnValue(TEST_PUB);
    vi.useFakeTimers({ now: SIGNED_AT_MS, toFake: ['Date'] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(signedConfig), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new Web3SettleApiClient('https://api.example.test', signedConfig.data.storefrontId);
    const cfg = await client.fetchPaymentConfig();
    expect(cfg).toEqual(PaymentConfigSchema.parse(signedConfig.data));
  });
});

describe('quote.json (GET /api/storefronts/{id}/quote)', () => {
  it('parses with QuoteResponseSchema; amountToken is the base-unit string the SDK signs', () => {
    const q = QuoteResponseSchema.parse(quote);
    expect(q).toMatchObject({
      network: 'Base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      amountUsd: 49.99,
      amountToken: '49990000',
      amountTokenDisplay: 49.99,
      priceUsd: 1.0001,
      source: 'chainlink',
    });
    expect(BigInt(q.amountToken)).toBe(49_990_000n);
    expect(q.roundId).toBe('18446744073709562345');
  });
});
