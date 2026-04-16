import { describe, it, expect } from 'vitest';
import { Web3SettleApiClient } from '../core/api-client';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Web3SettleApiClient construction', () => {
  it('accepts a valid UUID storefrontId', () => {
    expect(() => new Web3SettleApiClient('https://api.web3settle.com', VALID_UUID)).not.toThrow();
  });

  it('rejects a non-UUID storefrontId', () => {
    expect(() => new Web3SettleApiClient('https://api.web3settle.com', 'not-a-uuid')).toThrow(
      /Invalid storefrontId/,
    );
  });

  it('rejects an empty storefrontId', () => {
    expect(() => new Web3SettleApiClient('https://api.web3settle.com', '')).toThrow();
  });

  it('rejects an invalid base URL', () => {
    expect(() => new Web3SettleApiClient('not a url', VALID_UUID)).toThrow();
  });

  it('getSessionStatus rejects a non-UUID sessionId', async () => {
    const client = new Web3SettleApiClient('https://api.web3settle.com', VALID_UUID);
    await expect(client.getSessionStatus('not-a-uuid')).rejects.toThrow(/Invalid sessionId/);
  });
});
