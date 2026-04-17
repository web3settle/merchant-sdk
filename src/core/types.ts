import { z } from 'zod';

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
