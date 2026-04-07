import { useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';

interface UseWalletReturn {
  /** Connected wallet address, or undefined if not connected. */
  address: `0x${string}` | undefined;
  /** Whether a wallet is currently connected. */
  isConnected: boolean;
  /** Whether a connection attempt is in progress. */
  isConnecting: boolean;
  /** Whether the wallet is reconnecting from a previous session. */
  isReconnecting: boolean;
  /** Current chain ID the wallet is connected to. */
  chainId: number | undefined;
  /** Native token balance (formatted string), or null if unavailable. */
  balance: string | null;
  /** Native token symbol, or null if unavailable. */
  balanceSymbol: string | null;
  /** Available wallet connectors. */
  connectors: ReturnType<typeof useConnect>['connectors'];
  /** Connect with a specific connector. */
  connect: ReturnType<typeof useConnect>['connect'];
  /** Disconnect the current wallet. */
  disconnect: ReturnType<typeof useDisconnect>['disconnect'];
  /** Connection error, if any. */
  error: Error | null;
  /** Truncated address for display (e.g., "0x1234...abcd"). */
  displayAddress: string | null;
}

/**
 * Unified wallet hook wrapping wagmi's account, connect, and disconnect hooks
 * with SDK-specific convenience fields.
 */
export function useWallet(): UseWalletReturn {
  const { address, isConnected, isConnecting, isReconnecting, chainId } = useAccount();
  const { connectors, connect, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });

  const displayAddress = useMemo(() => {
    if (!address) return null;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);

  const balance = balanceData ? balanceData.formatted : null;
  const balanceSymbol = balanceData ? balanceData.symbol : null;

  return {
    address,
    isConnected,
    isConnecting,
    isReconnecting,
    chainId,
    balance,
    balanceSymbol,
    connectors,
    connect,
    disconnect,
    error: connectError ?? null,
    displayAddress,
  };
}
