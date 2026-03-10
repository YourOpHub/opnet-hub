/**
 * LiquidityModal.test.tsx -- Tests for src/components/LiquidityModal.tsx
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
    address: null,
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: {
    formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)),
    expandToDecimals: vi.fn(() => 0n),
  },
}));

vi.mock('../abis', () => ({ POOL_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../txUtils', () => ({
  ensureAllowance: vi.fn().mockResolvedValue(undefined),
  buildTxParams: vi.fn().mockResolvedValue({}),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
  waitForNextBlock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../txHistory', () => ({ addTxRecord: vi.fn() }));
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));
vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(() => ({ current: null })),
}));
vi.mock('../tokenApi', () => ({
  fetchAllTokens: vi.fn().mockResolvedValue([]),
}));

import LiquidityModal from '../components/LiquidityModal';

describe('LiquidityModal', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders when open', async () => {
    const { container } = render(
      <LiquidityModal open={true} onClose={vi.fn()} reserveA={500000} reserveB={25000000} balances={{}} onRefresh={vi.fn()} />
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(container.children.length).toBeGreaterThan(0);
  });
});
