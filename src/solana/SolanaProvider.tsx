import { createContext, useContext, useMemo, type FC, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Connection} from '@solana/web3.js';
import { clusterApiUrl } from '@solana/web3.js';
import {
  ConnectionProvider as RawConnectionProvider,
  WalletProvider as RawWalletProvider,
  useWallet,
  useConnection,
} from '@solana/wallet-adapter-react';
import type { Adapter } from '@solana/wallet-adapter-base';
import type { Web3SettleConfig } from '../core/types';
import { Web3SettleApiClient } from '../core/api-client';
import type { SolanaPipelineConfig } from './pipeline';
import { SolanaPaymentPipeline } from './pipeline';

// `@solana/wallet-adapter-react` ships React types from a pinned `@types/react`
// version that predates React 19's `ReactNode` broadening (which added
// `bigint | Promise<ReactNode>`). The casts below narrow the signature back to
// what both type trees agree on — behaviour is identical, only the compile-
// time shape differs.
const ConnectionProvider = RawConnectionProvider as unknown as FC<{ endpoint: string; children: ReactNode }>;
const WalletProvider = RawWalletProvider as unknown as FC<{
  wallets: Adapter[];
  autoConnect?: boolean;
  children: ReactNode;
}>;

export interface SolanaWeb3SettleContextValue {
  config: Web3SettleConfig;
  apiClient: Web3SettleApiClient;
  solana: SolanaPipelineConfig;
  /** Build a pipeline bound to the currently-connected wallet. */
  getPipeline: (wallet: ReturnType<typeof useWallet>, connection: Connection) => SolanaPaymentPipeline;
}

const SolanaWeb3SettleContext = createContext<SolanaWeb3SettleContextValue | null>(null);

export function useSolanaWeb3SettleContext(): SolanaWeb3SettleContextValue {
  const ctx = useContext(SolanaWeb3SettleContext);
  if (!ctx) {
    throw new Error(
      'useSolanaWeb3SettleContext must be used within a <SolanaWeb3SettleProvider>.',
    );
  }
  return ctx;
}

/** Convenience hook returning a pipeline bound to the current wallet + RPC. */
export function useSolanaPipeline(): SolanaPaymentPipeline {
  const ctx = useSolanaWeb3SettleContext();
  const wallet = useWallet();
  const { connection } = useConnection();
  return useMemo(
    () => ctx.getPipeline(wallet, connection),
    [ctx, wallet, connection],
  );
}

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet';

interface SolanaWeb3SettleProviderProps {
  config: Web3SettleConfig;
  /** Solana-specific config (program ID + merchant ID). */
  solana: SolanaPipelineConfig;
  /** Explicit RPC endpoint. Overrides `cluster` if set. */
  rpcEndpoint?: string;
  /** Cluster to use when `rpcEndpoint` isn't provided. Default: `mainnet-beta`. */
  cluster?: SolanaCluster;
  /** Wallet adapters to expose (Phantom, Solflare, Backpack, …). */
  wallets?: Adapter[];
  /** Auto-connect the most-recently-used wallet. Default: true. */
  autoConnect?: boolean;
  children: ReactNode;
  queryClient?: QueryClient;
}

/**
 * Root provider for the Solana subpath. Wraps the Solana wallet-adapter stack
 * and exposes the same context shape as the EVM `Web3SettleProvider` — use
 * `useSolanaPipeline()` to drive payments, or drop `<SolanaPayButton>` /
 * `<SolanaTopUpModal>` anywhere inside.
 */
export function SolanaWeb3SettleProvider({
  config,
  solana,
  rpcEndpoint,
  cluster = 'mainnet-beta',
  wallets = [],
  autoConnect = true,
  children,
  queryClient: externalQueryClient,
}: SolanaWeb3SettleProviderProps) {
  const queryClient = useMemo(
    () =>
      externalQueryClient ??
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
      }),
    [externalQueryClient],
  );

  const endpoint = useMemo(
    () => rpcEndpoint ?? clusterApiUrl(cluster),
    [rpcEndpoint, cluster],
  );

  const apiClient = useMemo(
    () => new Web3SettleApiClient(config.apiBaseUrl, config.storefrontId),
    [config.apiBaseUrl, config.storefrontId],
  );

  const value = useMemo<SolanaWeb3SettleContextValue>(
    () => ({
      config,
      apiClient,
      solana,
      getPipeline: (wallet, connection) =>
        new SolanaPaymentPipeline(connection, wallet, solana),
    }),
    [config, apiClient, solana],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect={autoConnect}>
          <SolanaWeb3SettleContext.Provider value={value}>
            {children}
          </SolanaWeb3SettleContext.Provider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
