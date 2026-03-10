/**
 * useCrossChain — composition hook
 *
 * Combines:
 *  - useCrossChainState: shared state, polling, derived state
 *  - useFractalSwap: FractalSwap order business logic
 *  - useTokenEscrow: Token Bridge escrow order business logic
 *
 * All types, constants, and utility functions that were previously
 * defined here are now in crossChainShared.ts and re-exported below
 * for backward compatibility with existing consumers.
 */

import { useCrossChainState } from './useCrossChainState';
import { useFractalSwap } from './useFractalSwap';
import { useTokenEscrow } from './useTokenEscrow';

// ── Re-exports for backward compatibility ──
export {
  TOKEN_OPTIONS,
  DIR_SELL_TOKEN,
  DIR_BUY_TOKEN,
  resolveToken,
  buildP2OPScript,
  getP2OPAddress,
  type BridgeMode,
  type TokenEscrowOrder,
} from './crossChainShared';

export { getContractOpscanUrl } from '../contracts';
export { isUnisatInstalled } from '../wallets/unisat';

export function useCrossChain() {
  const state = useCrossChainState();
  const fractal = useFractalSwap(state);
  const escrow = useTokenEscrow(state);

  return {
    // Wallet state
    walletAddress: state.walletAddress,
    openConnectModal: state.openConnectModal,
    unisat: state.unisat,
    unisatConnecting: state.unisatConnecting,
    handleConnectUnisat: state.handleConnectUnisat,
    handleDisconnectUnisat: state.handleDisconnectUnisat,
    mldsaHex: state.mldsaHex,

    // FractalSwap order state
    orders: state.orders,
    loading: state.loading,
    currentBlock: state.currentBlock,
    expandedOrder: state.expandedOrder,
    setExpandedOrder: state.setExpandedOrder,
    feeBps: state.feeBps,
    locks: state.locks,

    // Create form state
    formDirection: state.formDirection,
    setFormDirection: state.setFormDirection,
    formAmount: state.formAmount,
    setFormAmount: state.setFormAmount,
    formReceive: state.formReceive,
    setFormReceive: state.setFormReceive,
    formMakerAddr: state.formMakerAddr,
    setFormMakerAddr: state.setFormMakerAddr,
    setMakerAddrManual: state.setMakerAddrManual,
    formExpiry: state.formExpiry,
    setFormExpiry: state.setFormExpiry,
    creating: state.creating,
    createStep: state.createStep,

    // Action state
    actionStep: state.actionStep,
    actioning: state.actioning,
    msg: state.msg,

    // Preimage store
    preimageStore: state.preimageStore,

    // Contract readiness
    contractReady: state.contractReady,
    escrowReady: state.escrowReady,

    // FractalSwap derived state
    activeOrders: state.activeOrders,
    myOrders: state.myOrders,
    otherOpenOrders: state.otherOpenOrders,
    totalVolumeSats: state.totalVolumeSats,
    availBuyFb: state.availBuyFb,
    availGetBtc: state.availGetBtc,
    isMyOrderFn: state.isMyOrderFn,
    isTakerFn: state.isTakerFn,

    // Computed form values
    formAmountSats: state.formAmountSats,
    formReceiveSats: state.formReceiveSats,
    formFeeSats: state.formFeeSats,
    formRate: state.formRate,
    sendUnit: state.sendUnit,
    receiveUnit: state.receiveUnit,
    expiryOpts: state.expiryOpts,

    // FractalSwap handlers
    fetchOrders: state.fetchOrders,
    handleCreate: fractal.handleCreate,
    handleTake: fractal.handleTake,
    handleTakeAndSwap: fractal.handleTakeAndSwap,
    handleComplete: fractal.handleComplete,
    handleSendAndClaim: fractal.handleSendAndClaim,
    handleCancel: fractal.handleCancel,
    handleRefund: fractal.handleRefund,

    // Token Bridge state
    escrowOrders: state.escrowOrders,
    escrowLoading: state.escrowLoading,
    tbToken: state.tbToken,
    setTbToken: state.setTbToken,
    tbDirection: state.tbDirection,
    setTbDirection: state.setTbDirection,
    tbTokenAmount: state.tbTokenAmount,
    setTbTokenAmount: state.setTbTokenAmount,
    tbBtcPrice: state.tbBtcPrice,
    setTbBtcPrice: state.setTbBtcPrice,
    tbMakerAddr: state.tbMakerAddr,
    setTbMakerAddr: state.setTbMakerAddr,
    tbExpiry: state.tbExpiry,
    setTbExpiry: state.setTbExpiry,
    tbCreating: state.tbCreating,
    tbStep: state.tbStep,

    // Token Bridge derived state
    activeEscrowOrders: state.activeEscrowOrders,
    sellTokenOrders: state.sellTokenOrders,
    buyTokenOrders: state.buyTokenOrders,
    selectedTbToken: state.selectedTbToken,
    tbTokenAmountRaw: state.tbTokenAmountRaw,
    tbBtcPriceSats: state.tbBtcPriceSats,
    tbFeeSats: state.tbFeeSats,

    // Token Bridge handlers
    handleTbCreate: escrow.handleTbCreate,
    handleTbTake: escrow.handleTbTake,
    handleTbConfirm: escrow.handleTbConfirm,
    handleTbCancel: escrow.handleTbCancel,
    handleTbRefund: escrow.handleTbRefund,
  };
}
