/**
 * swapApi.test.ts — Tests for src/swapApi.ts
 *
 * Covers: updateSwapOp, getActiveOps, getHistory, saveRate, getRates,
 *         lockOrder, unlockOrder, getActiveLocks — all with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let updateSwapOp: typeof import('../swapApi').updateSwapOp;
let getActiveOps: typeof import('../swapApi').getActiveOps;
let getHistory: typeof import('../swapApi').getHistory;
let saveRate: typeof import('../swapApi').saveRate;
let getRates: typeof import('../swapApi').getRates;
let lockOrder: typeof import('../swapApi').lockOrder;
let unlockOrder: typeof import('../swapApi').unlockOrder;
let getActiveLocks: typeof import('../swapApi').getActiveLocks;

describe('swapApi', () => {
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.test.com');

    const mod = await import('../swapApi');
    updateSwapOp = mod.updateSwapOp;
    getActiveOps = mod.getActiveOps;
    getHistory = mod.getHistory;
    saveRate = mod.saveRate;
    getRates = mod.getRates;
    lockOrder = mod.lockOrder;
    unlockOrder = mod.unlockOrder;
    getActiveLocks = mod.getActiveLocks;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ─── updateSwapOp ───
  describe('updateSwapOp', () => {
    it('sends POST to /api/swap/update', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const data = { id: '1', market: 'MINE/BTC', order_id: '42', wallet: 'opt1abc', step: 'approve' };
      await updateSwapOp(data);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/update',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(data),
        }),
      );
    });

    it('does not throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await expect(updateSwapOp({ id: '1', market: 'M', order_id: '1', wallet: 'w' })).resolves.toBeUndefined();
    });
  });

  // ─── getActiveOps ───
  describe('getActiveOps', () => {
    it('fetches active ops for wallet', async () => {
      const ops = [{ id: '1', market: 'MINE/BTC', status: 'active' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ops),
      });

      const result = await getActiveOps('opt1wallet');
      expect(result).toEqual(ops);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/active/opt1wallet',
      );
    });

    it('appends market query param when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await getActiveOps('opt1wallet', 'MINE/BTC');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/active/opt1wallet?market=MINE/BTC',
      );
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await getActiveOps('opt1wallet');
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getActiveOps('opt1wallet');
      expect(result).toEqual([]);
    });
  });

  // ─── getHistory ───
  describe('getHistory', () => {
    it('fetches history for wallet', async () => {
      const history = [{ id: '1', status: 'completed' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(history),
      });

      const result = await getHistory('opt1wallet');
      expect(result).toEqual(history);
    });

    it('appends market param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await getHistory('opt1wallet', 'VIBE/BTC');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/history/opt1wallet?market=VIBE/BTC',
      );
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getHistory('opt1wallet');
      expect(result).toEqual([]);
    });
  });

  // ─── saveRate ───
  describe('saveRate', () => {
    it('sends POST to /api/orders/rate', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const data = {
        order_id: '1', send_sats: '1000', receive_sats: '2000',
        send_unit: 'BTC', receive_unit: 'MINE', rate: 2.0,
      };
      await saveRate(data);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/orders/rate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(data),
        }),
      );
    });

    it('does not throw on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await expect(saveRate({
        order_id: '1', send_sats: '0', receive_sats: '0',
        send_unit: 'BTC', receive_unit: 'MINE', rate: 0,
      })).resolves.toBeUndefined();
    });
  });

  // ─── getRates ───
  describe('getRates', () => {
    it('fetches rates', async () => {
      const rates = { 'MINE/BTC': { rate: 0.0001 } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(rates),
      });

      const result = await getRates();
      expect(result).toEqual(rates);
    });

    it('returns empty object on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await getRates();
      expect(result).toEqual({});
    });

    it('returns empty object on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getRates();
      expect(result).toEqual({});
    });
  });

  // ─── lockOrder ───
  describe('lockOrder', () => {
    it('sends POST and returns success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const result = await lockOrder('order_key_1', 'opt1wallet');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/lock',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ order_key: 'order_key_1', wallet: 'opt1wallet' }),
        }),
      );
    });

    it('returns error when server returns non-ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Already locked' }),
      });

      const result = await lockOrder('order_key_1', 'opt1wallet');
      expect(result).toEqual({ ok: false, error: 'Already locked' });
    });

    it('returns error with default message when no error field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const result = await lockOrder('order_key_1', 'opt1wallet');
      expect(result).toEqual({ ok: false, error: 'Lock failed' });
    });

    it('returns network error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await lockOrder('order_key_1', 'opt1wallet');
      expect(result).toEqual({ ok: false, error: 'Network error' });
    });
  });

  // ─── unlockOrder ───
  describe('unlockOrder', () => {
    it('sends POST to /api/swap/unlock', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      await unlockOrder('order_key_1', 'opt1wallet');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/swap/unlock',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ order_key: 'order_key_1', wallet: 'opt1wallet' }),
        }),
      );
    });

    it('does not throw on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await expect(unlockOrder('k', 'w')).resolves.toBeUndefined();
    });
  });

  // ─── getActiveLocks ───
  describe('getActiveLocks', () => {
    it('fetches active locks', async () => {
      const locks = {
        'order_1': { order_key: 'order_1', locked_by: 'opt1abc', locked_at: '2026-03-01' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(locks),
      });

      const result = await getActiveLocks();
      expect(result).toEqual(locks);
    });

    it('returns empty object on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await getActiveLocks();
      expect(result).toEqual({});
    });

    it('returns empty object on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getActiveLocks();
      expect(result).toEqual({});
    });
  });
});
