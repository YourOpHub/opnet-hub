/**
 * api.test.ts — Tests for src/api.ts
 *
 * Covers: API client with circuit breaker behavior, all endpoint functions,
 *         error handling, and type safety.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Reset module state between tests
let getTokenInfo: typeof import('../api').getTokenInfo;
let getLeaderboard: typeof import('../api').getLeaderboard;
let getPlayer: typeof import('../api').getPlayer;
let syncPlayer: typeof import('../api').syncPlayer;
let claimTokens: typeof import('../api').claimTokens;
let getHealth: typeof import('../api').getHealth;

describe('API client', () => {
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.resetModules();

    // Set API_BASE so calls actually proceed
    vi.stubEnv('VITE_API_URL', 'https://api.test.com');

    const mod = await import('../api');
    getTokenInfo = mod.getTokenInfo;
    getLeaderboard = mod.getLeaderboard;
    getPlayer = mod.getPlayer;
    syncPlayer = mod.syncPlayer;
    claimTokens = mod.claimTokens;
    getHealth = mod.getHealth;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('getTokenInfo', () => {
    it('fetches token info from /api/token', async () => {
      const tokenInfo = {
        name: 'Mine Token', symbol: 'MINE', decimals: 8,
        totalSupply: 21000000, gamePool: 5000000,
        distributed: 100000, remaining: 4900000,
        dailyEmission: 5000, halving: '2027-01-01',
        contract: 'opt1abc',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenInfo),
      });

      const result = await getTokenInfo();
      expect(result).toEqual(tokenInfo);
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await getTokenInfo();
      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const result = await getTokenInfo();
      expect(result).toBeNull();
    });
  });

  describe('getLeaderboard', () => {
    it('fetches leaderboard with default limit', async () => {
      const data = {
        leaderboard: [
          { address: 'opt1abc', mine_balance: 1000, total_sats_mined: 5000, hash_rate: 10, rank: 1 },
        ],
        stats: { players: 100, distributed: 50000, remaining: 450000, emission: 500 },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      const result = await getLeaderboard();
      expect(result).toEqual(data);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/leaderboard?limit=50'),
        expect.any(Object),
      );
    });

    it('passes custom limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ leaderboard: [], stats: {} }),
      });

      await getLeaderboard(10);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/leaderboard?limit=10'),
        expect.any(Object),
      );
    });
  });

  describe('getPlayer', () => {
    it('fetches player by address', async () => {
      const player = {
        address: 'opt1abc', mine_balance: 500,
        total_sats_mined: 2000, total_clicks: 100,
        hash_rate: 5, last_sync: '2026-03-01',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(player),
      });

      const result = await getPlayer('opt1abc');
      expect(result).toEqual(player);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/player/opt1abc'),
        expect.any(Object),
      );
    });
  });

  describe('syncPlayer', () => {
    it('sends POST with player data', async () => {
      const syncData = {
        address: 'opt1abc', mine_balance: 500,
        total_sats_mined: 2000, total_clicks: 100, hash_rate: 5,
      };
      const response = { ok: true, mine_balance: 500, pool_remaining: 4500000 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });

      const result = await syncPlayer(syncData);
      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/player/sync'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(syncData),
        }),
      );
    });
  });

  describe('claimTokens', () => {
    it('sends POST with address and amount', async () => {
      const response = { ok: true, claim_id: 42, amount: 1000, status: 'pending' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });

      const result = await claimTokens('opt1abc', 1000);
      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/claim'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ address: 'opt1abc', amount: 1000 }),
        }),
      );
    });
  });

  describe('getHealth', () => {
    it('returns health data', async () => {
      const health = { status: 'ok', uptime: 86400 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(health),
      });

      const result = await getHealth();
      expect(result).toEqual(health);
    });
  });

  describe('circuit breaker', () => {
    it('disables API after MAX_FAIL consecutive failures', async () => {
      // Fail twice (MAX_FAIL = 2)
      mockFetch.mockRejectedValueOnce(new Error('fail1'));
      mockFetch.mockRejectedValueOnce(new Error('fail2'));

      await getTokenInfo(); // fail 1
      await getTokenInfo(); // fail 2 — circuit opens

      // Third call should return null immediately without fetching
      const result = await getTokenInfo();
      expect(result).toBeNull();
      // Only 2 fetch calls, not 3
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('resets fail count on success', async () => {
      // First call fails
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await getTokenInfo();

      // Second call succeeds — resets counter
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'MINE' }),
      });
      const result = await getTokenInfo();
      expect(result).toEqual({ name: 'MINE' });

      // Third call can still proceed (not circuit-broken)
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await getTokenInfo();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});

describe('API client with no API_BASE', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.resetModules();
    // Empty VITE_API_URL
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns null immediately when API_BASE is empty', async () => {
    const mod = await import('../api');
    const result = await mod.getTokenInfo();
    expect(result).toBeNull();
  });
});
