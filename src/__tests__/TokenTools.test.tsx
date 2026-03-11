/**
 * TokenTools.test.tsx -- Tests for src/components/TokenTools.tsx
 *
 * Covers: tab navigation, ConverterTool, UTXOViewer, FaucetTool render
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1test',
    address: null,
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: { formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)) },
}));

vi.mock('../abis', () => ({ MINTABLE_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../opnet', () => ({
  getUTXOs: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(0n),
  getBlockHeight: vi.fn().mockResolvedValue(100),
  getBlockByNumber: vi.fn().mockResolvedValue(null),
  getGasParameters: vi.fn().mockResolvedValue(null),
  getMempoolInfo: vi.fn().mockResolvedValue(null),
  getLatestPendingTxs: vi.fn().mockResolvedValue([]),
  getTransaction: vi.fn().mockResolvedValue(null),
  getTransactionReceipt: vi.fn().mockResolvedValue(null),
}));
vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({ usd: 95000, usd_24h_change: 1 }),
}));
vi.mock('../txUtils', () => ({
  buildTxParams: vi.fn().mockResolvedValue({}),
  formatTxError: vi.fn((e: unknown) => String(e)),
}));
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));
vi.mock('../tokenApi', () => ({
  fetchAllTokens: vi.fn().mockResolvedValue([]),
  formatTokenBalance: vi.fn((v: string) => v),
}));

import TokenTools from '../components/TokenTools';

describe('TokenTools', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders header and tab bar', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/OPNet Developer Tools/)).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Developer tools' })).toBeTruthy();
  });

  it('converter tab shows by default', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Converter has BTC/sats input mode radio
    expect(screen.getByRole('radiogroup', { name: 'Input mode' })).toBeTruthy();
    expect(screen.getByText('BTC input')).toBeTruthy();
    expect(screen.getByText('Sats input')).toBeTruthy();
  });

  it('converter shows BTC amount input', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('BTC amount')).toBeTruthy();
  });

  it('converter switches to sats mode', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.click(screen.getByText('Sats input'));
    expect(screen.getByLabelText('Satoshis amount')).toBeTruthy();
  });

  it('converter has quick presets', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('0.001 BTC')).toBeTruthy();
    expect(screen.getByText('1 BTC')).toBeTruthy();
  });

  it('switches to UTXO viewer tab', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Tab text includes icon: "📦 UTXO Viewer"
    const utxoTab = screen.getByRole('tab', { name: /UTXO Viewer/i });
    fireEvent.click(utxoTab);
    expect(screen.getByLabelText(/Bitcoin.*address/i)).toBeTruthy();
  });

  it('switches to TX Lookup tab', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const txTab = screen.getByRole('tab', { name: /TX Lookup/i });
    fireEvent.click(txTab);
    expect(screen.getByLabelText(/transaction hash/i)).toBeTruthy();
  });

  it('switches to Faucet tab', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const faucetTab = screen.getByRole('tab', { name: /Faucet/i });
    fireEvent.click(faucetTab);
    // Should show MINE/VIBE mint options (multiple elements contain "MINE" text)
    const mineElements = screen.getAllByText(/MINE/);
    expect(mineElements.length).toBeGreaterThanOrEqual(1);
  });

  it('sets localStorage when tools used', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(localStorage.getItem('hub_tools_used')).toBe('1');
  });

  it('has multiple tabs', async () => {
    render(<TokenTools />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(7); // 7 tool tabs (explorer removed)
  });
});
