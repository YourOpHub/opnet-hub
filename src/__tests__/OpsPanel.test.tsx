/**
 * OpsPanel.test.tsx -- Tests for src/components/OpsPanel.tsx
 *
 * Covers: FAB button, panel open/close, active/ops/activity tabs, empty states, op cards
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockDismiss = vi.fn();
const mockOps = {
  activeOps: [] as Array<{ id: string; market: string; orderId: string; direction: string; role: string; step: string; status: string; error?: string; updatedAt: number }>,
  historyOps: [] as Array<{ id: string; market: string; orderId: string; direction: string; role: string; step: string; status: string; error?: string; updatedAt: number }>,
  activeCount: 0,
  dismissOp: mockDismiss,
  trackOp: vi.fn(),
  completeOp: vi.fn(),
  failOp: vi.fn(),
  updateOpStep: vi.fn(),
};

vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => mockOps),
}));

vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(() => ({ current: null })),
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({ walletAddress: null })),
}));

vi.mock('../contracts', () => ({
  getTxUrl: vi.fn((txid: string) => `https://opscan.org/transactions/${txid}`),
}));

vi.mock('../txHistory', () => ({
  getTxHistory: vi.fn(() => []),
  formatTimeAgo: vi.fn(() => '1m ago'),
}));

import OpsPanel from '../components/OpsPanel';

describe('OpsPanel', () => {
  beforeEach(() => {
    mockOps.activeOps = [];
    mockOps.historyOps = [];
    mockOps.activeCount = 0;
    mockDismiss.mockClear();
  });

  it('renders FAB button', () => {
    render(<OpsPanel />);
    expect(screen.getByRole('button', { name: /Activity/ })).toBeTruthy();
  });

  it('FAB shows badge when active ops', () => {
    mockOps.activeCount = 3;
    render(<OpsPanel />);
    const fab = screen.getByRole('button', { name: /3 active/ });
    expect(fab).toBeTruthy();
  });

  it('panel is hidden initially', () => {
    render(<OpsPanel />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens panel on FAB click', () => {
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
    expect(screen.getByText('Activity')).toBeTruthy();
  });

  it('shows empty active state', () => {
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByText('No active operations')).toBeTruthy();
  });

  it('switches to ops tab', () => {
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    fireEvent.click(screen.getByText(/^Ops/));
    expect(screen.getByText('No completed operations yet')).toBeTruthy();
  });

  it('switches to activity tab', () => {
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    fireEvent.click(screen.getByText(/TX Log/));
    expect(screen.getByText('Connect wallet to see TX history')).toBeTruthy();
  });

  it('renders active op card', () => {
    mockOps.activeOps = [{
      id: 'test1', market: 'swap', orderId: '1',
      direction: 'BTC_TO_FB', role: 'maker', step: 'Simulating...',
      status: 'active', updatedAt: Date.now(),
    }];
    mockOps.activeCount = 1;
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByText('Swap')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('Simulating...')).toBeTruthy();
  });

  it('renders history op card with dismiss', () => {
    mockOps.historyOps = [{
      id: 'hist1', market: 'mint', orderId: 'MINE',
      direction: '', role: '', step: 'Done',
      status: 'completed', updatedAt: Date.now(),
    }];
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    fireEvent.click(screen.getByText(/^Ops/));
    expect(screen.getByText('Mint')).toBeTruthy();
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss operation' });
    fireEvent.click(dismissBtn);
    expect(mockDismiss).toHaveBeenCalledWith('hist1');
  });

  it('renders failed op with error', () => {
    mockOps.activeOps = [];
    mockOps.historyOps = [{
      id: 'fail1', market: 'fractalswap', orderId: '#5',
      direction: '', role: '', step: 'Failed',
      status: 'failed', error: 'Reverted: insufficient balance',
      updatedAt: Date.now(),
    }];
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    fireEvent.click(screen.getByText(/^Ops/));
    expect(screen.getByText('FractalSwap')).toBeTruthy();
    expect(screen.getByText('Reverted: insufficient balance')).toBeTruthy();
  });

  it('closes panel with close button', () => {
    render(<OpsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByRole('dialog').getAttribute('aria-hidden')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Close activity panel' }));
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-hidden')).toBe('true');
  });
});
