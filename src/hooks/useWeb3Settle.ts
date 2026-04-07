import { useState, useEffect } from 'react';
import { useWeb3SettleContext } from '../components/Web3SettleProvider';
import type { PaymentConfig } from '../core/types';

interface UseWeb3SettleReturn {
  config: ReturnType<typeof useWeb3SettleContext>['config'];
  paymentConfig: PaymentConfig | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Primary hook for accessing Web3Settle SDK configuration.
 * Fetches payment config (supported chains, tokens, commission) on mount.
 */
export function useWeb3Settle(): UseWeb3SettleReturn {
  const { config, apiClient } = useWeb3SettleContext();
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchConfig() {
      setIsLoading(true);
      setError(null);

      try {
        const cfg = await apiClient.fetchPaymentConfig(controller.signal);
        if (!cancelled) {
          setPaymentConfig(cfg);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          setError(err instanceof Error ? err.message : 'Failed to load payment configuration');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchConfig();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiClient, fetchKey]);

  const refetch = () => setFetchKey((k) => k + 1);

  return { config, paymentConfig, isLoading, error, refetch };
}
