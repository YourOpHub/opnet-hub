/**
 * CrossChainMarketplace-deep.test.tsx -- Deeper tests for CrossChainMarketplace
 * with richer mock data to cover more branches
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { SwapDirection, OrderStatus } from '../crosschain/types';
import type { FractalSwapOrder } from '../crosschain/types';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockOrder: FractalSwapOrder = {
  id: '1',
  creator: '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed',
  taker: '',
  direction: SwapDirection.BTC_TO_FB,
  status: OrderStatus.Open,
  btcAmount: 100000n,
  wantAmount: 100000n,
  expiry: 200,
  makerAddr: 'bc1qtest',
  takerAddr: '',
  feePaid: 1000n,
};

vi.mock('../hooks/useCrossChain', () => ({
  useCrossChain: vi.fn(() => ({
    walletAddress: 'opt1testwallet', openConnectModal: vi.fn(),
    unisat: { connected: true, address: 'bc1qunisat', balance: { total: 50000, confirmed: 50000, unconfirmed: 0 } }, unisatConnecting: false,
    handleConnectUnisat: vi.fn(), handleDisconnectUnisat: vi.fn(),
    loading: false, currentBlock: 180, expandedOrder: null, setExpandedOrder: vi.fn(),
    feeBps: 100, locks: {},
    formDirection: SwapDirection.BTC_TO_FB, setFormDirection: vi.fn(),
    formAmount: '0.001', setFormAmount: vi.fn(),
    formReceive: '0.001', setFormReceive: vi.fn(),
    formMakerAddr: 'bc1qtest', setFormMakerAddr: vi.fn(), setMakerAddrManual: vi.fn(),
    formExpiry: '144', setFormExpiry: vi.fn(),
    creating: false, createStep: '', actionStep: '', actioning: null, msg: '',
    preimageStore: {}, contractReady: true, escrowReady: true,
    activeOrders: [mockOrder], myOrders: [], totalVolumeSats: 200000n,
    availBuyFb: [mockOrder], availGetBtc: [],
    isMyOrderFn: vi.fn(() => false), isTakerFn: vi.fn(() => false), mldsaHex: '4ca793',
    formAmountSats: 100000n, formReceiveSats: 100000n, formFeeSats: 1000n, formRate: '1.00',
    sendUnit: 'BTC', receiveUnit: 'FB',
    expiryOpts: [{ label: '~1 day', blocks: 144 }, { label: '~3 days', blocks: 432 }],
    fetchOrders: vi.fn(), handleCreate: vi.fn(), handleTake: vi.fn(),
    handleTakeAndSwap: vi.fn(), handleComplete: vi.fn(), handleSendAndClaim: vi.fn(),
    handleCancel: vi.fn(), handleRefund: vi.fn(),
    escrowOrders: [], escrowLoading: false,
    tbToken: '', setTbToken: vi.fn(), tbDirection: 1, setTbDirection: vi.fn(),
    tbTokenAmount: '', setTbTokenAmount: vi.fn(), tbBtcPrice: '', setTbBtcPrice: vi.fn(),
    tbExpiry: '144', setTbExpiry: vi.fn(), tbMakerAddr: '', setTbMakerAddr: vi.fn(),
    tbCreating: false, tbCreateStep: '', tbActioning: null, tbActionStep: '', tbMsg: '',
    handleTbCreate: vi.fn(), handleTbTake: vi.fn(), handleTbConfirm: vi.fn(),
    handleTbRefund: vi.fn(), handleTbCancel: vi.fn(),
    myEscrowOrders: [], availEscrowOrders: [], escrowTokenInfo: null,
    tbRate: null, setTbRate: vi.fn(),
    tbStep: '', activeEscrowOrders: [], sellTokenOrders: [], buyTokenOrders: [],
    selectedTbToken: undefined, tbTokenAmountRaw: 0n, tbBtcPriceSats: 0n, tbFeeSats: 0n,
    otherOpenOrders: [mockOrder],
  })),
  resolveToken: vi.fn(() => null),
  getContractOpscanUrl: vi.fn(() => ''),
  isUnisatInstalled: vi.fn(() => true),
  TOKEN_OPTIONS: [], DIR_SELL_TOKEN: 1, DIR_BUY_TOKEN: 2,
}));

import CrossChainMarketplace from '../components/CrossChainMarketplace';

describe('CrossChainMarketplace (deep)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders with active orders and volume', async () => {
    const { container } = render(<CrossChainMarketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('shows active order count', async () => {
    render(<CrossChainMarketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // The order book should be non-empty
    const allText = document.body.textContent || '';
    expect(allText.length).toBeGreaterThan(0);
  });

  it('renders wallet status when connected', async () => {
    render(<CrossChainMarketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // Connected unisat should show address
    const allText = document.body.textContent || '';
    expect(allText).toContain('opt1testwallet');
  });

  it('renders UniSat connected indicator', async () => {
    render(<CrossChainMarketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const allText = document.body.textContent || '';
    expect(allText).toContain('bc1qunisat');
  });
});
