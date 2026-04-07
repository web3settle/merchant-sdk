import { describe, it, expect } from 'vitest';
import {
  TokenConfigSchema,
  ChainConfigSchema,
  PaymentConfigSchema,
  PaymentSessionSchema,
  CreateSessionResponseSchema,
} from '../core/types';

describe('TokenConfigSchema', () => {
  it('accepts a valid ERC-20 token config', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional minAmount and maxAmount', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
      minAmount: 1,
      maxAmount: 10000,
      iconUrl: 'https://example.com/usdc.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid address', () => {
    const result = TokenConfigSchema.safeParse({
      address: 'not-an-address',
      symbol: 'USDC',
      decimals: 6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty symbol', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: '',
      decimals: 6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative decimals', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects decimals greater than 18', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 19,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative minAmount', () => {
    const result = TokenConfigSchema.safeParse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
      minAmount: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe('ChainConfigSchema', () => {
  const validChain = {
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
  };

  it('accepts a valid chain config', () => {
    const result = ChainConfigSchema.safeParse(validChain);
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = ChainConfigSchema.safeParse({
      ...validChain,
      rpcUrl: 'https://mainnet.infura.io/v3/abc',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      confirmations: 12,
      iconUrl: 'https://example.com/eth.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid chainId', () => {
    const result = ChainConfigSchema.safeParse({ ...validChain, chainId: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid contract address', () => {
    const result = ChainConfigSchema.safeParse({ ...validChain, contractAddress: '0xshort' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid explorer URL', () => {
    const result = ChainConfigSchema.safeParse({ ...validChain, explorerUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects zero confirmations', () => {
    const result = ChainConfigSchema.safeParse({ ...validChain, confirmations: 0 });
    expect(result.success).toBe(false);
  });
});

describe('PaymentConfigSchema', () => {
  const validPaymentConfig = {
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
    storefrontId: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('accepts a valid payment config', () => {
    const result = PaymentConfigSchema.safeParse(validPaymentConfig);
    expect(result.success).toBe(true);
  });

  it('rejects empty chains array', () => {
    const result = PaymentConfigSchema.safeParse({
      ...validPaymentConfig,
      chains: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects commission above 10000 bps', () => {
    const result = PaymentConfigSchema.safeParse({
      ...validPaymentConfig,
      commissionBps: 10001,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative commission', () => {
    const result = PaymentConfigSchema.safeParse({
      ...validPaymentConfig,
      commissionBps: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid storefront UUID', () => {
    const result = PaymentConfigSchema.safeParse({
      ...validPaymentConfig,
      storefrontId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('PaymentSessionSchema', () => {
  it('accepts a valid session', () => {
    const result = PaymentSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 25.0,
      status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid statuses', () => {
    const statuses = ['pending', 'processing', 'confirming', 'confirmed', 'failed', 'expired'];
    for (const s of statuses) {
      const result = PaymentSessionSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        amount: 10,
        status: s,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = PaymentSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 10,
      status: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = PaymentSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 0,
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional txHash and chain', () => {
    const result = PaymentSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 100,
      status: 'confirmed',
      txHash: '0xabc123',
      chain: 'Ethereum',
      token: 'USDC',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateSessionResponseSchema', () => {
  it('accepts a valid session ID', () => {
    const result = CreateSessionResponseSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID session ID', () => {
    const result = CreateSessionResponseSchema.safeParse({
      sessionId: 'abc123',
    });
    expect(result.success).toBe(false);
  });
});
