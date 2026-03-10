/**
 * OpsContext.test.tsx -- Tests for src/contexts/OpsContext.tsx (OpsProvider)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGetActiveOps = vi.fn().mockResolvedValue([]);
const mockGetHistory = vi.fn().mockResolvedValue([]);
const mockUpdateSwapOp = vi.fn().mockResolvedValue(undefined);

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1testwallet',
  })),
}));

vi.mock('../swapApi', () => ({
  updateSwapOp: (...args: unknown[]) => mockUpdateSwapOp(...args),
  getActiveOps: (...args: unknown[]) => mockGetActiveOps(...args),
  getHistory: (...args: unknown[]) => mockGetHistory(...args),
}));

import { OpsProvider, useOps } from '../contexts/OpsContext';

function TestConsumer() {
  const ctx = useOps();
  return (
    <div>
      <span data-testid="active">{ctx.activeCount}</span>
      <span data-testid="hist">{ctx.historyOps.length}</span>
      <button data-testid="track" onClick={() => ctx.trackOp({
        id: 'op1', market: 'mint', orderId: 'T1', direction: 'buy',
        role: 'maker', step: 'Minting...',
      })}>Track</button>
      <button data-testid="complete" onClick={() => ctx.completeOp('op1')}>Complete</button>
      <button data-testid="fail" onClick={() => ctx.failOp('op1', 'oops')}>Fail</button>
      <button data-testid="dismiss" onClick={() => ctx.dismissOp('op1')}>Dismiss</button>
      <button data-testid="update" onClick={() => ctx.updateOpStep('op1', 'Step 2')}>Update</button>
      <button data-testid="track-server" onClick={() => ctx.trackOp({
        id: 'op2', market: 'fractalswap', orderId: '#1', direction: 'BTC_TO_FB',
        role: 'maker', step: 'Creating...',
      })}>TrackServer</button>
    </div>
  );
}

describe('OpsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetActiveOps.mockResolvedValue([]);
    mockGetHistory.mockResolvedValue([]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('provides default values', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(screen.getByTestId('hist').textContent).toBe('0');
  });

  it('trackOp adds an active op', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track').click(); });
    expect(screen.getByTestId('active').textContent).toBe('1');
  });

  it('completeOp moves op to history', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track').click(); });
    expect(screen.getByTestId('active').textContent).toBe('1');
    await act(async () => { screen.getByTestId('complete').click(); });
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(screen.getByTestId('hist').textContent).toBe('1');
  });

  it('failOp moves op to history with error', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track').click(); });
    await act(async () => { screen.getByTestId('fail').click(); });
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(screen.getByTestId('hist').textContent).toBe('1');
  });

  it('dismissOp removes op entirely', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track').click(); });
    await act(async () => { screen.getByTestId('dismiss').click(); });
    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(screen.getByTestId('hist').textContent).toBe('0');
  });

  it('updateOpStep updates the step', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track').click(); });
    await act(async () => { screen.getByTestId('update').click(); });
    // Op is still active
    expect(screen.getByTestId('active').textContent).toBe('1');
  });

  it('server-synced market calls updateSwapOp', async () => {
    render(<OpsProvider><TestConsumer /></OpsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { screen.getByTestId('track-server').click(); });
    expect(mockUpdateSwapOp).toHaveBeenCalled();
  });
});
