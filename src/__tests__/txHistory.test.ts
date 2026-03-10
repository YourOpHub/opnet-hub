/**
 * txHistory.test.ts — Tests for src/txHistory.ts
 *
 * Covers: getTxHistory, addTxRecord, formatTimeAgo with mocked localStorage.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getTxHistory, addTxRecord, formatTimeAgo } from '../txHistory';

// ─── formatTimeAgo (pure function) ───
describe('formatTimeAgo', () => {
  it('shows seconds for <60s', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatTimeAgo(now - 30_000)).toBe('30s ago');
    expect(formatTimeAgo(now - 5_000)).toBe('5s ago');
    expect(formatTimeAgo(now - 1_000)).toBe('1s ago');
  });

  it('shows 0s for just now', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatTimeAgo(now)).toBe('0s ago');
  });

  it('shows minutes for 60s-3600s', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatTimeAgo(now - 60_000)).toBe('1m ago');
    expect(formatTimeAgo(now - 120_000)).toBe('2m ago');
    expect(formatTimeAgo(now - 3_540_000)).toBe('59m ago');
  });

  it('shows hours for 3600s-86400s', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatTimeAgo(now - 3_600_000)).toBe('1h ago');
    expect(formatTimeAgo(now - 7_200_000)).toBe('2h ago');
    expect(formatTimeAgo(now - 82_800_000)).toBe('23h ago');
  });

  it('shows days for >= 86400s', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatTimeAgo(now - 86_400_000)).toBe('1d ago');
    expect(formatTimeAgo(now - 172_800_000)).toBe('2d ago');
    expect(formatTimeAgo(now - 604_800_000)).toBe('7d ago');
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
});

// ─── getTxHistory / addTxRecord ───
describe('getTxHistory & addTxRecord', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { storage[key] = val; }),
      removeItem: vi.fn((key: string) => { delete storage[key]; }),
    });
    // Mock crypto.randomUUID
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `uuid-${++uuidCounter}`,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
      subtle: { digest: vi.fn() },
    });
  });

  it('returns empty array when no history exists', () => {
    const result = getTxHistory();
    expect(result).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    storage['hub_tx_history'] = 'not valid json';
    const result = getTxHistory();
    expect(result).toEqual([]);
  });

  it('adds a record and retrieves it', () => {
    const record = addTxRecord({
      type: 'swap',
      txHash: '0xabc123',
      tokenA: 'MINE',
      tokenB: 'BTC',
      amountA: '1000',
      amountB: '0.001',
      status: 'pending',
      wallet: 'opt1wallet',
    });

    expect(record.id).toBe('uuid-1');
    expect(record.type).toBe('swap');
    expect(record.txHash).toBe('0xabc123');
    expect(record.ts).toBeGreaterThan(0);

    const history = getTxHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.txHash).toBe('0xabc123');
  });

  it('filters by wallet', () => {
    addTxRecord({ type: 'swap', txHash: '0x1', status: 'confirmed', wallet: 'wallet_a' });
    addTxRecord({ type: 'mint', txHash: '0x2', status: 'confirmed', wallet: 'wallet_b' });
    addTxRecord({ type: 'claim', txHash: '0x3', status: 'pending', wallet: 'wallet_a' });

    const walletA = getTxHistory('wallet_a');
    expect(walletA).toHaveLength(2);
    expect(walletA.every(r => r.wallet === 'wallet_a')).toBe(true);

    const walletB = getTxHistory('wallet_b');
    expect(walletB).toHaveLength(1);
    expect(walletB[0]!.txHash).toBe('0x2');
  });

  it('newest records appear first (unshift)', () => {
    addTxRecord({ type: 'swap', txHash: '0x1', status: 'confirmed', wallet: 'w' });
    addTxRecord({ type: 'mint', txHash: '0x2', status: 'confirmed', wallet: 'w' });
    addTxRecord({ type: 'claim', txHash: '0x3', status: 'pending', wallet: 'w' });

    const history = getTxHistory();
    expect(history[0]!.txHash).toBe('0x3');
    expect(history[1]!.txHash).toBe('0x2');
    expect(history[2]!.txHash).toBe('0x1');
  });

  it('caps at MAX_RECORDS (100)', () => {
    for (let i = 0; i < 110; i++) {
      addTxRecord({ type: 'swap', txHash: `0x${i}`, status: 'confirmed', wallet: 'w' });
    }

    const history = getTxHistory();
    expect(history.length).toBeLessThanOrEqual(100);
  });

  it('preserves all required fields', () => {
    const record = addTxRecord({
      type: 'claim',
      txHash: '0xhash',
      tokenA: 'MINE',
      amountA: '500',
      status: 'failed',
      wallet: 'opt1me',
    });

    expect(record).toMatchObject({
      type: 'claim',
      txHash: '0xhash',
      tokenA: 'MINE',
      amountA: '500',
      status: 'failed',
      wallet: 'opt1me',
    });
    expect(record.id).toBeDefined();
    expect(record.ts).toBeDefined();
  });
});
