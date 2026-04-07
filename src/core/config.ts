import type { ChainConfig } from './types';

// ── Smart Contract ABIs ──────────────────────────────────────────────────────

export const PAYMENT_CONTRACT_ABI = [
  {
    inputs: [],
    name: 'payInNative',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'payInToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ── Default Chain Configurations ─────────────────────────────────────────────

export const DEFAULT_CHAINS: Record<number, Omit<ChainConfig, 'contractAddress'>> = {
  1: {
    chainId: 1,
    name: 'Ethereum',
    tokens: [
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6,
      },
    ],
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    confirmations: 12,
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    tokens: [
      {
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        symbol: 'USDC',
        decimals: 6,
      },
      {
        address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        symbol: 'USDT',
        decimals: 6,
      },
    ],
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    confirmations: 30,
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    tokens: [
      {
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        symbol: 'USDC',
        decimals: 6,
      },
    ],
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    confirmations: 12,
  },
};

// ── Chain Icon Mapping ───────────────────────────────────────────────────────

export const CHAIN_ICONS: Record<number, string> = {
  1: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  137: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  8453: 'https://assets.coingecko.com/asset_platforms/images/131/small/base.jpeg',
};

// ── CoinGecko ID Mapping ────────────────────────────────────────────────────

export const COINGECKO_CHAIN_IDS: Record<number, string> = {
  1: 'ethereum',
  137: 'matic-network',
  8453: 'ethereum', // Base uses ETH as native
};

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION_POLL_INTERVAL_MS = 3000;
export const MAX_POLL_ATTEMPTS = 60;
export const PRICE_CACHE_TTL_MS = 60_000;
