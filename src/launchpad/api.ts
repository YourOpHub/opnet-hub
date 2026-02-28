/**
 * Launchpad API client — connects to server for instant trades.
 * Falls back to localStorage when server unavailable.
 */
import type { LaunchToken, TradeRecord } from './types';

// Server URL — configurable via env or fallback to VPS
const LP_API = import.meta.env.VITE_LP_API || 'http://188.137.250.160:3457';

let serverAvailable: boolean | null = null; // null = not checked yet
let lastCheck = 0;
const CHECK_INTERVAL = 30_000; // recheck every 30s

/** Check if server is reachable */
async function checkServer(): Promise<boolean> {
  if (serverAvailable !== null && Date.now() - lastCheck < CHECK_INTERVAL) return serverAvailable;
  try {
    const res = await fetch(`${LP_API}/lp/health`, { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  lastCheck = Date.now();
  return serverAvailable;
}

/** Generic API call */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lpApi<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${LP_API}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error((err as any).error || `HTTP ${res.status}`);
    }
    return await res.json() as T;
  } catch (e) {
    throw e;
  }
}

/* ─── Public API ─── */

export async function isServerAvailable(): Promise<boolean> {
  return checkServer();
}

export interface ServerToken extends LaunchToken {
  price: number;
  mcap: number;
}

export interface BuyResult {
  ok: boolean;
  trade: TradeRecord;
  token: ServerToken;
  balance: number;
}

/** Fetch all tokens from server */
export async function fetchTokens(): Promise<ServerToken[] | null> {
  if (!await checkServer()) return null;
  const data = await lpApi<{ tokens: ServerToken[] }>('/lp/tokens');
  return data?.tokens || null;
}

/** Fetch single token detail */
export async function fetchToken(address: string): Promise<ServerToken | null> {
  if (!await checkServer()) return null;
  return lpApi<ServerToken>(`/lp/token/${address}`);
}

/** Register new token on server */
export async function registerToken(token: LaunchToken): Promise<boolean> {
  if (!await checkServer()) return false;
  try {
    await lpApi('/lp/create', { method: 'POST', body: JSON.stringify(token) });
    return true;
  } catch { return false; }
}

/** Instant buy — server updates state immediately */
export async function serverBuy(address: string, wallet: string, amount: number): Promise<BuyResult> {
  const data = await lpApi<BuyResult>('/lp/buy', {
    method: 'POST',
    body: JSON.stringify({ address, wallet, amount }),
  });
  if (!data) throw new Error('Buy failed');
  return data;
}

/** Instant sell */
export async function serverSell(address: string, wallet: string, amount: number): Promise<BuyResult> {
  const data = await lpApi<BuyResult>('/lp/sell', {
    method: 'POST',
    body: JSON.stringify({ address, wallet, amount }),
  });
  if (!data) throw new Error('Sell failed');
  return data;
}

/** Post reply */
export async function serverReply(address: string, wallet: string, text: string): Promise<boolean> {
  if (!await checkServer()) return false;
  try {
    await lpApi('/lp/reply', { method: 'POST', body: JSON.stringify({ address, wallet, text }) });
    return true;
  } catch { return false; }
}

/** Like token */
export async function serverLike(address: string): Promise<boolean> {
  if (!await checkServer()) return false;
  try {
    await lpApi('/lp/like', { method: 'POST', body: JSON.stringify({ address }) });
    return true;
  } catch { return false; }
}

/** Get user account balances */
export async function fetchAccount(wallet: string): Promise<{ address: string; symbol: string; amount: number; value: number }[] | null> {
  if (!await checkServer()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await lpApi<any>(`/lp/account/${wallet}`);
  return data?.balances || null;
}
