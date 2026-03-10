/**
 * CrossChainMarketplace.test.tsx -- Tests for src/components/CrossChainMarketplace.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../hooks/useCrossChain', () => ({
  useCrossChain: vi.fn(() => ({
    walletAddress: '', openConnectModal: vi.fn(),
    unisat: { connected: false, address: '' }, unisatConnecting: false,
    handleConnectUnisat: vi.fn(), handleDisconnectUnisat: vi.fn(),
    loading: false, currentBlock: 100, expandedOrder: null, setExpandedOrder: vi.fn(),
    feeBps: 100, locks: [],
    formDirection: 0, setFormDirection: vi.fn(),
    formAmount: '', setFormAmount: vi.fn(),
    formReceive: '', setFormReceive: vi.fn(),
    formMakerAddr: '', setFormMakerAddr: vi.fn(), setMakerAddrManual: vi.fn(),
    formExpiry: '144', setFormExpiry: vi.fn(),
    creating: false, createStep: '', actionStep: '', actioning: null, msg: '',
    preimageStore: {}, contractReady: true, escrowReady: true,
    activeOrders: [], myOrders: [], totalVolumeSats: 0n,
    availBuyFb: [], availGetBtc: [],
    isMyOrderFn: vi.fn(() => false), isTakerFn: vi.fn(() => false), mldsaHex: '',
    formAmountSats: 0n, formReceiveSats: 0n, formFeeSats: 0n, formRate: '',
    sendUnit: 'BTC', receiveUnit: 'FB',
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
  })),
  resolveToken: vi.fn(() => null),
  getContractOpscanUrl: vi.fn(() => ''),
  isUnisatInstalled: vi.fn(() => false),
  TOKEN_OPTIONS: [], DIR_SELL_TOKEN: 1, DIR_BUY_TOKEN: 2,
}));

import CrossChainMarketplace from '../components/CrossChainMarketplace';

describe('CrossChainMarketplace', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders without crashing', async () => {
    const { container } = render(<CrossChainMarketplace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(container.children.length).toBeGreaterThan(0);
  });
});
