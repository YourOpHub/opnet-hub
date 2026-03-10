import { logger } from './logger';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface SwapOp {
  id: string;
  market: string;
  order_id: string;
  wallet: string;
  direction: string;
  role: string;
  step: string;
  status: string;
  amounts: string;
  tx_ids: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export interface SwapOpUpdate {
  id: string;
  market: string;
  order_id: string;
  wallet: string;
  direction?: string;
  role?: string;
  step?: string;
  status?: string;
  amounts?: Record<string, unknown>;
  tx_ids?: Record<string, string>;
  error?: string;
}

export async function updateSwapOp(data: SwapOpUpdate): Promise<void> {
  try {
    await fetch(`${API}/api/swap/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) { logger.warn('[swapApi] updateSwapOp error:', e); }
}

export async function getActiveOps(wallet: string, market?: string): Promise<SwapOp[]> {
  try {
    const q = market !== undefined ? `?market=${market}` : '';
    const r = await fetch(`${API}/api/swap/active/${wallet}${q}`);
    if (!r.ok) return [];
    return (await r.json()) as SwapOp[];
  } catch (e) { logger.warn('[swapApi] getActiveOps error:', e); return []; }
}

export async function getHistory(wallet: string, market?: string): Promise<SwapOp[]> {
  try {
    const q = market !== undefined ? `?market=${market}` : '';
    const r = await fetch(`${API}/api/swap/history/${wallet}${q}`);
    if (!r.ok) return [];
    return (await r.json()) as SwapOp[];
  } catch (e) { logger.warn('[swapApi] getHistory error:', e); return []; }
}

export async function saveRate(data: {
  order_id: string;
  send_sats: string;
  receive_sats: string;
  send_unit: string;
  receive_unit: string;
  rate: number;
}): Promise<void> {
  try {
    await fetch(`${API}/api/orders/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) { logger.warn('[swapApi] saveRate error:', e); }
}

export async function getRates(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${API}/api/orders/rates`);
    if (!r.ok) return {};
    return (await r.json()) as Record<string, unknown>;
  } catch (e) { logger.warn('[swapApi] getRates error:', e); return {}; }
}

// ─── Order Locks ───
export async function lockOrder(orderKey: string, wallet: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/swap/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_key: orderKey, wallet }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) return { ok: false, error: data.error ?? 'Lock failed' };
    return { ok: true };
  } catch (e) { logger.warn('[swapApi] lockOrder error:', e); return { ok: false, error: 'Network error' }; }
}

export async function unlockOrder(orderKey: string, wallet: string): Promise<void> {
  try {
    await fetch(`${API}/api/swap/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_key: orderKey, wallet }),
    });
  } catch (e) { logger.warn('[swapApi] unlockOrder error:', e); }
}

export interface OrderLock { order_key: string; locked_by: string; locked_at: string }

export async function getActiveLocks(): Promise<Record<string, OrderLock>> {
  try {
    const r = await fetch(`${API}/api/swap/locks`);
    if (!r.ok) return {};
    return (await r.json()) as Record<string, OrderLock>;
  } catch (e) { logger.warn('[swapApi] getActiveLocks error:', e); return {}; }
}
