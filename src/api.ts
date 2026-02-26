/**
 * OPNet Hub API Client — connects to VPS backend at 188.137.250.160
 * Handles player sync, leaderboard, token info, and claims
 */

const API_BASE = 'http://188.137.250.160';

async function api<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch (e) {
    console.warn(`[API] ${path} failed:`, e);
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
export const getTokenInfo = () => api<TokenInfo>('/api/token');

/** Get leaderboard */
export const getLeaderboard = (limit = 50) =>
  api<LeaderboardResponse>(`/api/leaderboard?limit=${limit}`);

/** Get player data */
export const getPlayer = (address: string) =>
  api<PlayerData>(`/api/player/${address}`);

/** Sync player game state to server */
export const syncPlayer = (data: {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  total_clicks: number;
  hash_rate: number;
}) => api<SyncResponse>('/api/player/sync', {
  method: 'POST',
  body: JSON.stringify(data),
});

/** Claim $MINE tokens */
export const claimTokens = (address: string, amount: number) =>
  api<ClaimResponse>('/api/claim', {
    method: 'POST',
    body: JSON.stringify({ address, amount }),
  });

/** Health check */
export const getHealth = () => api<{ status: string; uptime: number }>('/health');
