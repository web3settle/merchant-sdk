import { z } from 'zod';
import type { TelemetryCallback } from './telemetry';

// Accept EVM hex (0x + 40 hex), Solana base58 (32–44 chars), and TRON base58 (T + 33 chars).
// Per-pipeline validators in src/solana/ and src/tron/ tighten this at construction time.
const CROSS_CHAIN_ADDRESS_REGEX = /^(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export const TokenConfigSchema = z.object({
  // Allow EVM, Solana mint (base58), or TRON T-address. Per-pipeline modules
  // re-validate tightly at call time.
  address: z.string().regex(CROSS_CHAIN_ADDRESS_REGEX, 'Invalid token address'),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(18),
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  iconUrl: z.string().url().optional(),
});

export const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  contractAddress: z.string().regex(CROSS_CHAIN_ADDRESS_REGEX, 'Invalid contract address'),
  tokens: z.array(TokenConfigSchema),
  explorerUrl: z.string().url(),
  rpcUrl: z.string().url().optional(),
  nativeCurrency: z
    .object({
      name: z.string(),
      symbol: z.string(),
      decimals: z.number().int(),
    })
    .optional(),
  iconUrl: z.string().url().optional(),
  confirmations: z.number().int().positive().optional(),
});

export const PaymentConfigSchema = z.object({
  chains: z.array(ChainConfigSchema).min(1),
  commissionBps: z.number().int().min(0).max(10_000),
  storefrontId: z.string().uuid(),
  /**
   * Contract ABI revision the backend currently serves. The SDK rejects
   * payloads whose version is not in `SUPPORTED_ABI_VERSIONS` (fail closed).
   * Defaults to the lowest supported revision when the backend hasn't
   * populated the field yet (transition window).
   */
  contractAbiVersion: z.string().min(1).default('V3.1'),
  /**
   * Per-chain explicit contract-address allowlist. Map key is chainId as
   * string; value is the lowercased addresses the SDK should accept for that
   * chain even when the address is not in the SDK's baked-in
   * KNOWN_CONTRACT_ADDRESSES set.
   */
  allowedContractAddresses: z.record(z.string(), z.array(z.string())).default({}),
});

/**
 * Wrapper schema — the wire shape of `GET /api/storefronts/{id}/payment-config`
 * since the F2 hardening. The SDK Zod-validates the wrapper, then verifies
 * `signature` against `signed_at + canonical_json(data)` before unwrapping.
 */
export const SignedPaymentConfigEnvelopeSchema = z.object({
  data: PaymentConfigSchema,
  signedAt: z.string(),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/, 'expected 128-char hex Ed25519 signature'),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
});

// Server-issued USD→token quote returned by GET /api/storefronts/{id}/quote. The SDK uses
// `amountToken` (atomic, as a string for big numbers) verbatim when building the payInToken /
// payInNative call so the user signs exactly what they were quoted. Slippage between quote and
// confirmation is the merchant's concern — they reconcile USD value at webhook time.
export const QuoteResponseSchema = z.object({
  storefrontId: z.string().uuid(),
  network: z.string().min(1),
  token: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenDecimals: z.number().int().min(0).max(30),
  amountUsd: z.number().or(z.string()).transform((v) => Number(v)),
  amountToken: z.string().min(1),
  amountTokenDisplay: z.number().or(z.string()).transform((v) => Number(v)),
  priceUsd: z.number().or(z.string()).transform((v) => Number(v)),
  source: z.string().min(1),
  feedAddress: z.string().min(1),
  roundId: z.number().or(z.string()),
  observedAt: z.string(),
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const PaymentSessionSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().positive(),
  status: z.enum(['pending', 'processing', 'confirming', 'confirmed', 'failed', 'expired']),
  txHash: z.string().optional(),
  chain: z.string().optional(),
  token: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
});

export const Web3SettleConfigSchema = z.object({
  apiBaseUrl: z.string().url(),
  storefrontId: z.string().uuid(),
  theme: z.enum(['dark', 'light']).optional().default('dark'),
});

export type TokenConfig = z.infer<typeof TokenConfigSchema>;
export type ChainConfig = z.infer<typeof ChainConfigSchema>;
export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;
export type PaymentSession = z.infer<typeof PaymentSessionSchema>;
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export interface Web3SettleConfig {
  apiBaseUrl: string;
  storefrontId: string;
  theme?: 'dark' | 'light';
  onSuccess?: (session: PaymentSession) => void;
  onError?: (error: Error) => void;
  /**
   * Optional opt-in failure breadcrumb. When the SDK catches a payment
   * failure on EVM, Solana, or TRON, it builds a sanitized
   * {@link TelemetryEvent} (no addresses except hashed; no amounts) and
   * passes it to this callback. Throwing is caught and ignored — telemetry
   * never blocks the user-facing flow. See `core/telemetry.ts` for the
   * privacy contract.
   */
  onTelemetry?: TelemetryCallback;
  /**
   * Optional contract version string, surfaced in telemetry events so the
   * merchant can spot regressions caused by a contract upgrade.
   */
  contractVersion?: string;
  /**
   * EIP-2612 permit policy passed through to the EVM payment hook. See
   * {@link signPermit} — `'auto'` is the default behaviour and falls back
   * gracefully on tokens whose EIP-712 domain is not on the SDK's allowlist.
   */
  permit?: 'auto' | 'never' | 'require';
}

export enum PaymentStatus {
  Idle = 'idle',
  Connecting = 'connecting',
  Approving = 'approving',
  Sending = 'sending',
  Confirming = 'confirming',
  Success = 'success',
  Error = 'error',
}

export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const NATIVE_TOKEN_SENTINEL = 'native' as const;
// `string & {}` keeps the literal `"native"` as an editor suggestion while still accepting any
// address string at runtime. The intersection prevents TS from collapsing the union.
export type TokenSelection = typeof NATIVE_TOKEN_SENTINEL | (string & Record<never, never>);

export interface PayButtonProps {
  amount: number;
  label?: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}

export interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount?: number;
  userId?: string;
}

export interface ChainSelectorProps {
  chains: ChainConfig[];
  selectedChainId: number | null;
  onSelect: (chainId: number) => void;
}

export interface TokenSelectorProps {
  tokens: TokenConfig[];
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  selectedToken: string | null;
  onSelect: (tokenAddress: TokenSelection) => void;
  walletAddress?: string;
  chainId?: number;
}

export interface TransactionStatusProps {
  status: PaymentStatus;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  /**
   * Optional Segment 2.2 inputs — when supplied, the component renders an
   * "X of N confirmations" label (or commitment-level state for Solana)
   * during {@link PaymentStatus.Confirming}. Both must be set for the label
   * to render — supplying only one is a no-op.
   *
   * The component never imports a chain SDK to read `currentConfirmations`;
   * it accepts the value as a prop so the caller (which already has the
   * `publicClient` / `connection`) drives the polling loop.
   */
  chainId?: number;
  /** Best-effort current confirmation depth (for EVM/TRON) or commitment
   *  rank (0 pending, 1 confirmed, 2 finalized) for Solana. */
  currentConfirmations?: number;
}

export interface WalletConnectProps {
  onConnected?: (address: string) => void;
}

export class Web3SettleApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: unknown;

  constructor(message: string, statusCode: number, responseBody?: unknown) {
    super(message);
    this.name = 'Web3SettleApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
