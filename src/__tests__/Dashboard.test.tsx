/**
 * Dashboard.test.tsx -- Tests for src/components/Dashboard.tsx
 *
 * Covers: initial loading state, data display after fetch, network metrics, epoch progress
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(1234),
  getLatestEpoch: vi.fn().mockResolvedValue({ number: 246 }),
  getGasParameters: vi.fn().mockResolvedValue({
    bitcoin: { conservative: 500000 },
  }),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({
    usd: 95000,
    usd_24h_change: 2.5,
    usd_market_cap: 1900000000000,
  }),
}));

import Dashboard from '../components/Dashboard';

/** Helper: advance fake timers enough for async fetches + pulse setTimeout */
async function waitForData(): Promise<void> {
  // Flush microtasks (promises from mocked fetches)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  // Advance past the pulse setTimeout(800ms)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading state initially', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Bitcoin Price/)).toBeTruthy();
    expect(screen.getByText('Loading\u2026')).toBeTruthy();
  });

  it('renders price after data loads', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText(/\$95,000/)).toBeTruthy();
  });

  it('renders block height', async () => {
    render(<Dashboard />);
    await waitForData();
    // toLocaleString format varies by locale
    expect(screen.getAllByText(/1.?234/).length).toBeGreaterThan(0);
    expect(screen.getByText('OP_NET Block')).toBeTruthy();
  });

  it('renders epoch number', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText('246')).toBeTruthy();
    expect(screen.getByText('Epoch')).toBeTruthy();
  });

  it('renders epoch progress bar', async () => {
    render(<Dashboard />);
    await waitForData();
    const progressbar = screen.getByRole('progressbar', { name: 'Epoch progress' });
    expect(progressbar).toBeTruthy();
    // 1234 % 5 = 4, so 4/5 blocks
    expect(screen.getByText('4/5 blocks')).toBeTruthy();
  });

  it('renders market cap', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText('$1.90T')).toBeTruthy();
    expect(screen.getByText('Market Cap')).toBeTruthy();
  });

  it('renders gas parameters', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText(/0\.005000/)).toBeTruthy();
    expect(screen.getByText('Gas (conservative)')).toBeTruthy();
  });

  it('renders static network info', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText('ML-DSA')).toBeTruthy();
    expect(screen.getByText('PQ Security')).toBeTruthy();
    expect(screen.getByText('26+')).toBeTruthy();
    expect(screen.getByText('dApps Live')).toBeTruthy();
  });

  it('renders price change badge', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText(/2\.50%/)).toBeTruthy();
  });

  it('renders OPScan link', async () => {
    render(<Dashboard />);
    await waitForData();
    const link = screen.getByText(/OPScan/);
    expect(link).toBeTruthy();
    expect(link.closest('a')?.href).toContain('opscan.org');
  });

  it('renders live block feed after update', async () => {
    render(<Dashboard />);
    await waitForData();
    expect(screen.getByText(/Live Block Feed/)).toBeTruthy();
    expect(screen.getByText(/#1.?234/)).toBeTruthy();
  });

  it('has proper ARIA regions', () => {
    render(<Dashboard />);
    expect(screen.getByRole('region', { name: 'Bitcoin price overview' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Network metrics' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Network information' })).toBeTruthy();
  });
});
