import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http, type CreateConnectorFn } from 'wagmi';
import { mainnet, polygon, base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Web3SettleConfig } from '../core/types';
import { Web3SettleApiClient } from '../core/api-client';

// ── SDK Context ──────────────────────────────────────────────────────────────

export interface Web3SettleContextValue {
  config: Web3SettleConfig;
  apiClient: Web3SettleApiClient;
}

const Web3SettleContext = createContext<Web3SettleContextValue | null>(null);

export function useWeb3SettleContext(): Web3SettleContextValue {
  const ctx = useContext(Web3SettleContext);
  if (!ctx) {
    throw new Error(
      'useWeb3SettleContext must be used within a <Web3SettleProvider>. ' +
        'Wrap your component tree with <Web3SettleProvider config={...}>.',
    );
  }
  return ctx;
}

// ── Provider Props ───────────────────────────────────────────────────────────

interface Web3SettleProviderProps {
  config: Web3SettleConfig;
  children: ReactNode;
  /** Optional WalletConnect project ID for WalletConnect v2. */
  walletConnectProjectId?: string;
  /** Provide your own QueryClient if you already have one in your app. */
  queryClient?: QueryClient;
}

// ── Provider Component ───────────────────────────────────────────────────────

export function Web3SettleProvider({
  config,
  children,
  walletConnectProjectId,
  queryClient: externalQueryClient,
}: Web3SettleProviderProps) {
  const queryClient = useMemo(
    () =>
      externalQueryClient ??
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 2,
          },
        },
      }),
    [externalQueryClient],
  );

  const wagmiConfig = useMemo(() => {
    const connectors: CreateConnectorFn[] = [injected()];
    if (walletConnectProjectId) {
      connectors.push(
        walletConnect({ projectId: walletConnectProjectId }) as CreateConnectorFn,
      );
    }

    return createConfig({
      chains: [mainnet, polygon, base],
      connectors,
      transports: {
        [mainnet.id]: http(),
        [polygon.id]: http(),
        [base.id]: http(),
      },
    });
  }, [walletConnectProjectId]);

  const apiClient = useMemo(
    () => new Web3SettleApiClient(config.apiBaseUrl, config.storefrontId),
    [config.apiBaseUrl, config.storefrontId],
  );

  const contextValue = useMemo<Web3SettleContextValue>(
    () => ({ config, apiClient }),
    [config, apiClient],
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Web3SettleContext.Provider value={contextValue}>
          {children}
        </Web3SettleContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
