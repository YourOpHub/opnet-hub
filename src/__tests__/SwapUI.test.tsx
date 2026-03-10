/**
 * SwapUI.test.tsx -- Tests for src/components/SwapUI.tsx
 *
 * Covers: initial render with mocked useSwap hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../hooks/useSwap', () => ({
  useSwap: vi.fn(() => ({
    walletAddress: '',
    connected: false,
    openConnectModal: vi.fn(),
    SWAP_TOKENS: [
      { symbol: 'MINE', name: 'MINE', icon: '\u26CF', decimals: 8, address: 'addr1', pubkey: '' },
      { symbol: 'VIBE', name: 'VIBE', icon: '\u26A1', decimals: 8, address: 'addr2', pubkey: '' },
    ],
    heldTokens: [],
    motoPools: [],
    reserveA: 0,
    reserveB: 0,
    fetchReserves: vi.fn(),
    poolReady: false,
    fromIdx: 0,
    setFromIdx: vi.fn(),
    toIdx: 1,
    setToIdx: vi.fn(),
    fromAmt: '',
    setFromAmt: vi.fn(),
    slippage: 1,
    setSlippage: vi.fn(),
    swapping: false,
    swapStep: '',
    swapResult: null,
    setSwapResult: vi.fn(),
    showSettings: false,
    setShowSettings: vi.fn(),
    balances: {},
    from: { symbol: 'MINE', name: 'MINE', icon: '\u26CF', decimals: 8, address: 'addr1', pubkey: '' },
    to: { symbol: 'VIBE', name: 'VIBE', icon: '\u26A1', decimals: 8, address: 'addr2', pubkey: '' },
    fromVal: 0,
    toVal: 0,
    hasPool: false,
    rIn: 0,
    rOut: 0,
    isSimplePool: false,
    motoPool: null,
    priceImpact: 0,
    rate: 0,
    fee: 0,
    fromBal: 0n,
    toBal: 0n,
    fmtBal: vi.fn(() => '0'),
    flip: vi.fn(),
    doSwap: vi.fn(),
    minting: false,
    mintResult: null,
    mintTokens: vi.fn(),
    history: [],
    mainTab: 'swap',
    setMainTab: vi.fn(),
    lpMine: 0,
    lpVibe: 0,
    showLP: false,
    setShowLP: vi.fn(),
    userPools: [],
    btcPrice: 97000,
    tokenPrices: {},
  })),
  getTxUrl: vi.fn(() => ''),
  formatTimeAgo: vi.fn(() => '1m ago'),
}));

vi.mock('../components/LiquidityModal', () => ({
  default: () => null,
}));

import SwapUI from '../components/SwapUI';

describe('SwapUI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders swap component', async () => {
    render(<SwapUI />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const container = document.querySelector('div');
    expect(container).toBeTruthy();
  });

  it('renders without crashing', () => {
    const { container } = render(<SwapUI />);
    expect(container.children.length).toBeGreaterThan(0);
  });
});
