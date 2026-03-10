/**
 * TXLookup.test.tsx -- Tests for src/components/tools/TXLookup.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGetTransaction = vi.fn().mockResolvedValue(null);
const mockGetTransactionReceipt = vi.fn().mockResolvedValue(null);
const mockGetLatestPendingTxs = vi.fn().mockResolvedValue([]);

vi.mock('../opnet', () => ({
  getTransaction: (...args: unknown[]) => mockGetTransaction(...args),
  getTransactionReceipt: (...args: unknown[]) => mockGetTransactionReceipt(...args),
  getLatestPendingTxs: (...args: unknown[]) => mockGetLatestPendingTxs(...args),
}));

import TXLookup from '../components/tools/TXLookup';

describe('TXLookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTransaction.mockResolvedValue(null);
    mockGetTransactionReceipt.mockResolvedValue(null);
    mockGetLatestPendingTxs.mockResolvedValue([]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders transaction lookup region', async () => {
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('region', { name: /Transaction lookup/ })).toBeTruthy();
  });

  it('renders input and lookup button', async () => {
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByLabelText(/transaction hash/)).toBeTruthy();
    expect(screen.getByText('Lookup')).toBeTruthy();
  });

  it('shows error for not found transaction', async () => {
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const input = screen.getByLabelText(/transaction hash/);
    fireEvent.change(input, { target: { value: 'abc123' } });
    fireEvent.click(screen.getByText('Lookup'));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Transaction not found/)).toBeTruthy();
  });

  it('shows transaction data when found', async () => {
    mockGetTransaction.mockResolvedValue({ hash: 'abc123', blockNumber: 42 });
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const input = screen.getByLabelText(/transaction hash/);
    fireEvent.change(input, { target: { value: 'abc123' } });
    fireEvent.click(screen.getByText('Lookup'));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Transaction')).toBeTruthy();
  });

  it('shows receipt data when found', async () => {
    mockGetTransactionReceipt.mockResolvedValue({ status: 'confirmed', gasUsed: 100 });
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const input = screen.getByLabelText(/transaction hash/);
    fireEvent.change(input, { target: { value: 'def456' } });
    fireEvent.click(screen.getByText('Lookup'));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Receipt')).toBeTruthy();
  });

  it('shows pending txs when available', async () => {
    mockGetLatestPendingTxs.mockResolvedValue([
      { hash: 'pending1hash1234567890abcdef' },
    ]);
    render(<TXLookup />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText(/Recent Pending/)).toBeTruthy();
  });
});
