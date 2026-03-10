import { useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getProvider } from '../contractCache';
import { useOps } from '../contexts/OpsContext';

/**
 * Shared hook for TokenTools sub-components.
 * Provides wallet connection, provider and ops tracking
 * so each tool does not need to instantiate them independently.
 */
export function useTokenTools() {
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
