/**
 * TokenExplorer.test.tsx -- Tests for src/components/tools/TokenExplorer.tsx
 *
 * Covers: initial render, token lookup UI
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(100),
  callContract: vi.fn().mockResolvedValue(null),
  getTokenTotalSupply: vi.fn().mockResolvedValue(0n),
}));

// Mock fetch for OPScan API
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: vi.fn().mockResolvedValue({ results: [] }),
}) as unknown as typeof fetch;

import TokenExplorer from '../components/tools/TokenExplorer';

describe('TokenExplorer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders without crashing', async () => {
    const { container } = render(<TokenExplorer />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('has address input', async () => {
    render(<TokenExplorer />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const inputs = document.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });
});
