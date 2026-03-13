/**
 * useFractalSwap — FractalSwap order business logic
 *
 * Encapsulates:
 *  - handleCreate: create BTC↔FB order with optional BTC escrow output
 *  - handleTake: take an order, pay fee, optionally lock BTC
 *  - handleTakeAndSwap: take + send FB + complete in one flow
 *  - handleSendAndClaim: send FB + complete for already-taken orders
 *  - handleComplete: complete order, claim locked BTC
 *  - handleCancel: cancel order, refund BTC if needed
 *  - handleRefund: refund expired order
 *  - Auto-trigger FB send when FB_TO_BTC order transitions Open → Taken
 */

import { useCallback } from 'react';
import { getContract, TransactionOutputFlags, type CallResult, type BaseContractProperties } from 'opnet';
import { FRACTALSWAP_ABI } from '../abis';
import { NETWORK } from '../config';
import { lockOrder, unlockOrder } from '../swapApi';
import { CROSSCHAIN_ADDRESS, CROSSCHAIN_PUBKEY, DEPLOYER_MLDSA_HEX, getContractOpscanUrl, getTxUrl } from '../contracts';
import { buildTxParams, withRetry, formatTxError, waitForTxConfirmation, waitForNextBlock, emitBalanceRefresh } from '../txUtils';
import { SwapDirection } from '../crosschain/types';
import { sendFractalBTC } from '../wallets/unisat';
import { satsToBtc } from '../components/crosschain/types';
import { buildP2OPScript, getP2OPAddress, encodeFractalAddr, decodeFractalAddr } from './crossChainShared';
import type { CrossChainState } from './useCrossChainState';

// Re-export for child components
export { getContractOpscanUrl };

