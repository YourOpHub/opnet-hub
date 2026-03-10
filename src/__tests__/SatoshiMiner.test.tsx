/**
 * SatoshiMiner.test.tsx -- Tests for src/components/SatoshiMiner.tsx
 *
 * Covers: initial render, game state, upgrade display, click mechanic
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: '',
    address: null,
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: { formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)) },
}));

vi.mock('../abis', () => ({ MINTABLE_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../txUtils', () => ({
  buildTxParams: vi.fn().mockResolvedValue({}),
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(1000),
}));
vi.mock('../api', () => ({
  submitScore: vi.fn().mockResolvedValue({ ok: true }),
  getLeaderboard: vi.fn().mockResolvedValue([]),
}));
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));

import SatoshiMiner from '../components/SatoshiMiner';

describe('SatoshiMiner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the mine button', () => {
    render(<SatoshiMiner />);
    const mineBtn = screen.getByRole('button', { name: /Mine satoshis/i });
    expect(mineBtn).toBeTruthy();
  });

  it('shows upgrade cards', () => {
    render(<SatoshiMiner />);
    expect(screen.getByText('WASM Compiler')).toBeTruthy();
    expect(screen.getByText('Consensus Node')).toBeTruthy();
  });

  it('shows achievements list', () => {
    render(<SatoshiMiner />);
    expect(screen.getByRole('list', { name: 'Achievements' })).toBeTruthy();
  });

  it('clicking mine button increments score', () => {
    render(<SatoshiMiner />);
    const mineBtn = screen.getByRole('button', { name: /Mine satoshis/i });
    act(() => { fireEvent.click(mineBtn); });
    // After clicking, sats should increase
    // The text should show at least "1" somewhere
    const satsTexts = screen.getAllByText(/^1$/);
    expect(satsTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the epoch miner heading', () => {
    render(<SatoshiMiner />);
    expect(screen.getByText(/Epoch Miner/)).toBeTruthy();
  });

  it('mine button label includes per-click info', () => {
    render(<SatoshiMiner />);
    const mineBtn = screen.getByRole('button', { name: /per click/ });
    expect(mineBtn).toBeTruthy();
  });

  it('renders upgrade categories', () => {
    render(<SatoshiMiner />);
    // ML-DSA Signer and Epoch Miner upgrades exist
    expect(screen.getByText('ML-DSA Signer')).toBeTruthy();
    expect(screen.getByText('Epoch Miner')).toBeTruthy();
  });
});
