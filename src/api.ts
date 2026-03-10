/**
 * OPNet Hub API Client — connects to backend via VITE_API_URL env var
 * Handles player sync, leaderboard, token info, and claims
 */

import { logger } from './logger';

const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

let apiFailed = false;
let apiFailCount = 0;
const MAX_FAIL = 2;

async function api<T>(path: string, opts?: RequestInit): Promise<T | null> {
  if (API_BASE === '' || apiFailed) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    apiFailCount = 0;
    return await res.json() as T;
  } catch {
    apiFailCount++;
    if (apiFailCount >= MAX_FAIL) {
      apiFailed = true;
      logger.warn(`[API] Backend unreachable after ${MAX_FAIL} attempts, disabling API calls`);
    }
    return null;
  }
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  gamePool: number;
  distributed: number;
  remaining: number;
  dailyEmission: number;
  halving: string;
  contract: string;
}

export interface PlayerData {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  total_clicks: number;
  hash_rate: number;
  last_sync: string;
}

export interface LeaderboardEntry {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  hash_rate: number;
  rank: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  stats: {
    players: number;
    distributed: number;
    remaining: number;
    emission: number;
  };
}

export interface ClaimResponse {
  ok: boolean;
  claim_id: number;
  amount: number;
  status: string;
  message?: string;
}

export interface SyncResponse {
  ok: boolean;
  mine_balance: number;
  pool_remaining: number;
}

/** Get $MINE token info */
export const getTokenInfo = (): Promise<TokenInfo | null> => api<TokenInfo>('/api/token');

/** Get leaderboard */
export const getLeaderboard = (limit = 50): Promise<LeaderboardResponse | null> =>
  api<LeaderboardResponse>(`/api/leaderboard?limit=${limit}`);

/** Get player data */
export const getPlayer = (address: string): Promise<PlayerData | null> =>
  api<PlayerData>(`/api/player/${address}`);

/** Sync player game state to server */
export const syncPlayer = (data: {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  total_clicks: number;
  hash_rate: number;
}): Promise<SyncResponse | null> => api<SyncResponse>('/api/player/sync', {
  method: 'POST',
  body: JSON.stringify(data),
});

/** Claim $MINE tokens */
export const claimTokens = (address: string, amount: number): Promise<ClaimResponse | null> =>
  api<ClaimResponse>('/api/claim', {
    method: 'POST',
    body: JSON.stringify({ address, amount }),
  });

/** Health check */
export const getHealth = (): Promise<{ status: string; uptime: number } | null> => api<{ status: string; uptime: number }>('/health');