/** Typed interface for FractalSwap v8 contract (partial fills) */
interface FractalSwapContract extends BaseContractProperties {
  createOrder(direction: bigint, btcAmount: bigint, wantAmount: bigint, expiry: bigint, fractalAddr: bigint): Promise<CallResult>;
  takeOrder(orderId: bigint, takerAddr: bigint, fillBtcAmount: bigint): Promise<CallResult>;
  completeOrder(orderId: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
  refundExpired(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
}

export interface FractalSwapActions {
  handleCreate: () => Promise<void>;
  handleTakeAndSwap: (orderId: string, takerAddrInput: string, fillBtcAmount?: bigint) => Promise<void>;
  handleSendAndClaim: (orderId: string) => Promise<void>;
  handleComplete: (orderId: string) => Promise<void>;
  handleCancel: (orderId: string) => Promise<void>;
  handleRefund: (orderId: string) => Promise<void>;
}

/**
 * FractalSwap order business logic: create, take, complete, cancel, and refund BTC/FB orders.
 * @param state - Shared cross-chain state from useCrossChainState.
 * @returns Handler functions for each order lifecycle action.
 */
export function useFractalSwap(state: CrossChainState): FractalSwapActions {
  const {
    walletAddress, senderAddr, openConnectModal,
    provider, unisat,
    orders, feeBps, currentBlock,
    contractReady,
    formAmount, formReceive, formMakerAddr, formExpiry,
    formAmountSats, formReceiveSats, formRate,
    setCreating, setCreateStep,
    setActioning, setActionStep, setMsg,
    fetchOrders,
    saveRate,
    trackOp, updateOpStep, completeOp, failOp,
    toast,
  } = state;

  /** Contract P2OP script (for BTC locking) */
  const contractMldsaHex = CROSSCHAIN_PUBKEY.replace('0x', '');
  const contractP2OPScript = buildP2OPScript(contractMldsaHex);

  /** Get caller's P2OP script from senderAddr */
  const getMyP2OPScript = useCallback((): Buffer => {
    if (!senderAddr) throw new Error('Wallet not connected');
    const hex = String(senderAddr).replace('0x', '');
    return buildP2OPScript(hex.slice(0, 64));
  }, [senderAddr]);

  // ── Create Order ──
  const handleCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) { setMsg('Contract not deployed yet'); setTimeout(() => setMsg(''), 5000); return; }
    if (!formAmount || !formMakerAddr || !formReceive) return;
    if (formAmountSats <= 0n || formReceiveSats <= 0n) return;

    setCreating(true);
    try {
      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);

      setCreateStep('Checking order ID...');
      const nextIdResult = await market.getNextOrderId();
      const nextIdProps = nextIdResult?.properties as Record<string, bigint> | undefined;
      const actualNextId = String(Number(nextIdProps?.nextOrderId ?? 1n));

      const expiryU256 = BigInt(currentBlock + parseInt(formExpiry));

      // Encode fractal address as u256 (P2TR witness program = 32 bytes)
      const fractalAddrU256 = encodeFractalAddr(formMakerAddr);

      // BTC_TO_FB only: maker locks BTC, wants FB
      const contractBtcAmount = formAmountSats;
      const contractWantAmount = formReceiveSats;

      market.setTransactionDetails({
        inputs: [],
        outputs: [{
          value: contractBtcAmount,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: contractP2OPScript,
          to: CROSSCHAIN_ADDRESS,
        }],
      });

      setCreateStep('Creating order...');
      const sim = await withRetry(() =>
        market.createOrder(BigInt(SwapDirection.BTC_TO_FB), contractBtcAmount, contractWantAmount, expiryU256, fractalAddrU256),
      );
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);

      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: contractP2OPScript,
        value: Number(contractBtcAmount),
      }];
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = contractBtcAmount + 50_000n;

      const createRcpt = await (sim as CallResult).sendTransaction(tp);
      const createTxId = (createRcpt as { transactionId?: string })?.transactionId || '';
      const createTxLink = createTxId ? { url: getTxUrl(createTxId), label: 'View TX' } : undefined;

      if (formRate) saveRate(actualNextId, parseFloat(formRate), formReceiveSats, formAmountSats, 'BTC', 'FB');

      const createdPayLabel = `${satsToBtc(contractBtcAmount)} BTC`;
      const createdGetLabel = `${satsToBtc(contractWantAmount)} FB`;
      const createOpId = `fractalswap:create:${actualNextId}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'fractalswap', orderId: actualNextId,
        direction: 'BTC_TO_FB',
        role: 'maker', step: `Lock ${createdPayLabel} \u2192 Get ${createdGetLabel}`,
        amounts: { btc: Number(contractBtcAmount).toString(), want: Number(contractWantAmount).toString(), pay: createdPayLabel, get: createdGetLabel },
      });
      setCreateStep('Waiting for confirmation...');
      toast(`Order #${actualNextId} created! Lock ${createdPayLabel} → Get ${createdGetLabel}. BTC locked. Waiting for block...`, 'success', createTxLink);
      state.setFormAmount('');
      state.setFormReceive('');
      state.setFormMakerAddr('');

      setCreateStep('');
      // Background: confirm TX, then complete op and refresh
      void waitForTxConfirmation(createTxId).then(() => { completeOp(createOpId); emitBalanceRefresh(); void fetchOrders(); }).catch(() => { completeOp(createOpId); });
    } catch (e) {
      setCreateStep(formatTxError(e));
      setTimeout(() => setCreateStep(''), 5000);
    } finally { setCreating(false); }
  }, [
    walletAddress, senderAddr, formAmount, formMakerAddr, formReceive, formExpiry,
    formAmountSats, formReceiveSats, currentBlock, provider, openConnectModal, contractReady,
    fetchOrders, toast, formRate, saveRate, contractP2OPScript,
    trackOp, completeOp, setCreating, setCreateStep, setMsg, state,
  ]);

  // ── Complete Order ──
  const handleComplete = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Completing order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      setActionStep('Completing swap — claiming locked BTC...');
      const sim = await withRetry(() => market.completeOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      const completeRcpt = await (sim as CallResult).sendTransaction(tp);
      const completeTxId = (completeRcpt as { transactionId?: string })?.transactionId || '';
      const completeTxLink = completeTxId ? { url: getTxUrl(completeTxId), label: 'View TX' } : undefined;

      const opId = `fractalswap:complete:${orderId}:${walletAddress}`;
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'BTC claimed, confirming...' });
      toast(`Order #${orderId} complete TX sent! Confirming...`, 'success', completeTxLink);
      setActionStep('');
      // Background: confirm TX, then complete op and refresh
      void waitForTxConfirmation(completeTxId).then(() => { completeOp(opId); emitBalanceRefresh(); void fetchOrders(); }).catch(() => { completeOp(opId); });
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, trackOp, completeOp, getMyP2OPScript, setActioning, setActionStep, toast]);

  // ── Cancel Order ──
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Cancelling order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      // v8: refund only remaining BTC (btcAmount - filledBtc)
      const remaining = order.btcAmount - (order.filledBtc ?? 0n);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      if (remaining > 0n) {
        market.setTransactionDetails({
          inputs: [],
          outputs: [{ value: remaining, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
        });
      }

      const sim = await withRetry(() => market.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      if (remaining > 0n) {
        (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(remaining) }];
      }

      const cancelRcpt = await (sim as CallResult).sendTransaction(tp);
      const cancelTxId = (cancelRcpt as { transactionId?: string })?.transactionId || '';
      const cancelTxLink = cancelTxId ? { url: getTxUrl(cancelTxId), label: 'View TX' } : undefined;

      toast(`Order cancelled! ${remaining > 0n ? `${satsToBtc(remaining)} BTC refunded.` : 'No BTC to refund.'}`, 'success', cancelTxLink);
      setActionStep('');
      // Background: confirm TX, then refresh
      void waitForTxConfirmation(cancelTxId).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript, setActioning, setActionStep, toast]);

  // ── Take + Send FB + Complete (auto-swap) — v8: supports partial fills ──
  const handleTakeAndSwap = useCallback(async (orderId: string, takerAddrInput: string, fillBtcAmount?: bigint) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!unisat.connected) { toast('Connect UniSat wallet first to send Fractal BTC', 'warning'); return; }
    if (!contractReady) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // v8: determine fill amount — 0n = full take of remaining
    const remaining = order.btcAmount - (order.filledBtc ?? 0n);
    const actualFillBtc = (fillBtcAmount && fillBtcAmount > 0n) ? fillBtcAmount : 0n; // 0n = contract fills remaining
    const effectiveBtc = actualFillBtc > 0n ? actualFillBtc : remaining;
    const effectiveFb = (order.wantAmount * effectiveBtc) / order.btcAmount;
    const isPartial = actualFillBtc > 0n && actualFillBtc < remaining;

    const lockKey = `fractalswap:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    const opId = `fractalswap:${orderId}:${walletAddress}`;
    setActioning(orderId);
    trackOp({
      id: opId, market: 'fractalswap', orderId,
      direction: order.direction === SwapDirection.BTC_TO_FB ? 'BTC_TO_FB' : 'FB_TO_BTC',
      role: 'taker', step: `Step 1/3: Taking order${isPartial ? ' (partial)' : ''} on OPNet...`,
      amounts: { btc: effectiveBtc.toString(), want: effectiveFb.toString() },
    });

    try {
      // ── Step 1: Take Order on OPNet ──
      const takerAddrU256 = encodeFractalAddr(takerAddrInput);

      // Fee is proportional to actual fill amount
      const rawFee = (effectiveBtc * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      // BTC_TO_FB: taker only pays fee (no BTC lock needed)
      market.setTransactionDetails({
        inputs: [],
        outputs: [
          { value: feeSats, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeRecipientScript, to: feeRecipientAddress },
        ],
      });

      const sim = await withRetry(() => market.takeOrder(BigInt(orderId), takerAddrU256, actualFillBtc));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      // v8: get fillOrderId from response (child orderId for partial fills, parent for full)
      const simProps = (sim as CallResult).properties as Record<string, bigint> | undefined;
      const fillOrderId = simProps?.fillOrderId ?? BigInt(orderId);
      const fillOrderIdStr = String(Number(fillOrderId));

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: feeRecipientScript, value: Number(feeSats) }];
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + 50_000n;
      const tasRcpt = await (sim as CallResult).sendTransaction(tp);
      const tasTxId = (tasRcpt as { transactionId?: string })?.transactionId || '';
      const tasTxLink = tasTxId ? { url: getTxUrl(tasTxId), label: 'View TX' } : undefined;

      const payLabel = `${satsToBtc(effectiveFb)} FB`;
      const getLabel = `${satsToBtc(effectiveBtc)} BTC`;
      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] Take #${orderId}${isPartial ? ` (partial→#${fillOrderIdStr})` : ''}: BTC→FB, fill=${effectiveBtc}, want=${effectiveFb}, fee=${feeSats}`);
      toast(`Order #${orderId} ${isPartial ? 'partially ' : ''}taken! Send ${payLabel} → Get ${getLabel}. Fee: ${Number(feeSats)} sats.`, 'success', tasTxLink);
      updateOpStep(opId, `Step 1/3: Send ${payLabel} → Get ${getLabel}. Confirming...`);

      // ── Wait for take TX confirmation (up to 15 min for testnet) ──
      await waitForTxConfirmation(tasTxId, (s) => updateOpStep(opId, `Step 1/3: ${s}`), 900_000);

      // ── Step 2: Send Fractal BTC via UniSat to maker's Fractal address ──
      const targetHex = order.makerAddr;
      const targetFractalAddr = decodeFractalAddr(targetHex);
      if (!targetFractalAddr) {
        throw new Error('No Fractal address stored for this order');
      }

      updateOpStep(opId, `Step 2/3: Sending ${satsToBtc(effectiveFb)} FB to ${targetFractalAddr.slice(0, 12)}...`);
      const txid = await sendFractalBTC(targetFractalAddr, Number(effectiveFb), 1);
      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] FB sent: ${Number(effectiveFb)} sats to ${targetFractalAddr}, txid=${txid}`);
      toast(`FB sent (${satsToBtc(effectiveFb)})! Now claiming ${satsToBtc(effectiveBtc)} BTC...`, 'success');

      // ── Step 3: Complete Order (claim locked BTC) — use fillOrderId (child or parent) ──
      updateOpStep(opId, 'Step 3/3: Waiting for take confirmation before claiming...');
      await waitForNextBlock(provider, (s) => updateOpStep(opId, `Step 3/3: ${s}`));

      updateOpStep(opId, `Step 3/3: Claiming ${satsToBtc(effectiveBtc)} BTC from escrow...`);
      const market2 = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market2.setTransactionDetails({
        inputs: [],
        outputs: [{ value: effectiveBtc, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim2 = await withRetry(() => market2.completeOrder(fillOrderId), 3, 5000);
      if ((sim2 as CallResult).revert) throw new Error(`Revert: ${(sim2 as CallResult).revert}`);

      const tp2 = await buildTxParams(provider, walletAddress);
      (tp2 as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(effectiveBtc) }];
      const tasCompleteRcpt = await (sim2 as CallResult).sendTransaction(tp2);
      const tasCompleteTxId = (tasCompleteRcpt as { transactionId?: string })?.transactionId || '';
      const tasCompleteTxLink = tasCompleteTxId ? { url: getTxUrl(tasCompleteTxId), label: 'View TX' } : undefined;

      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] Complete #${fillOrderIdStr}: claimed ${Number(effectiveBtc)} sats BTC`);
      void unlockOrder(lockKey, walletAddress);
      toast(`Order #${fillOrderIdStr} settling! Paid ${satsToBtc(effectiveFb)} FB, claiming ${satsToBtc(effectiveBtc)} BTC... Confirming...`, 'success', tasCompleteTxLink);
      // Background: confirm TX, then complete op and refresh
      void waitForTxConfirmation(tasCompleteTxId).then(() => { completeOp(opId); emitBalanceRefresh(); void fetchOrders(); }).catch(() => { completeOp(opId); });
    } catch (e) {
      failOp(opId, formatTxError(e));
      void unlockOrder(lockKey, walletAddress);
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 8000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, feeBps, provider, unisat.connected, openConnectModal, contractReady, fetchOrders, toast, trackOp, updateOpStep, completeOp, failOp, contractP2OPScript, getMyP2OPScript, setActioning, setActionStep]);

  // ── Send FB + Complete (for already-taken orders) ──
  const handleSendAndClaim = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!unisat.connected) { toast('Connect UniSat wallet first', 'warning'); return; }
    if (!contractReady) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const opId = `fractalswap:claim:${orderId}:${walletAddress}`;
    setActioning(orderId);
    trackOp({ id: opId, market: 'fractalswap', orderId, direction: 'BTC_TO_FB', role: 'taker', step: 'Step 1/2: Sending FB...' });

    try {
      // ── Step 1: Send FB to maker's Fractal address ──
      const targetHex = order.makerAddr;
      const fbAmountSats = order.wantAmount;

      const targetFractalAddr = decodeFractalAddr(targetHex);
      if (!targetFractalAddr) {
        throw new Error('No Fractal address stored for this order');
      }

      const txid = await sendFractalBTC(targetFractalAddr, Number(fbAmountSats), 1);
      toast(`FB sent! TX: ${txid.slice(0, 12)}...`, 'success');
      updateOpStep(opId, 'Step 2/2: Claiming locked BTC...');

      // ── Step 2: Complete Order (wait for take to be fully confirmed) ──
      await waitForNextBlock(provider, (s) => updateOpStep(opId, `Confirming take... ${s}`));

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim = await withRetry(() => market.completeOrder(BigInt(orderId)), 3, 5000);
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      const sacRcpt = await (sim as CallResult).sendTransaction(tp);
      const sacTxId = (sacRcpt as { transactionId?: string })?.transactionId || '';
      const sacTxLink = sacTxId ? { url: getTxUrl(sacTxId), label: 'View TX' } : undefined;

      toast(`Order #${orderId} settling! Confirming...`, 'success', sacTxLink);
      // Background: confirm TX, then complete op and refresh
      void waitForTxConfirmation(sacTxId).then(() => { completeOp(opId); emitBalanceRefresh(); void fetchOrders(); }).catch(() => { completeOp(opId); });
    } catch (e) {
      failOp(opId, formatTxError(e));
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 8000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, unisat.connected, openConnectModal, contractReady, fetchOrders, toast, trackOp, updateOpStep, completeOp, failOp, getMyP2OPScript, setActioning, setActionStep]);

  // ── Refund Expired ──
  const handleRefund = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Refunding expired order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim = await withRetry(() => market.refundExpired(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      const refundRcpt = await (sim as CallResult).sendTransaction(tp);
      const refundTxId = (refundRcpt as { transactionId?: string })?.transactionId || '';
      const refundTxLink = refundTxId ? { url: getTxUrl(refundTxId), label: 'View TX' } : undefined;

      toast('Refund sent! BTC returned.', 'success', refundTxLink);
      setActionStep('');
      // Background: confirm TX, then refresh
      void waitForTxConfirmation(refundTxId).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript, setActioning, setActionStep, toast]);

  return {
    handleCreate,
    handleTakeAndSwap,
    handleSendAndClaim,
    handleComplete,
    handleCancel,
    handleRefund,
  };
}
