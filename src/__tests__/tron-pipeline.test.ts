import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TronPaymentPipeline } from '../tron/pipeline';
import { PaymentPipelineError } from '../core/pipeline';
import { NATIVE_TOKEN_SENTINEL, type ChainConfig } from '../core/types';

const VALID_T_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const VALID_USDT_ADDR = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

const chain: ChainConfig = {
  chainId: 728126428, // mainnet
  name: 'Tron',
  contractAddress: VALID_T_ADDR,
  tokens: [
    {
      address: VALID_USDT_ADDR,
      symbol: 'USDT',
      decimals: 6,
    },
  ],
  explorerUrl: 'https://tronscan.org',
  nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
};

describe('TronPaymentPipeline', () => {
  let pipeline: TronPaymentPipeline;

  beforeEach(() => {
    pipeline = new TronPaymentPipeline();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window: unknown }).window;
  });

  describe('tronWeb detection', () => {
    it('throws when window is not defined (SSR / no browser)', async () => {
      await expect(pipeline.execute(chain, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toBeInstanceOf(
        PaymentPipelineError,
      );
    });

    it('throws when tronWeb is missing even if window exists', async () => {
      (globalThis as unknown as { window: object }).window = {};
      await expect(pipeline.execute(chain, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toThrow(
        /not available/,
      );
    });

    it('throws a user-rejected error when tronWeb exists but the account is locked', async () => {
      (globalThis as unknown as { window: { tronWeb: object } }).window = {
        tronWeb: {
          defaultAddress: { base58: false, hex: false },
          ready: false,
          contract: () => ({ at: vi.fn() }),
          trx: { getConfirmedTransaction: vi.fn() },
          toSun: vi.fn(),
          address: { toHex: vi.fn(), fromHex: vi.fn() },
        },
      };
      await expect(pipeline.execute(chain, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toMatchObject({
        kind: 'user-rejected',
      });
    });
  });

  describe('address validation', () => {
    beforeEach(() => {
      (globalThis as unknown as { window: { tronWeb: object } }).window = {
        tronWeb: {
          defaultAddress: { base58: VALID_T_ADDR, hex: '0x41' + '00'.repeat(20) },
          ready: true,
          contract: () => ({ at: vi.fn().mockResolvedValue({}) }),
          trx: { getConfirmedTransaction: vi.fn() },
          toSun: vi.fn(),
          address: { toHex: vi.fn(), fromHex: vi.fn() },
        },
      };
    });

    it('rejects a non-T-address contract', async () => {
      const bad: ChainConfig = { ...chain, contractAddress: '0x1234567890abcdef1234567890abcdef12345678' };
      await expect(pipeline.execute(bad, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toThrow(
        /Invalid TRON/,
      );
    });

    it('rejects a short contract address', async () => {
      const bad: ChainConfig = { ...chain, contractAddress: 'TabCd' };
      await expect(pipeline.execute(bad, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toThrow(
        /Invalid TRON/,
      );
    });
  });

  describe('family marker', () => {
    it('identifies itself as "tron"', () => {
      expect(pipeline.family).toBe('tron');
    });
  });

  describe('needsApproval', () => {
    it('returns false for native TRX without touching the network', async () => {
      // No window.tronWeb stub on purpose — native path must not hit the chain.
      await expect(pipeline.needsApproval(chain, NATIVE_TOKEN_SENTINEL, 1n)).resolves.toBe(false);
    });
  });

  describe('approve', () => {
    it('refuses to run for native TRX', async () => {
      await expect(pipeline.approve(chain, NATIVE_TOKEN_SENTINEL, 1n)).rejects.toThrow(
        /no approval/i,
      );
    });
  });
});
