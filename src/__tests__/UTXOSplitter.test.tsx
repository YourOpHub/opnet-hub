/**
 * UTXOSplitter.test.tsx -- Tests for src/components/tools/UTXOSplitter.tsx
 *
 * Covers: initial render with mocked dependencies
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../opnet', () => ({
  getUTXOs: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(0n),
}));

vi.mock('opnet', () => ({ getContract: vi.fn() }));
vi.mock('../abis', () => ({ SPLITTER_DUMMY_ABI: [] }));
vi.mock('../txUtils', () => ({
  buildTxParams: vi.fn().mockResolvedValue({}),
  formatTxError: vi.fn((e: unknown) => String(e)),
  waitForNextBlock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/useTokenTools', () => ({
  useTokenTools: vi.fn(() => ({
    walletAddress: '',
    senderAddr: null,
    openConnectModal: vi.fn(),
    provider: {},
    trackOp: vi.fn(),
    completeOp: vi.fn(),
    failOp: vi.fn(),
  })),
}));

import UTXOSplitter from '../components/tools/UTXOSplitter';

describe('UTXOSplitter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders without crashing', async () => {
    const { container } = render(<UTXOSplitter />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(container.children.length).toBeGreaterThan(0);
  });
});
