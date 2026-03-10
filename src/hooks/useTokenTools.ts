import { useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import type { Address } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { getProvider } from '../contractCache';
import { useOps } from '../contexts/OpsContext';

interface UseTokenToolsReturn {
  walletAddress: string | null;
  senderAddr: Address | null;
  openConnectModal: () => void;
  provider: JSONRpcProvider;
  trackOp: (data: {
    id: string; market: string; orderId: string; direction: string;
    role: string; step: string; amounts?: Record<string, unknown>;
    txIds?: Record<string, string>;
  }) => void;
  completeOp: (id: string) => void;
  failOp: (id: string, error: string) => void;
}

/**
 * Shared hook for TokenTools sub-components.
 * Provides wallet connection, provider and ops tracking
 * so each tool does not need to instantiate them independently.
 */
export function useTokenTools(): UseTokenToolsReturn {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp, failOp } = useOps();

  return {
    walletAddress,
    senderAddr,
    openConnectModal,
    provider,
    trackOp,
    completeOp,
    failOp,
  };
}
