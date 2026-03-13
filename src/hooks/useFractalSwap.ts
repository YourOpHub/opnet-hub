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

import { useCallback, useEffect, useRef } from 'react';
import { getContract, TransactionOutputFlags, type CallResult, type BaseContractProperties } from 'opnet';
import { FRACTALSWAP_ABI } from '../abis';
import { NETWORK } from '../config';
import { lockOrder, unlockOrder } from '../swapApi';
import { CROSSCHAIN_ADDRESS, CROSSCHAIN_PUBKEY, DEPLOYER_MLDSA_HEX, getContractOpscanUrl, getTxUrl } from '../contracts';
import { buildTxParams, withRetry, formatTxError, waitForNextBlock, emitBalanceRefresh } from '../txUtils';
import { SwapDirection, OrderStatus } from '../crosschain/types';
import { sendFractalBTC } from '../wallets/unisat';
import { satsToBtc } from '../components/crosschain/types';
import { buildP2OPScript, getP2OPAddress, encodeFractalAddr, decodeFractalAddr } from './crossChainShared';
import type { CrossChainState } from './useCrossChainState';

// Re-export for child components
export { getContractOpscanUrl };

/** Typed interface for FractalSwap v6 contract */
interface FractalSwapContract extends BaseContractProperties {
  createOrder(direction: bigint, btcAmount: bigint, wantAmount: bigint, expiry: bigint, fractalAddr: bigint): Promise<CallResult>;
  takeOrder(orderId: bigint, takerAddr: bigint): Promise<CallResult>;
  completeOrder(orderId: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
  refundExpired(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
}

export interface FractalSwapActions {
  handleCreate: () => Promise<void>;
  handleTake: (orderId: string, takerAddrInput: string) => Promise<void>;
  handleTakeAndSwap: (orderId: string, takerAddrInput: string) => Promise<void>;
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
    walletAddress, senderAddr, openConnectModal, mldsaHex,
    provider, unisat,
    orders, feeBps, currentBlock,
    contractReady,
    formDirection, formAmount, formReceive, formMakerAddr, formExpiry,
    formAmountSats, formReceiveSats, formRate, sendUnit, receiveUnit,
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

      const contractBtcAmount = formDirection === SwapDirection.BTC_TO_FB ? formAmountSats : formReceiveSats;
      const contractWantAmount = formDirection === SwapDirection.BTC_TO_FB ? formReceiveSats : formAmountSats;

      if (formDirection === SwapDirection.BTC_TO_FB) {
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
      }

      setCreateStep('Creating order...');
      const sim = await withRetry(() =>
        market.createOrder(BigInt(formDirection), contractBtcAmount, contractWantAmount, expiryU256, fractalAddrU256),
      );
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);

      if (formDirection === SwapDirection.BTC_TO_FB) {
        (tp as unknown as Record<string, unknown>).extraOutputs = [{
          script: contractP2OPScript,
          value: Number(contractBtcAmount),
        }];
        (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = contractBtcAmount + 50_000n;
      }

      const createRcpt = await (sim as CallResult).sendTransaction(tp);
      const createTxId = (createRcpt as { transactionId?: string })?.transactionId || '';
      const createTxLink = createTxId ? { url: getTxUrl(createTxId), label: 'View TX' } : undefined;

      if (formRate) saveRate(actualNextId, parseFloat(formRate), formReceiveSats, formAmountSats, sendUnit, receiveUnit);

      const createdPayLabel = formDirection === SwapDirection.BTC_TO_FB ? `${satsToBtc(contractBtcAmount)} BTC` : `${satsToBtc(contractWantAmount)} FB`;
      const createdGetLabel = formDirection === SwapDirection.BTC_TO_FB ? `${satsToBtc(contractWantAmount)} FB` : `${satsToBtc(contractBtcAmount)} BTC`;
      const createOpId = `fractalswap:create:${actualNextId}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'fractalswap', orderId: actualNextId,
        direction: formDirection === SwapDirection.BTC_TO_FB ? 'BTC_TO_FB' : 'FB_TO_BTC',
        role: 'maker', step: `Pay ${createdPayLabel} \u2192 Get ${createdGetLabel}`,
        amounts: { btc: Number(contractBtcAmount).toString(), want: Number(contractWantAmount).toString(), pay: createdPayLabel, get: createdGetLabel },
      });
      setCreateStep('Waiting for confirmation...');
      toast(`Order #${actualNextId} created! Pay ${createdPayLabel} → Get ${createdGetLabel}.${formDirection === SwapDirection.BTC_TO_FB ? ' BTC locked.' : ''} Waiting for block...`, 'success', createTxLink);
      state.setFormAmount('');
      state.setFormReceive('');
      state.setFormMakerAddr('');

      completeOp(createOpId);
      setCreateStep('');
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
    } catch (e) {
      setCreateStep(formatTxError(e));
      setTimeout(() => setCreateStep(''), 5000);
    } finally { setCreating(false); }
  }, [
    walletAddress, senderAddr, formAmount, formMakerAddr, formReceive, formDirection, formExpiry,
    formAmountSats, formReceiveSats, currentBlock, provider, openConnectModal, contractReady,
    fetchOrders, toast, formRate, saveRate, contractP2OPScript, sendUnit, receiveUnit,
    trackOp, completeOp, setCreating, setCreateStep, setMsg, state,
  ]);

  // ── Take Order ──
  const handleTake = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;

    const lockKey = `fractalswap:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    setActioning(orderId); setActionStep('Taking order...');
    const opId = `fractalswap:${orderId}:${walletAddress}`;
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const takerAddrU256 = encodeFractalAddr(takerAddrInput);

      const rawFee = (order.btcAmount * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);

      const isFbToBtc = order.direction === SwapDirection.FB_TO_BTC;
      const txOutputs: Array<{ value: bigint; index: number; flags: number; scriptPubKey: Buffer; to: string }> = [
        { value: feeSats, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeRecipientScript, to: feeRecipientAddress },
      ];
      if (isFbToBtc) {
        txOutputs.push({ value: order.btcAmount, index: 2, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: contractP2OPScript, to: CROSSCHAIN_ADDRESS });
      }
      market.setTransactionDetails({ inputs: [], outputs: txOutputs });

      setActionStep(`Taking order (fee: ${Number(feeSats)} sats${isFbToBtc ? ` + locking ${satsToBtc(order.btcAmount)}` : ''})...`);
      const sim = await withRetry(() => market.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      const extraOuts: Array<{ script: Buffer; value: number }> = [{ script: feeRecipientScript, value: Number(feeSats) }];
      if (isFbToBtc) extraOuts.push({ script: contractP2OPScript, value: Number(order.btcAmount) });
      (tp as unknown as Record<string, unknown>).extraOutputs = extraOuts;
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + (isFbToBtc ? order.btcAmount : 0n) + 50_000n;
      const takeRcpt = await (sim as CallResult).sendTransaction(tp);
      const takeTxId = (takeRcpt as { transactionId?: string })?.transactionId || '';
      const takeTxLink = takeTxId ? { url: getTxUrl(takeTxId), label: 'View TX' } : undefined;

      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'TX sent, confirming...', amounts: { btc: Number(order.btcAmount).toString() } });
      toast(`Order #${orderId} taken! Fee: ${satsToBtc(feeSats)}.${isFbToBtc ? ' BTC locked.' : ''} Waiting for block...`, 'success', takeTxLink);

      completeOp(opId);
      void unlockOrder(lockKey, walletAddress);
      setActionStep('');
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
      return;
    } catch (e) {
      failOp(opId, formatTxError(e));
      void unlockOrder(lockKey, walletAddress);
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, feeBps, provider, openConnectModal, contractReady, fetchOrders, toast, trackOp, completeOp, failOp, contractP2OPScript, setActioning, setActionStep]);

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
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'BTC claimed, settling...' });
      completeOp(opId);
      toast(`Order #${orderId} completed!`, 'success', completeTxLink);
      setActionStep('');
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
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

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);

      if (order.direction === SwapDirection.BTC_TO_FB) {
        const myScript = getMyP2OPScript();
        market.setTransactionDetails({
          inputs: [],
          outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
        });
      }

      const sim = await withRetry(() => market.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);

      if (order.direction === SwapDirection.BTC_TO_FB) {
        const myScript = getMyP2OPScript();
        (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      }

      const cancelRcpt = await (sim as CallResult).sendTransaction(tp);
      const cancelTxId = (cancelRcpt as { transactionId?: string })?.transactionId || '';
      const cancelTxLink = cancelTxId ? { url: getTxUrl(cancelTxId), label: 'View TX' } : undefined;

      toast(`Order cancelled!${order.direction === SwapDirection.BTC_TO_FB ? ' BTC refunded.' : ''}`, 'success', cancelTxLink);
      setActionStep('');
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript, setActioning, setActionStep, toast]);

  // ── Take + Send FB + Complete (auto-swap) ──
  const handleTakeAndSwap = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!unisat.connected) { toast('Connect UniSat wallet first to send Fractal BTC', 'warning'); return; }
    if (!contractReady) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const lockKey = `fractalswap:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    const opId = `fractalswap:${orderId}:${walletAddress}`;
    setActioning(orderId);
    trackOp({
      id: opId, market: 'fractalswap', orderId,
      direction: order.direction === SwapDirection.BTC_TO_FB ? 'BTC_TO_FB' : 'FB_TO_BTC',
      role: 'taker', step: 'Step 1/3: Taking order on OPNet...',
      amounts: { btc: order.btcAmount.toString(), want: order.wantAmount.toString() },
    });

    try {
      // ── Step 1: Take Order on OPNet ──
      const takerAddrU256 = encodeFractalAddr(takerAddrInput);

      const rawFee = (order.btcAmount * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const isFbToBtc = order.direction === SwapDirection.FB_TO_BTC;
      const txOutputs: Array<{ value: bigint; index: number; flags: number; scriptPubKey: Buffer; to: string }> = [
        { value: feeSats, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeRecipientScript, to: feeRecipientAddress },
      ];
      if (isFbToBtc) {
        txOutputs.push({ value: order.btcAmount, index: 2, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: contractP2OPScript, to: CROSSCHAIN_ADDRESS });
      }
      market.setTransactionDetails({ inputs: [], outputs: txOutputs });

      const sim = await withRetry(() => market.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      const extraOuts: Array<{ script: Buffer; value: number }> = [{ script: feeRecipientScript, value: Number(feeSats) }];
      if (isFbToBtc) extraOuts.push({ script: contractP2OPScript, value: Number(order.btcAmount) });
      (tp as unknown as Record<string, unknown>).extraOutputs = extraOuts;
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + (isFbToBtc ? order.btcAmount : 0n) + 50_000n;
      const tasRcpt = await (sim as CallResult).sendTransaction(tp);
      const tasTxId = (tasRcpt as { transactionId?: string })?.transactionId || '';
      const tasTxLink = tasTxId ? { url: getTxUrl(tasTxId), label: 'View TX' } : undefined;

      const isBtcToFb = order.direction === SwapDirection.BTC_TO_FB;
      const payLabel = isBtcToFb ? `${satsToBtc(order.wantAmount)} FB` : `${satsToBtc(order.btcAmount)} BTC`;
      const getLabel = isBtcToFb ? `${satsToBtc(order.btcAmount)} BTC` : `${satsToBtc(order.wantAmount)} FB`;
      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] Take #${orderId}: direction=${isBtcToFb ? 'BTC→FB' : 'FB→BTC'}, btcAmount=${order.btcAmount}, wantAmount=${order.wantAmount}, fee=${feeSats}`);
      toast(`Order #${orderId} taken! Pay ${payLabel} → Get ${getLabel}. Fee: ${Number(feeSats)} sats.`, 'success', tasTxLink);
      updateOpStep(opId, `Step 1/3: Pay ${payLabel} → Get ${getLabel}. Confirming...`);

      // ── Wait for block confirmation (up to 15 min for testnet) ──
      await waitForNextBlock(provider, (s) => updateOpStep(opId, `Step 1/3: ${s}`), 900_000);

      // ── Step 2: Send Fractal BTC via UniSat ──
      const targetHex = isBtcToFb ? order.makerAddr : order.takerAddr;
      const fbAmountSats = order.wantAmount;

      const targetFractalAddr = decodeFractalAddr(targetHex);
      if (!targetFractalAddr) {
        throw new Error('No Fractal address stored for this order');
      }

      updateOpStep(opId, `Step 2/3: Sending ${satsToBtc(fbAmountSats)} FB to ${targetFractalAddr.slice(0, 12)}...`);
      const txid = await sendFractalBTC(targetFractalAddr, Number(fbAmountSats), 1);
      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] FB sent: ${Number(fbAmountSats)} sats to ${targetFractalAddr}, txid=${txid}`);
      toast(`FB sent (${satsToBtc(fbAmountSats)})! Now claiming ${satsToBtc(order.btcAmount)} BTC...`, 'success');

      // ── Step 3: Complete Order (claim locked BTC) ──
      // Wait for block to ensure takeOrder is fully confirmed before completing
      updateOpStep(opId, 'Step 3/3: Waiting for take confirmation before claiming...');
      await waitForNextBlock(provider, (s) => updateOpStep(opId, `Step 3/3: ${s}`));

      updateOpStep(opId, `Step 3/3: Claiming ${satsToBtc(order.btcAmount)} BTC from escrow...`);
      const market2 = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market2.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim2 = await withRetry(() => market2.completeOrder(BigInt(orderId)), 3, 5000);
      if ((sim2 as CallResult).revert) throw new Error(`Revert: ${(sim2 as CallResult).revert}`);

      const tp2 = await buildTxParams(provider, walletAddress);
      (tp2 as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      const tasCompleteRcpt = await (sim2 as CallResult).sendTransaction(tp2);
      const tasCompleteTxId = (tasCompleteRcpt as { transactionId?: string })?.transactionId || '';
      const tasCompleteTxLink = tasCompleteTxId ? { url: getTxUrl(tasCompleteTxId), label: 'View TX' } : undefined;

      // eslint-disable-next-line no-console
      console.log(`[FractalSwap] Complete #${orderId}: claimed ${Number(order.btcAmount)} sats BTC`);
      completeOp(opId);
      void unlockOrder(lockKey, walletAddress);
      toast(`Order #${orderId} fully settled! Paid ${satsToBtc(fbAmountSats)} FB, got ${satsToBtc(order.btcAmount)} BTC`, 'success', tasCompleteTxLink);
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
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
    trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: order.direction === SwapDirection.BTC_TO_FB ? 'taker' : 'maker', step: 'Step 1/2: Sending FB...' });

    try {
      // ── Step 1: Send FB ──
      const isBtcToFb = order.direction === SwapDirection.BTC_TO_FB;
      const targetHex = isBtcToFb ? order.makerAddr : order.takerAddr;
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

      completeOp(opId);
      toast(`Order #${orderId} fully settled!`, 'success', sacTxLink);
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
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
      // Background: refresh after next block
      void waitForNextBlock(provider).then(() => { emitBalanceRefresh(); void fetchOrders(); }).catch(() => {});
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript, setActioning, setActionStep, toast]);

  // ── Auto-send FB when maker's FB_TO_BTC order transitions Open → Taken ──
  const prevOrderStatusesRef = useRef<Record<string, OrderStatus>>({});
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;
  const unisatRef = useRef(unisat);
  unisatRef.current = unisat;
  const handleSendAndClaimRef = useRef(handleSendAndClaim);
  handleSendAndClaimRef.current = handleSendAndClaim;
  const actioningRef = useRef(state.actioning);
  actioningRef.current = state.actioning;

  useEffect(() => {
    const prev = prevOrderStatusesRef.current;
    const next: Record<string, OrderStatus> = {};
    for (const o of orders) next[o.id] = o.status;

    for (const order of orders) {
      if (order.direction !== SwapDirection.FB_TO_BTC) continue;
      if (order.status !== OrderStatus.Taken) continue;
      if (prev[order.id] !== OrderStatus.Open) continue;
      if (!mldsaHex || order.creator.toLowerCase() !== mldsaHex) continue;
      if (actioningRef.current) continue;

      if (unisatRef.current.connected) {
        toast(`Auto-sending FB for order #${order.id}...`, 'info');
        setTimeout(() => handleSendAndClaimRef.current(order.id), 500);
      } else {
        toast('Your order was taken! Connect UniSat to send FB & claim BTC', 'warning');
      }
    }

    prevOrderStatusesRef.current = next;
  }, [orders, toast, mldsaHex]);

  // Auto-trigger when UniSat connects: check for pending Taken FB_TO_BTC orders
  const prevUnisatConnected = useRef(unisat.connected);
  useEffect(() => {
    const wasConnected = prevUnisatConnected.current;
    prevUnisatConnected.current = unisat.connected;
    if (wasConnected || !unisat.connected) return;

    const wa = walletAddressRef.current;
    if (!wa) return;
    if (actioningRef.current) return;

    const myTakenFbToBtc = orders.find(o =>
      o.direction === SwapDirection.FB_TO_BTC &&
      o.status === OrderStatus.Taken &&
      mldsaHex !== '' && o.creator.toLowerCase() === mldsaHex,
    );
    if (myTakenFbToBtc) {
      toast(`Auto-sending FB for order #${myTakenFbToBtc.id}...`, 'info');
      setTimeout(() => handleSendAndClaimRef.current(myTakenFbToBtc.id), 500);
    }
  }, [unisat.connected, orders, toast, mldsaHex]);

  return {
    handleCreate,
    handleTake,
    handleTakeAndSwap,
    handleSendAndClaim,
    handleComplete,
    handleCancel,
    handleRefund,
  };
}
