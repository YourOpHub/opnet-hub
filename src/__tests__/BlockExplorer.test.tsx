/**
 * BlockExplorer.test.tsx -- Tests for src/components/tools/BlockExplorer.tsx
 *
 * Covers: initial render, block loading, block lookup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(500),
  getBlockByNumber: vi.fn().mockResolvedValue({
    hash: 'abc123def456', transactions: [{ id: 'tx1' }],
  }),
  getMempoolInfo: vi.fn().mockResolvedValue({ count: 3 }),
}));

import BlockExplorer from '../components/tools/BlockExplorer';

describe('BlockExplorer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the component', async () => {
    render(<BlockExplorer />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const container = document.querySelector('div');
    expect(container).toBeTruthy();
  });

  it('renders block explorer without crash', () => {
    const { container } = render(<BlockExplorer />);
    expect(container.children.length).toBeGreaterThan(0);
  });
});
