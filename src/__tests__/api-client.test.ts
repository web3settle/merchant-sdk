import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { Web3SettleApiClient } from '../core/api-client';
import { Web3SettleApiError } from '../core/types';
import { canonicalJson } from '../core/canonical-json';
import * as configModule from '../core/config';

const BASE_URL = 'https://api.web3settle.com';
const STOREFRONT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTRACT_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += b[i].toString(16).padStart(2, '0');
  return s;
}

// Test signing key — paired with a temporary primary pubkey override below.
const TEST_PRIV = ed25519.utils.randomPrivateKey();
const TEST_PUB_HEX = bytesToHex(ed25519.getPublicKey(TEST_PRIV));

interface PartialPaymentConfig {
  chains?: unknown[];
  commissionBps?: number;
  storefrontId?: string;
  contractAbiVersion?: string;
  allowedContractAddresses?: Record<string, string[]>;
}

function defaultPayload(overrides: PartialPaymentConfig = {}): Record<string, unknown> {
  return {
    chains: [
      {
        chainId: 1,
        name: 'Ethereum',
        contractAddress: CONTRACT_ADDR,
        tokens: [
          { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
        ],
        explorerUrl: 'https://etherscan.io',
      },
    ],
    commissionBps: 250,
    storefrontId: STOREFRONT_ID,
    contractAbiVersion: 'V3.2',
    allowedContractAddresses: { '1': [CONTRACT_ADDR.toLowerCase()] },
    ...overrides,
  };
}

function signEnvelope(data: unknown, opts: { signedAt?: string; signWith?: Uint8Array } = {}) {
  const signedAt = opts.signedAt ?? new Date().toISOString();
  const message = new TextEncoder().encode(signedAt + canonicalJson(data));
  const sig = ed25519.sign(message, opts.signWith ?? TEST_PRIV);
  return {
    data,
    signedAt,
    signature: bytesToHex(sig),
    publicKey: TEST_PUB_HEX,
  };
}

describe('Web3SettleApiClient', () => {
  let client: Web3SettleApiClient;
  let primarySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Web3SettleApiClient(BASE_URL, STOREFRONT_ID);
    vi.restoreAllMocks();
    // Override the baked-in primary pubkey to our test key. The verifier
    // reads the constant indirectly so we monkey-patch the module export.
    primarySpy = vi.spyOn(configModule, 'WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY', 'get')
      .mockReturnValue(TEST_PUB_HEX);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    primarySpy.mockRestore();
  });

  describe('fetchPaymentConfig', () => {
    it('fetches and validates a signed payment config successfully', async () => {
      const payload = defaultPayload();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(payload)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const config = await client.fetchPaymentConfig();

      expect(config.chains).toHaveLength(1);
      expect(config.chains[0].name).toBe('Ethereum');
      expect(config.commissionBps).toBe(250);
      expect(config.storefrontId).toBe(STOREFRONT_ID);
      expect(config.contractAbiVersion).toBe('V3.2');
    });

    it('calls the correct endpoint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(defaultPayload())), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );

      await client.fetchPaymentConfig();

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/api/storefronts/${STOREFRONT_ID}/payment-config`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws Web3SettleApiError on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(client.fetchPaymentConfig()).rejects.toThrow(Web3SettleApiError);
    });

    it('includes HTTP status code in error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      try {
        await client.fetchPaymentConfig();
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Web3SettleApiError);
        expect((e as Web3SettleApiError).statusCode).toBe(404);
      }
    });

    it('throws Web3SettleApiError on invalid envelope schema', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: 'data' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(client.fetchPaymentConfig()).rejects.toThrow(Web3SettleApiError);
    });

    it('throws Web3SettleApiError on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));

      await expect(client.fetchPaymentConfig()).rejects.toThrow(Web3SettleApiError);
    });

    it('strips trailing slashes from base URL', async () => {
      const clientWithSlash = new Web3SettleApiClient('https://api.web3settle.com/', STOREFRONT_ID);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(defaultPayload())), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );

      await clientWithSlash.fetchPaymentConfig();

      const calledUrl = (fetchSpy.mock.calls[0] as [string])[0];
      expect(calledUrl).not.toContain('//api/');
    });

    // Premortem F2 / Phase 2: signature provenance.
    it('rejects a payload whose signature does not verify', async () => {
      // Sign with a *different* key than the SDK's baked-in pubkey.
      const otherPriv = ed25519.utils.randomPrivateKey();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(defaultPayload(), { signWith: otherPriv })), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.fetchPaymentConfig()).rejects.toThrow(/signature/);
    });

    it('rejects when the data is tampered after signing', async () => {
      const env = signEnvelope(defaultPayload());
      // Attacker swaps contract address on the wire — same shape, same
      // signature, mismatched canonical encoding.
      const tampered = {
        ...env,
        data: { ...defaultPayload(), chains: [{
          chainId: 1, name: 'Ethereum',
          contractAddress: '0xATTACKERATTACKERATTACKERATTACKERATTACKER',
          tokens: [], explorerUrl: 'https://etherscan.io',
        }] },
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(tampered), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.fetchPaymentConfig()).rejects.toThrow();
    });

    // Phase 3: contract-allowlist enforcement.
    it('rejects a contract address that is neither baked-in nor explicitly elevated', async () => {
      const payload = defaultPayload({
        chains: [{
          chainId: 1, name: 'Ethereum',
          contractAddress: '0xfeedfacefeedfacefeedfacefeedfacefeedface',
          tokens: [], explorerUrl: 'https://etherscan.io',
        }],
        // The signed payload does NOT elevate this new address.
        allowedContractAddresses: {},
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(payload)), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.fetchPaymentConfig()).rejects.toThrow(/allowlist/);
    });

    // Phase 7: ABI version handshake.
    it('rejects a payload whose contractAbiVersion is not in SUPPORTED_ABI_VERSIONS', async () => {
      const payload = defaultPayload({ contractAbiVersion: 'V99.0' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(signEnvelope(payload)), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.fetchPaymentConfig()).rejects.toThrow(/Unsupported contractAbiVersion/);
    });
  });

  describe('createTopUpSession', () => {
    it('creates a session successfully', async () => {
      const sessionId = '660e8400-e29b-41d4-a716-446655440000';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await client.createTopUpSession('user-1', 25.0, 'idempotency-key-1');

      expect(result.sessionId).toBe(sessionId);
    });

    it('sends correct POST body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sessionId: '660e8400-e29b-41d4-a716-446655440000' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await client.createTopUpSession('user-123', 50.0, 'key-abc');

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        userId: string;
        amount: number;
        idempotencyKey: string;
      };
      expect(body).toEqual({ userId: 'user-123', amount: 50.0, idempotencyKey: 'key-abc' });
      expect(options.method).toBe('POST');
    });
  });

  describe('getSessionStatus', () => {
    it('fetches session status successfully', async () => {
      const sessionId = '660e8400-e29b-41d4-a716-446655440000';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: sessionId,
            amount: 25.0,
            status: 'confirmed',
            txHash: '0xabc123',
            chain: 'Ethereum',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const session = await client.getSessionStatus(sessionId);

      expect(session.id).toBe(sessionId);
      expect(session.status).toBe('confirmed');
      expect(session.txHash).toBe('0xabc123');
    });
  });
});
