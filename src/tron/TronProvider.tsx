import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Web3SettleConfig } from '../core/types';
import { Web3SettleApiClient } from '../core/api-client';
import { TronPaymentPipeline } from './pipeline';
import { getTronWeb, isTronWebReady, requestTronAccounts, type TronWebLike } from './tronweb-global';

export interface TronWalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export interface TronWeb3SettleContextValue {
  config: Web3SettleConfig;
  apiClient: Web3SettleApiClient;
  pipeline: TronPaymentPipeline;
  wallet: TronWalletState;
  /** TronWeb instance — populated after the user connects. */
  tronWeb: TronWebLike | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const TronWeb3SettleContext = createContext<TronWeb3SettleContextValue | null>(null);

export function useTronWeb3SettleContext(): TronWeb3SettleContextValue {
  const ctx = useContext(TronWeb3SettleContext);
  if (!ctx) {
    throw new Error(
      'useTronWeb3SettleContext must be used within a <TronWeb3SettleProvider>.',
    );
  }
  return ctx;
}

/** Convenience hook returning the TRON pipeline. */
export function useTronPipeline(): TronPaymentPipeline {
  return useTronWeb3SettleContext().pipeline;
}

interface TronWeb3SettleProviderProps {
  config: Web3SettleConfig;
  children: ReactNode;
  queryClient?: QueryClient;
  /** Override the fee-limit ceiling (in sun). Default: 100 TRX = 100_000_000 sun. */
  feeLimitSun?: number;
}

/**
 * Root provider for the TRON subpath. Detects TronLink at mount time, listens
 * for address-change / lock events, and exposes a `connect()` / `disconnect()`
 * pair plus a ready-to-use `TronPaymentPipeline`.
 */
export function TronWeb3SettleProvider({
  config,
  children,
  queryClient: externalQueryClient,
  feeLimitSun,
}: TronWeb3SettleProviderProps) {
  const queryClient = useMemo(
    () =>
      externalQueryClient ??
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
      }),
    [externalQueryClient],
  );

  const pipeline = useMemo(() => {
    const p = new TronPaymentPipeline();
    if (feeLimitSun !== undefined) p.feeLimit = feeLimitSun;
    return p;
  }, [feeLimitSun]);

  const apiClient = useMemo(
    () => new Web3SettleApiClient(config.apiBaseUrl, config.storefrontId),
    [config.apiBaseUrl, config.storefrontId],
  );

  const [wallet, setWallet] = useState<TronWalletState>({
    address: null,
    connected: false,
    connecting: false,
    error: null,
  });
  const [tronWeb, setTronWeb] = useState<TronWebLike | null>(null);

  // Bootstrap: if TronLink is already unlocked on mount, pick up the address.
  useEffect(() => {
    if (!isTronWebReady()) return;
    const tw = getTronWeb();
    if (!tw) return;
    const addr = typeof tw.defaultAddress.base58 === 'string' ? tw.defaultAddress.base58 : null;
    setTronWeb(tw);
    setWallet({
      address: addr,
      connected: Boolean(addr),
      connecting: false,
      error: null,
    });
  }, []);

  // Listen for TronLink's `message` events to detect address changes + lock.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'object' || e.data === null) return;
      const msg = e.data as { message?: { action?: string; data?: { address?: string } } };
      const action = msg.message?.action;
      if (action === 'setAccount' || action === 'accountsChanged') {
        const newAddr = msg.message?.data?.address ?? null;
        setWallet((prev) => ({ ...prev, address: newAddr, connected: Boolean(newAddr) }));
        setTronWeb(getTronWeb());
      } else if (action === 'disconnect' || action === 'tabReply') {
        const tw = getTronWeb();
        if (!tw || typeof tw.defaultAddress.base58 !== 'string') {
          setWallet({ address: null, connected: false, connecting: false, error: null });
          setTronWeb(null);
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('message', handler);
      return () => { window.removeEventListener('message', handler); };
    }
    return undefined;
  }, []);

  const connect = useCallback(async () => {
    setWallet((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const addr = await requestTronAccounts();
      setTronWeb(getTronWeb());
      setWallet({ address: addr, connected: true, connecting: false, error: null });
    } catch (err) {
      setWallet({
        address: null,
        connected: false,
        connecting: false,
        error: err instanceof Error ? err.message : 'Failed to connect',
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    // TronLink doesn't expose a programmatic disconnect — the user revokes
    // via the extension. We clear local state so the UI reflects "unconnected".
    setWallet({ address: null, connected: false, connecting: false, error: null });
    setTronWeb(null);
  }, []);

  const value = useMemo<TronWeb3SettleContextValue>(
    () => ({ config, apiClient, pipeline, wallet, tronWeb, connect, disconnect }),
    [config, apiClient, pipeline, wallet, tronWeb, connect, disconnect],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TronWeb3SettleContext.Provider value={value}>
        {children}
      </TronWeb3SettleContext.Provider>
    </QueryClientProvider>
  );
}
