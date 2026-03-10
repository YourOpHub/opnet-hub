/**
 * launchpad-api.test.ts -- Tests for src/launchpad/api.ts
 *
 * Covers: isServerAvailable, fetchTokens, registerToken, serverReply, serverLike
 * Mocks fetch globally.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We need to control the LP_API env var. Since it reads import.meta.env.VITE_LP_API at module load,
// we mock the module after setting the env var.
const TEST_LP_API = 'https://test-api.opnethub.xyz';

describe('launchpad/api', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Set env var for the module
    vi.stubEnv('VITE_LP_API', TEST_LP_API);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function importApi() {
    return await import('../launchpad/api');
  }

  describe('isServerAvailable', () => {
    it('returns true when health check succeeds', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      const api = await importApi();
      const result = await api.isServerAvailable();
      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/health'),
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it('returns false when health check fails', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const api = await importApi();
      const result = await api.isServerAvailable();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network error'));
      const api = await importApi();
      const result = await api.isServerAvailable();
      expect(result).toBe(false);
    });
  });

  describe('fetchTokens', () => {
    it('returns tokens when server is available', async () => {
      const mockTokens = [{ address: 'opt1test', name: 'Test' }];
      // First call: health check
      fetchSpy.mockResolvedValueOnce({ ok: true });
      // Second call: /tokens
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tokens: mockTokens }),
      });
      const api = await importApi();
      const result = await api.fetchTokens();
      expect(result).toEqual(mockTokens);
    });

    it('returns null when server is unavailable', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const api = await importApi();
      const result = await api.fetchTokens();
      expect(result).toBeNull();
    });
  });

  describe('registerToken', () => {
    it('returns true on success', async () => {
      // health check
      fetchSpy.mockResolvedValueOnce({ ok: true });
      // /create POST
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      const api = await importApi();
      const result = await api.registerToken({
        address: 'opt1new',
        name: 'New',
        symbol: 'NEW',
        decimals: 8,
        totalSupply: 1_000_000,
        publicMintSupply: 500_000,
        maxMintPerTx: 100_000,
        mintedSupply: 0,
        creator: 'opt1creator',
        createdAt: Date.now(),
        description: 'New token',
        image: null,
        status: 'bonding',
        trades: [],
        replies: [],
        likes: 0,
      });
      expect(result).toBe(true);
    });

    it('returns false when server is unavailable', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const api = await importApi();
      const result = await api.registerToken({} as any);
      expect(result).toBe(false);
    });

    it('returns false when API call throws', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      });
      const api = await importApi();
      const result = await api.registerToken({} as any);
      expect(result).toBe(false);
    });
  });

  describe('serverReply', () => {
    it('returns true on success', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      const api = await importApi();
      const result = await api.serverReply('opt1addr', 'opt1wallet', 'hello');
      expect(result).toBe(true);
    });

    it('returns false when server is unavailable', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const api = await importApi();
      const result = await api.serverReply('opt1addr', 'opt1wallet', 'hello');
      expect(result).toBe(false);
    });

    it('returns false on API error', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad request' }),
      });
      const api = await importApi();
      const result = await api.serverReply('opt1addr', 'opt1wallet', 'hello');
      expect(result).toBe(false);
    });
  });

  describe('serverLike', () => {
    it('returns true on success', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      const api = await importApi();
      const result = await api.serverLike('opt1addr');
      expect(result).toBe(true);
    });

    it('returns false when server is unavailable', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false });
      const api = await importApi();
      const result = await api.serverLike('opt1addr');
      expect(result).toBe(false);
    });

    it('returns false on API error', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('parse fail')),
      });
      const api = await importApi();
      const result = await api.serverLike('opt1addr');
      expect(result).toBe(false);
    });
  });
});
