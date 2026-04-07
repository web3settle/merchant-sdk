import { z } from 'zod';

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const TokenConfigSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid ERC-20 address'),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(18),
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  iconUrl: z.string().url().optional(),
});

export const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  tokens: z.array(TokenConfigSchema),
  explorerUrl: z.string().url(),
  rpcUrl: z.string().url().optional(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int(),
  }).optional(),
  iconUrl: z.string().url().optional(),
  confirmations: z.number().int().positive().optional(),
});

export const PaymentConfigSchema = z.object({
  chains: z.array(ChainConfigSchema).min(1),
  commissionBps: z.number().int().min(0).max(10000),
  storefrontId: z.string().uuid(),
});

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
  onSuccess: z.function().args(z.any()).returns(z.void()).optional(),
  onError: z.function().args(z.any()).returns(z.void()).optional(),
});

// ── TypeScript Types ─────────────────────────────────────────────────────────

export type TokenConfig = z.infer<typeof TokenConfigSchema>;
export type ChainConfig = z.infer<typeof ChainConfigSchema>;
export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;
export type PaymentSession = z.infer<typeof PaymentSessionSchema>;
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export interface Web3SettleConfig {
  /** API base URL. */
  apiBaseUrl: string;
  storefrontId: string;
  theme?: 'dark' | 'light';
  onSuccess?: (session: PaymentSession) => void;
  onError?: (error: Error) => void;
}

// ── Payment Status ───────────────────────────────────────────────────────────

export enum PaymentStatus {
  Idle = 'idle',
  Connecting = 'connecting',
  Approving = 'approving',
  Sending = 'sending',
  Confirming = 'confirming',
  Success = 'success',
  Error = 'error',
}

// ── Component Props ──────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

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
  onSelect: (tokenAddress: string | 'native') => void;
  walletAddress?: string;
  chainId?: number;
}

export interface TransactionStatusProps {
  status: PaymentStatus;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface WalletConnectProps {
  onConnected?: (address: string) => void;
}

// ── API Error ────────────────────────────────────────────────────────────────

export class Web3SettleApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'Web3SettleApiError';
  }
}
