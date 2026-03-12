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
  error?: string | undefined;
  amounts?: Record<string, unknown> | undefined;
  txIds?: Record<string, string> | undefined;
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

export const useOps = (): OpsContextValue => useContext(OpsContext);

function swapOpToEntry(op: SwapOp): OpEntry {
  return {
    id: op.id, market: op.market, orderId: op.order_id,
    direction: op.direction, role: op.role, step: op.step,
    status: (op.status === 'active' ? 'active' : op.status === 'failed' ? 'failed' : 'completed') as OpEntry['status'],
    error: op.error || undefined,
    amounts: (() => { try { return JSON.parse(op.amounts) as Record<string, unknown>; } catch (e) { logger.warn('[OpsContext] Failed to parse op amounts JSON:', e); return undefined; } })(),
    txIds: (() => { try { return JSON.parse(op.tx_ids) as Record<string, string>; } catch (e) { logger.warn('[OpsContext] Failed to parse op tx_ids JSON:', e); return undefined; } })(),
    createdAt: new Date(op.created_at + 'Z').getTime(),
    updatedAt: new Date(op.updated_at + 'Z').getTime(),
  };
}

export const OpsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { walletAddress } = useWalletConnect();
  const [ops, setOps] = useState<OpEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const wallet = walletAddress ?? '';

  // FIX: ref always holds current ops — prevents stale closure bugs in long-running async callbacks
  const opsRef = useRef(ops);
  opsRef.current = ops;

  // Load all ops on mount / wallet change
  const loadOps = useCallback(async () => {
    if (!wallet) { setOps([]); return; }
    const [active, hist] = await Promise.all([
      getActiveOps(wallet),
      getHistory(wallet),
    ]);
    setOps(prev => {
      const serverOps = [...active, ...hist].map(swapOpToEntry);
      const serverMap = new Map(serverOps.map(o => [o.id, o]));
      // Keep local-only entries (not on server yet)
      const localOnly = prev.filter(p => !serverMap.has(p.id));
      // Merge: prefer local if it's "ahead" (terminal status while server still active)
      const merged = serverOps.map(so => {
        const local = prev.find(p => p.id === so.id);
        if (local && local.status !== 'active' && so.status === 'active') {
          return local; // local completed/failed but server hasn't caught up yet
        }
        return so;
      });
      return [...localOnly, ...merged];
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
        status: 'active',
        ...(data.amounts !== undefined ? { amounts: data.amounts } : {}),
        ...(data.txIds !== undefined ? { tx_ids: data.txIds } : {}),
      };
      void updateSwapOp(update);
    }
  }, [wallet]);

  const updateOpStep = useCallback((id: string, step: string, txIds?: Record<string, string>) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, step, txIds: txIds || o.txIds, updatedAt: Date.now() } : o));
    if (wallet) {
      const op = opsRef.current.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step, status: 'active', ...(txIds !== undefined ? { tx_ids: txIds } : {}) });
    }
  }, [wallet]);

  const completeOp = useCallback((id: string) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, status: 'completed', step: 'Done', updatedAt: Date.now() } : o));
    if (wallet) {
      const op = opsRef.current.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step: 'Done', status: 'completed' });
    }
  }, [wallet]);

  const failOp = useCallback((id: string, error: string) => {
    setOps(prev => prev.map(o => o.id === id ? { ...o, status: 'failed', step: 'Failed', error, updatedAt: Date.now() } : o));
    if (wallet) {
      const op = opsRef.current.find(o => o.id === id);
      if (op && SERVER_MARKETS.has(op.market)) void updateSwapOp({ id, market: op.market, order_id: op.orderId, wallet, step: 'Failed', status: 'failed', error });
    }
  }, [wallet]);

  const dismissOp = useCallback((id: string) => {
    setOps(prev => prev.filter(o => o.id !== id));
  }, []);

  // Auto-timeout stale ops: active > 30 min → mark as failed
  useEffect(() => {
    const STALE_MS = 30 * 60 * 1000;
    const now = Date.now();
    const stale = ops.filter(o => o.status === 'active' && now - o.updatedAt > STALE_MS);
    if (stale.length === 0) return;
    for (const op of stale) {
      failOp(op.id, 'Operation timed out (no block confirmation after 30 min)');
    }
  }, [ops, failOp]);

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
