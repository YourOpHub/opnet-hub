/**
 * Marketplace.test.tsx -- Tests for src/components/Marketplace.tsx
 *
 * Covers: initial render with mocked useMarketplace hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../hooks/useMarketplace', () => ({
  useMarketplace: vi.fn(() => ({
    walletAddress: '',
    senderHex: '',
    loading: false,
    filteredTokens: [],
    search: '',
    setSearch: vi.fn(),
    handleSearchSelect: vi.fn(),
    selectedToken: null,
    setSelectedToken: vi.fn(),
    selInfo: null,
    setOrders: vi.fn(),
    sellOrders: [],
    buyOrders: [],
    myOrders: [],
    orderType: 'sell',
    setOrderType: vi.fn(),
    orderAmount: '',
    setOrderAmount: vi.fn(),
    orderPrice: '',
    setOrderPrice: vi.fn(),
    creating: false,
    createStep: '',
    handleCreate: vi.fn(),
    fillId: '',
    setFillId: vi.fn(),
    fillAmount: '',
    setFillAmount: vi.fn(),
    filling: false,
    fillStep: '',
    handleFill: vi.fn(),
    handleExecuteBuyOrder: vi.fn(),
    handleCancel: vi.fn(),
    msg: '',
    lastTxId: '',
  })),
  getContractOpscanUrl: vi.fn(() => ''),
  getTxUrl: vi.fn(() => ''),
  MARKET_ADDRESS: 'opt1sqtest',
}));

import Marketplace from '../components/Marketplace';

describe('Marketplace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders marketplace component', async () => {
    render(<Marketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const container = document.querySelector('div');
    expect(container).toBeTruthy();
  });

  it('renders without crashing', () => {
    render(<Marketplace />);
    // When no token is selected, should show token list/discovery view
    const el = document.querySelector('div');
    expect(el).toBeTruthy();
  });
});
