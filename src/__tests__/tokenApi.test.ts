/**
 * tokenApi.test.ts — Tests for src/tokenApi.ts
 *
 * Covers: formatTokenBalance (pure), fetchAllTokens, fetchHolderBalances,
 *         fetchMotoswapPools (with mocked fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { formatTokenBalance } from '../tokenApi';

// ─── formatTokenBalance (pure function — no module reset needed) ───
describe('formatTokenBalance', () => {
  it('formats zero balance', () => {
    expect(formatTokenBalance('0', 8)).toBe('0');
  });

  it('formats 1 token with 8 decimals', () => {
    expect(formatTokenBalance('100000000', 8)).toBe('1');
  });

  it('formats fractional tokens', () => {
    const result = formatTokenBalance('50000000', 8);
    expect(result).toBe('0.5');
  });

  it('formats millions', () => {
    const result = formatTokenBalance('5000000000000000', 8);
    expect(result).toBe('50.00M');
  });

  it('formats thousands', () => {
    const result = formatTokenBalance('500000000000', 8);
    expect(result).toBe('5.00K');
  });

  it('handles 18 decimals (EVM-style)', () => {
    // 1e18 = 1 token
    const result = formatTokenBalance('1000000000000000000', 18);
    expect(result).toBe('1');
  });

  it('handles 0 decimals', () => {
    const result = formatTokenBalance('42', 0);
    expect(result).toBe('42');
  });

  it('handles very large numbers in millions', () => {
    // 21,000,000 tokens * 1e8
    const result = formatTokenBalance('2100000000000000', 8);
    expect(result).toBe('21.00M');
  });

  it('handles 1000 tokens (K threshold)', () => {
    // 1000 * 1e8
    const result = formatTokenBalance('100000000000', 8);
    expect(result).toBe('1.00K');
  });

  it('handles small fractional values', () => {
    // 0.0001 tokens with 8 decimals = 10000
    const result = formatTokenBalance('10000', 8);
    expect(result).toBe('0.0001');
  });

  it('handles 2 decimal token', () => {
    const result = formatTokenBalance('150', 2);
    expect(result).toBe('1.5');
  });

  it('formats 999 tokens below K threshold', () => {
    const result = formatTokenBalance('99900000000', 8);
    expect(result).toBe('999');
  });

  it('formats exactly 1M threshold', () => {
    // 1,000,000 * 1e8
    const result = formatTokenBalance('100000000000000', 8);
    expect(result).toBe('1.00M');
  });
});

// ─── Async fetch functions ───
describe('tokenApi async functions', () => {
  const mockFetch = vi.fn();

  let fetchAllTokens: typeof import('../tokenApi').fetchAllTokens;
  let fetchHolderBalances: typeof import('../tokenApi').fetchHolderBalances;
  let fetchMotoswapPools: typeof import('../tokenApi').fetchMotoswapPools;

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.test.com');

    const mod = await import('../tokenApi');
    fetchAllTokens = mod.fetchAllTokens;
    fetchHolderBalances = mod.fetchHolderBalances;
    fetchMotoswapPools = mod.fetchMotoswapPools;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('fetchAllTokens', () => {
    it('fetches tokens from /api/tokens', async () => {
      const tokens = [
        { address: 'opt1abc', pubkey: '0x123', symbol: 'MINE', name: 'Mine', decimals: 8, total_supply: '21000000', deploy_block: 100 },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokens),
      });

      const result = await fetchAllTokens();
      expect(result).toEqual(tokens);
    });

    it('returns empty array on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await fetchAllTokens();
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await fetchAllTokens();
      expect(result).toEqual([]);
    });
  });

  describe('fetchHolderBalances', () => {
    it('fetches balances for a pubkey', async () => {
      const balances = [
        { token: 'opt1abc', pubkey: '0x123', symbol: 'MINE', name: 'Mine', decimals: 8, balance: '1000000000' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(balances),
      });

      const result = await fetchHolderBalances('abc123');
      expect(result).toEqual(balances);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/holder/abc123/tokens'),
        expect.any(Object),
      );
    });

    it('strips 0x prefix from pubkey', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await fetchHolderBalances('0xabc123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/holder/abc123/tokens'),
        expect.any(Object),
      );
    });

    it('appends tweaked pubkey param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await fetchHolderBalances('abc123', '0xdef456');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/holder/abc123/tokens?tweaked=def456'),
        expect.any(Object),
      );
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await fetchHolderBalances('abc');
      expect(result).toEqual([]);
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await fetchHolderBalances('abc');
      expect(result).toEqual([]);
    });
  });

  describe('fetchMotoswapPools', () => {
    it('fetches pools from /api/pools', async () => {
      const pools = [
        {
          pool_pubkey: '0xpool', token0_pubkey: '0xa', token1_pubkey: '0xb',
          token0_symbol: 'MINE', token1_symbol: 'VIBE',
          token0_decimals: 8, token1_decimals: 8,
          reserve0: '1000000', reserve1: '2000000',
          last_updated: '2026-03-01',
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pools),
      });

      const result = await fetchMotoswapPools();
      expect(result).toEqual(pools);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await fetchMotoswapPools();
      expect(result).toEqual([]);
    });

    it('returns empty array on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await fetchMotoswapPools();
      expect(result).toEqual([]);
    });
  });
});
