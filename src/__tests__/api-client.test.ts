import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Web3SettleApiClient } from '../core/api-client';
import { Web3SettleApiError } from '../core/types';

const BASE_URL = 'https://api.web3settle.com';
const STOREFRONT_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('Web3SettleApiClient', () => {
  let client: Web3SettleApiClient;

  beforeEach(() => {
    client = new Web3SettleApiClient(BASE_URL, STOREFRONT_ID);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchPaymentConfig', () => {
    it('fetches and validates payment config successfully', async () => {
      const mockResponse = {
        chains: [
          {
            chainId: 1,
            name: 'Ethereum',
            contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
            tokens: [
              {
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                decimals: 6,
              },
            ],
            explorerUrl: 'https://etherscan.io',
          },
        ],
        commissionBps: 250,
        storefrontId: STOREFRONT_ID,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const config = await client.fetchPaymentConfig();

      expect(config.chains).toHaveLength(1);
      expect(config.chains[0].name).toBe('Ethereum');
      expect(config.commissionBps).toBe(250);
      expect(config.storefrontId).toBe(STOREFRONT_ID);
    });

    it('calls the correct endpoint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chains: [
              {
                chainId: 1,
                name: 'Ethereum',
                contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
                tokens: [],
                explorerUrl: 'https://etherscan.io',
              },
            ],
            commissionBps: 0,
            storefrontId: STOREFRONT_ID,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
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

    it('throws Web3SettleApiError on invalid response schema', async () => {
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
        new Response(
          JSON.stringify({
            chains: [
              {
                chainId: 1,
                name: 'Ethereum',
                contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
                tokens: [],
                explorerUrl: 'https://etherscan.io',
              },
            ],
            commissionBps: 0,
            storefrontId: STOREFRONT_ID,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await clientWithSlash.fetchPaymentConfig();

      const calledUrl = (fetchSpy.mock.calls[0] as [string])[0];
      expect(calledUrl).not.toContain('//api/');
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
      const body = JSON.parse(options.body as string);
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
