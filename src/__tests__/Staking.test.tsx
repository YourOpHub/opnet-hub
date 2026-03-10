/**
 * Staking.test.tsx -- Tests for src/components/Staking.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: '',
    walletInstance: null,
    openConnectModal: vi.fn(),
    publicKey: null,
    hashedMLDSAKey: null,
    address: null,
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: {
    formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)),
    expandToDecimals: vi.fn(() => 0n),
  },
}));

vi.mock('../abis', () => ({ STAKING_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../txUtils', () => ({
  ensureAllowance: vi.fn().mockResolvedValue(undefined),
  buildTxParams: vi.fn().mockResolvedValue({}),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../opnet', () => ({
  getBalance: vi.fn().mockResolvedValue(0n),
  getBlockHeight: vi.fn().mockResolvedValue(100),
  getTokenBalance: vi.fn().mockResolvedValue(0n),
}));

vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));

vi.mock('../txHistory', () => ({ addTxRecord: vi.fn() }));

import Staking from '../components/Staking';

describe('Staking', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders staking component', async () => {
    const { container } = render(<Staking />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(container.children.length).toBeGreaterThan(0);
  });
});
