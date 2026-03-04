/**
 * Launchpad API client — social layer + token registry.
 * Trades happen on-chain via publicMint (not through this server).
 * Server handles: token registry, replies, likes.
 */
import type { LaunchToken } from './types';

// Server URL — configurable via env or fallback to VPS
const LP_API = import.meta.env.VITE_LP_API || '';

let serverAvailable: boolean | null = null;
let lastCheck = 0;
const CHECK_INTERVAL = 30_000;

async function checkServer(): Promise<boolean> {
  if (!LP_API) return false;
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

/** Fetch all tokens from server (registry + social data) */
export async function fetchTokens(): Promise<ServerToken[] | null> {
  if (!await checkServer()) return null;
  const data = await lpApi<{ tokens: ServerToken[] }>('/lp/tokens');
  return data?.tokens || null;
}

/** Register new token on server */
export async function registerToken(token: LaunchToken): Promise<boolean> {
  if (!await checkServer()) return false;
  try {
    await lpApi('/lp/create', { method: 'POST', body: JSON.stringify(token) });
    return true;
  } catch { return false; }
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
