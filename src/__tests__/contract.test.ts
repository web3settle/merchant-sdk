import { describe, it, expect } from 'vitest';
import { parseTokenAmount } from '../core/contract';

describe('parseTokenAmount', () => {
  it('parses integer USDC amount with 6 decimals', () => {
    expect(parseTokenAmount(1, 6)).toBe(1_000_000n);
  });

  it('parses fractional ETH amount with 18 decimals', () => {
    expect(parseTokenAmount('0.5', 18)).toBe(500_000_000_000_000_000n);
  });

  it('parses zero', () => {
    expect(parseTokenAmount(0, 18)).toBe(0n);
  });

  it('coerces number-to-string safely', () => {
    expect(parseTokenAmount(2.5, 6)).toBe(2_500_000n);
  });

  it('rounds excess fractional digits per viem semantics', () => {
    expect(parseTokenAmount('1.23456789', 6)).toBe(1_234_568n);
  });
});
