/**
 * btc-price.test.ts — Tests for src/btc-price.ts
 *
 * Covers: fetchBtcPrice with Binance/Kraken fallback, caching behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We need to reset the module for each test to clear cached state
let fetchBtcPrice: typeof import('../btc-price').fetchBtcPrice;

describe('fetchBtcPrice', () => {
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    // Reset module to clear cache
    vi.resetModules();
    const mod = await import('../btc-price');
    fetchBtcPrice = mod.fetchBtcPrice;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches price from Binance first', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ price: '65432.50' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ priceChangePercent: '2.5' }),
      });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(65432.5);
    expect(result.usd_24h_change).toBe(2.5);
    expect(result.source).toBe('Binance');
    expect(result.usd_market_cap).toBe(0);
  });

  it('falls back to Kraken when Binance fails', async () => {
    // Binance fails
    mockFetch
      .mockResolvedValueOnce({ ok: false }) // ticker
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }); // stats

    // Kraken succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        result: {
          XXBTZUSD: { c: ['64000.00'], o: '63000.00' },
        },
      }),
    });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(64000);
    expect(result.source).toBe('Kraken');
    expect(result.usd_24h_change).toBeCloseTo(1.5873, 2);
  });

  it('returns fallback when all sources fail', async () => {
    // Binance fails
    mockFetch.mockRejectedValueOnce(new Error('Binance down'));
    mockFetch.mockRejectedValueOnce(new Error('Binance down'));
    // Kraken fails
    mockFetch.mockRejectedValueOnce(new Error('Kraken down'));

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(0);
    expect(result.source).toBe('none');
  });

  it('returns cached result within TTL', async () => {
    // First call succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ price: '65000.00' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ priceChangePercent: '1.0' }),
      });

    const result1 = await fetchBtcPrice();
    expect(result1.usd).toBe(65000);

    // Second call — should return cached without fetching
    const result2 = await fetchBtcPrice();
    expect(result2.usd).toBe(65000);
    // Only 2 fetch calls total (the initial Binance ticker + stats)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('Binance with 0 price falls through to Kraken', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ price: '0' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ priceChangePercent: '0' }),
      });

    // Kraken fallback
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        result: {
          XXBTZUSD: { c: ['60000.00'], o: '59000.00' },
        },
      }),
    });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(60000);
    expect(result.source).toBe('Kraken');
  });

  it('Kraken with missing pair data falls through', async () => {
    // Binance fails
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    // Kraken returns empty result
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: {} }),
    });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(0);
    expect(result.source).toBe('none');
  });

  it('Binance missing stats still returns price with 0 change', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ price: '70000.00' }),
      })
      .mockResolvedValueOnce({ ok: false }); // stats fail

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(70000);
    expect(result.usd_24h_change).toBe(0);
    expect(result.source).toBe('Binance');
  });

  it('Kraken handles XBTUSD pair key', async () => {
    // Binance fails
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    // Kraken returns XBTUSD key (not XXBTZUSD)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        result: {
          XBTUSD: { c: ['55000.00'], o: '54000.00' },
        },
      }),
    });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(55000);
    expect(result.source).toBe('Kraken');
  });

  it('Kraken with open=0 returns 0 change', async () => {
    // Binance fails
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    // Kraken with open=0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        result: {
          XXBTZUSD: { c: ['55000.00'], o: '0' },
        },
      }),
    });

    const result = await fetchBtcPrice();
    expect(result.usd).toBe(55000);
    expect(result.usd_24h_change).toBe(0);
  });
});
