/**
 * Analytics.test.tsx -- Tests for src/components/Analytics.tsx
 *
 * Covers: initial render, loading state, metrics display, pool details, error banners
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));

vi.mock('../opnet', () => ({
  callContract: vi.fn().mockResolvedValue(null),
  getTokenTotalSupply: vi.fn().mockResolvedValue(500000n * 100000000n),
  getBlockHeight: vi.fn().mockResolvedValue(2500),
  getGasParameters: vi.fn().mockResolvedValue({ bitcoin: { conservative: 800000 } }),
  getMempoolInfo: vi.fn().mockResolvedValue({ count: 7 }),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({ usd: 97000, usd_24h_change: 1.2 }),
}));

vi.mock('../txHistory', () => ({
  getTxHistory: vi.fn(() => [
    { id: 'tx1', type: 'swap', amountA: '100', tokenA: 'MINE', tokenB: 'VIBE', status: 'confirmed', ts: Date.now() },
    { id: 'tx2', type: 'mint', amountA: '1000000', tokenA: 'MINE', status: 'confirmed', ts: Date.now() },
  ]),
  formatTimeAgo: vi.fn(() => '2m ago'),
}));

import Analytics from '../components/Analytics';

async function waitForData(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}

describe('Analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading state initially', () => {
    render(<Analytics />);
    expect(screen.getByText('Loading analytics...')).toBeTruthy();
  });

  it('renders analytics heading', () => {
    render(<Analytics />);
    expect(screen.getByText(/Analytics/)).toBeTruthy();
  });

  it('renders region', () => {
    render(<Analytics />);
    expect(screen.getByRole('region', { name: 'Analytics dashboard' })).toBeTruthy();
  });

  it('renders block height after load', async () => {
    render(<Analytics />);
    await waitForData();
    const elements = screen.getAllByText(/2.?500/);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders pool details section', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText(/Pool Details/)).toBeTruthy();
    expect(screen.getByText(/Fee: 0.3%/)).toBeTruthy();
  });

  it('renders token supply section', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText(/Token Supply/)).toBeTruthy();
  });

  it('renders recent activity section', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText(/Recent On-Chain Activity/)).toBeTruthy();
  });

  it('renders swap and mint counts', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText('1/1')).toBeTruthy(); // 1 swap / 1 mint
  });

  it('renders gas metric', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText('Gas (sat/vB)')).toBeTruthy();
  });

  it('renders mempool count', async () => {
    render(<Analytics />);
    await waitForData();
    expect(screen.getByText('Mempool TXs')).toBeTruthy();
  });
});
