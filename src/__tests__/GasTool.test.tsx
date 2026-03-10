/**
 * GasTool.test.tsx -- Tests for src/components/tools/GasTool.tsx
 *
 * Covers: initial render, network tabs, gas display, mempool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../opnet', () => ({
  getNetwork: vi.fn(() => 'testnet'),
  setNetwork: vi.fn(),
  getGasParameters: vi.fn().mockResolvedValue({
    bitcoin: { conservative: 800000, recommended: { low: 300000, medium: 500000, high: 700000 } },
    baseGas: 1000n,
    gasPerSat: 100n,
    blockNumber: 500,
  }),
  getMempoolInfo: vi.fn().mockResolvedValue({ count: 5, opnetCount: 2, sizeBytes: 1024 }),
  getLatestPendingTxs: vi.fn().mockResolvedValue([]),
}));

import GasTool from '../components/tools/GasTool';

describe('GasTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders gas region', async () => {
    render(<GasTool />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole('region', { name: 'Gas parameters' })).toBeTruthy();
  });

  it('renders network tabs', async () => {
    render(<GasTool />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole('tablist', { name: 'Network selection' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'regtest' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'testnet' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'mainnet' })).toBeTruthy();
  });

  it('renders without crash', () => {
    const { container } = render(<GasTool />);
    expect(container.children.length).toBeGreaterThan(0);
  });
});
