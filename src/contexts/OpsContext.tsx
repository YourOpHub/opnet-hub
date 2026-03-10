import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { updateSwapOp, getActiveOps, getHistory, type SwapOp, type SwapOpUpdate } from '../swapApi';

/** Markets that sync to server — everything else is local-only */
const SERVER_MARKETS = new Set(['fractalswap', 'p2p']);

export interface OpEntry {
  id: string;
  market: string;      // fractalswap | p2p | mint | swap | stake | liquidity | transfer | split | deploy
  orderId: string;
  direction: string;
  role: string;
  step: string;
  status: 'active' | 'completed' | 'failed';
  error?: string;
  amounts?: Record<string, unknown>;
  txIds?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

interface OpsContextValue {
  activeOps: OpEntry[];
  historyOps: OpEntry[];
  activeCount: number;
  trackOp: (data: {
    id: string; market: string; orderId: string; direction: string;
    role: string; step: string; amounts?: Record<string, unknown>;
    txIds?: Record<string, string>;
  }) => void;
  updateOpStep: (id: string, step: string, txIds?: Record<string, string>) => void;
  completeOp: (id: string) => void;
  failOp: (id: string, error: string) => void;
  dismissOp: (id: string) => void;
}

const OpsContext = createContext<OpsContextValue>({
  activeOps: [], historyOps: [], activeCount: 0,
  trackOp: () => {}, updateOpStep: () => {},
  completeOp: () => {}, failOp: () => {}, dismissOp: () => {},
});

export const useOps = () => useContext(OpsContext);

function swapOpToEntry(op: SwapOp): OpEntry {
  return {
    id: op.id, market: op.market, orderId: op.order_id,
    direction: op.direction, role: op.role, step: op.step,
    status: (op.status === 'active' ? 'active' : op.status === 'failed' ? 'failed' : 'completed') as OpEntry['status'],
    error: op.error || undefined,
    amounts: (() => { try { return JSON.parse(op.amounts); } catch (e) { logger.warn('[OpsContext] Failed to parse op amounts JSON:', e); return undefined; } })(),
    txIds: (() => { try { return JSON.parse(op.tx_ids); } catch (e) { logger.warn('[OpsContext] Failed to parse op tx_ids JSON:', e); return undefined; } })(),
    createdAt: new Date(op.created_at + 'Z').getTime(),
    updatedAt: new Date(op.updated_at + 'Z').getTime(),
  };
}

export const OpsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { walletAddress } = useWalletConnect();
  const [ops, setOps] = useState<OpEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const wallet = walletAddress ?? '';

  // Load all ops on mount / wallet change
  const loadOps = useCallback(async () => {
    if (!wallet) { setOps([]); return; }
    const [active, hist] = await Promise.all([
      getActiveOps(wallet),
      getHistory(wallet),
    ]);
    setOps(prev => {
      const serverOps = [...active, ...hist].map(swapOpToEntry);
      // Merge: keep local optimistic entries that server doesn't have yet
      const serverIds = new Set(serverOps.map(o => o.id));
      const localOnly = prev.filter(p => !serverIds.has(p.id));
      return [...localOnly, ...serverOps];
    });
  }, [wallet]);

  useEffect(() => { void loadOps(); }, [loadOps]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!wallet) return;
    timerRef.current = setInterval(() => void loadOps(), 15_000);
    return () => clearInterval(timerRef.current);
  }, [wallet, loadOps]);

  const trackOp = useCallback((data: {
    id: string; market: string; orderId: string; direction: string;
    role: string; step: string; amounts?: Record<string, unknown>;
    txIds?: Record<string, string>;
  }) => {
    const entry: OpEntry = {
      id: data.id, market: data.market, orderId: data.orderId,
      direction: data.direction, role: data.role, step: data.step,
      status: 'active', amounts: data.amounts, txIds: data.txIds,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    setOps(prev => {
      const idx = prev.findIndex(p => p.id === data.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [entry, ...prev];
    });
    if (wallet && SERVER_MARKETS.has(data.market)) {
      const update: SwapOpUpdate = {
        id: data.id, market: data.market, order_id: data.orderId, wallet,
        direction: data.direction, role: data.role, step: data.step,
        status: 'active', amounts: data.amounts, tx_ids: data.txIds,
      };
      void updateSwapOp(update);
    }
  }, [wallet]);

  const updateOpStep = useCallback((id: string, step: string, txIds?: Record<string, string>) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, step, txIds: txIds || o.txIds, updatedAt: Date.now() } : o));
    if (wallet) {
      const op = ops.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step, status: 'active', tx_ids: txIds });
    }
  }, [wallet, ops]);

  const completeOp = useCallback((id: string) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, status: 'completed', step: 'Done', updatedAt: Date.now() } : o));
    if (wallet) {
      const op = ops.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step: 'Done', status: 'completed' });
    }
  }, [wallet, ops]);

  const failOp = useCallback((id: string, error: string) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, status: 'failed', step: 'Failed', error, updatedAt: Date.now() } : o));
    if (wallet) {
      const op = ops.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step: 'Failed', status: 'failed', error });
    }
  }, [wallet, ops]);

  const dismissOp = useCallback((id: string) => {
    setOps(prev => prev.filter(o => o.id !== id));
  }, []);

  const activeOps = ops.filter(o => o.status === 'active');
  const historyOps = ops.filter(o => o.status !== 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);

  return (
    <OpsContext.Provider value={{
      activeOps, historyOps, activeCount: activeOps.length,
      trackOp, updateOpStep, completeOp, failOp, dismissOp,
    }}>
      {children}
    </OpsContext.Provider>
  );
};
