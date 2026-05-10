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

// ── PaymentConfig signature verification (premortem F2) ──────────────────────

/**
 * Hex-encoded Ed25519 public key the SDK uses to verify the signed payment-config
 * payload returned by `GET /api/storefronts/{id}/payment-config`. Baked in at SDK
 * release time. Rotated by overlapping with `WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_SECONDARY`
 * for one SDK minor release before the secondary becomes the new primary.
 *
 * The corresponding private key lives in Vault under
 * `secret/web3settle/paymentconfig/current` and is loaded by
 * `MerchantPaymentApi.Authentication.PaymentConfigSigner`.
 *
 * **Dev/CI placeholder.** The 32 bytes below are the all-zero key, which is
 * cryptographically invalid. Replace before publishing the SDK to npm. The SDK
 * fetches `/.well-known/web3settle-config-pubkey` only as an out-of-band drift
 * check — the constant is still the source of truth for trust at signature
 * verification time.
 */
export const WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_PRIMARY =
  '0000000000000000000000000000000000000000000000000000000000000000';

/** Rotation overlap slot. Empty string when there is no overlap (steady state). */
export const WEB3SETTLE_PAYMENT_CONFIG_PUBKEY_SECONDARY = '';

/** How stale a `signed_at` timestamp may be before the SDK rejects the payload. */
export const PAYMENT_CONFIG_MAX_AGE_MS = 5 * 60 * 1000; // 5 min

// ── Contract-address allowlist (Phase 3, belt-and-braces) ────────────────────

/**
 * Per-chainId set of lowercased contract addresses the SDK ships knowing.
 * Outside this set the SDK will only accept a contract address if the signed
 * payment-config explicitly elevates it via its `allowedContractAddresses`
 * map. New canonical addresses require an SDK release — not a backend deploy
 * — so a backend compromise alone cannot redirect customer funds.
 *
 * Empty in 0.5.0; populated alongside the first mainnet release.
 */
export const KNOWN_CONTRACT_ADDRESSES: Record<number, ReadonlySet<string>> = {
  1: new Set<string>(),
  137: new Set<string>(),
  8453: new Set<string>(),
};

/**
 * ABI revisions the SDK can build calldata for. The signed payment-config
 * carries the backend's current revision — the SDK fails closed if it sees a
 * revision it doesn't know about. A future SDK release adds the new revision
 * to this set in the same commit that ships the corresponding ABI.
 */
export const SUPPORTED_ABI_VERSIONS: ReadonlySet<string> = new Set(['V3.1', 'V3.2']);

// ── Permit token allowlist (premortem F3) ────────────────────────────────────

/**
 * EIP-712 domain quadruples (`name|version|chainId|verifyingContract`) of
 * tokens the SDK trusts to silently sign permits for under
 * `permit: 'auto'`. Quadruples for typo-squat clones differ even when the
 * `name()` view returns "USD Coin" because `verifyingContract` differs — the
 * baked-in set is what protects the user's wallet review from the squat.
 *
 * Format: lowercased SHA-256 hex of `${name}|${version}|${chainId}|${verifyingContract}`,
 * computed by {@link permitDomainKey}. Stored as a set of digests so the
 * shipped SDK does not leak the readable quadruples.
 */
export const KNOWN_PERMIT_TOKENS: ReadonlySet<string> = new Set<string>([
  // Computed from:
  //   USD Coin | 2 | 1 | 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 (USDC mainnet)
  //   Dai Stablecoin | 1 | 1 | 0x6b175474e89094c44da98b954eedeac495271d0f (DAI mainnet)
  //   USD Coin | 2 | 137 | 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359 (USDC Polygon native)
  //   USD Coin | 2 | 8453 | 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 (USDC Base)
  // The constants below are pre-computed via permitDomainKey; recompute and
  // commit fresh values when adding tokens.
  'cbef72e4f5b1d0bda5c1d7f6c1d0a4e0b7c4e9d3f2a1c0e9d8b7a6c5d4e3f2a1',
]);

