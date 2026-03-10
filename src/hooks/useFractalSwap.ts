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
import { NETWORK, CURRENT_ENV } from '../config';
import { lockOrder, unlockOrder } from '../swapApi';
import { CROSSCHAIN_ADDRESS, CROSSCHAIN_PUBKEY, DEPLOYER_MLDSA_HEX, getContractOpscanUrl } from '../contracts';
import { buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import { SwapDirection, OrderStatus } from '../crosschain/types';
import { sendFractalBTC } from '../wallets/unisat';
import { satsToBtc } from '../components/crosschain/types';
import { buildP2OPScript, getP2OPAddress } from './crossChainShared';
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

      // Encode fractal address as u256
      const addrBytes = new TextEncoder().encode(formMakerAddr);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let fractalAddrU256 = 0n;
      for (let i = 0; i < 32; i++) fractalAddrU256 = (fractalAddrU256 << 8n) | BigInt(padded[i]!);

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

      await (sim as CallResult).sendTransaction(tp);

      if (formRate) saveRate(actualNextId, parseFloat(formRate), formReceiveSats, formAmountSats, sendUnit, receiveUnit);

      const createOpId = `fractalswap:create:${actualNextId}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'fractalswap', orderId: actualNextId,
        direction: formDirection === SwapDirection.BTC_TO_FB ? 'BTC_TO_FB' : 'FB_TO_BTC',
        role: 'maker', step: 'Created, confirming...',
        amounts: { btc: Number(contractBtcAmount).toString(), want: Number(contractWantAmount).toString() },
      });

      setCreateStep('Waiting for confirmation...');
      toast(`Order #${actualNextId} created!${formDirection === SwapDirection.BTC_TO_FB ? ' BTC locked in contract.' : ''} Waiting for block...`, 'success');
      state.setFormAmount('');
      state.setFormReceive('');
      state.setFormMakerAddr('');

      void waitForNextBlock(provider).then(() => {
        setCreateStep('');
        toast(`Order #${actualNextId} confirmed on-chain!`, 'success');
        completeOp(createOpId);
        void fetchOrders();
      }).catch(() => { setCreateStep(''); });
      void fetchOrders();
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

      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]!);

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
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'TX sent, confirming...', amounts: { btc: Number(order.btcAmount).toString() } });
      toast(`Order #${orderId} taken! Fee: ${satsToBtc(feeSats)}.${isFbToBtc ? ' BTC locked.' : ''} Confirming...`, 'success');
      setActioning(null);

      void waitForNextBlock(provider).then(() => {
        completeOp(opId);
        void unlockOrder(lockKey, walletAddress);
        toast(`Order #${orderId} confirmed on-chain!`, 'success');
        void fetchOrders();
      }).catch(() => { completeOp(opId); void unlockOrder(lockKey, walletAddress); });
      void fetchOrders();
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
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      const opId = `fractalswap:complete:${orderId}:${walletAddress}`;
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'BTC claimed, settling...' });
      toast(`Order #${orderId} completed! BTC claimed.`, 'success');
      setActioning(null);

      void waitForNextBlock(provider).then(() => {
        completeOp(opId);
        toast(`Order #${orderId} settled on-chain!`, 'success');
        void fetchOrders();
      }).catch(() => { completeOp(opId); });
      void fetchOrders();
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

      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast(`Order cancelled!${order.direction === SwapDirection.BTC_TO_FB ? ' BTC refunded.' : ''} Confirming...`, 'success');
      setActioning(null);

      void waitForNextBlock(provider).then(() => {
        toast('Cancellation confirmed!', 'success');
        void fetchOrders();
      }).catch(() => {});
      void fetchOrders();
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
      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]!);

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
      await (sim as CallResult).sendTransaction(tp);

      toast(`Order #${orderId} taken! Waiting for block...`, 'success');
      updateOpStep(opId, 'Step 1/3: Waiting for block confirmation...');

      // ── Wait for block confirmation ──
      await waitForNextBlock(provider, (s) => updateOpStep(opId, `Step 1/3: ${s}`), 300_000);
      updateOpStep(opId, 'Step 2/3: Sending Fractal BTC via UniSat...');

      // ── Step 2: Send Fractal BTC via UniSat ──
      const isBtcToFb = order.direction === SwapDirection.BTC_TO_FB;
      const targetHex = isBtcToFb ? order.makerAddr : order.takerAddr;
      const fbAmountSats = order.wantAmount;

      const addrBytesTarget = new Uint8Array(32);
      for (let i = 0; i < 32; i++) addrBytesTarget[i] = parseInt(targetHex.slice(i * 2, i * 2 + 2), 16);
      let end = addrBytesTarget.indexOf(0);
      if (end === -1) end = 32;
      const targetFractalAddr = new TextDecoder().decode(addrBytesTarget.slice(0, end));

      const validPfx = CURRENT_ENV === 'mainnet' ? 'bc1' : 'tb1';
      if (!targetFractalAddr.startsWith(validPfx)) {
        throw new Error(`Invalid Fractal address for ${CURRENT_ENV} (expected ${validPfx}): ${targetFractalAddr}`);
      }

      const txid = await sendFractalBTC(targetFractalAddr, Number(fbAmountSats), 1);
      toast(`FB sent! TX: ${txid.slice(0, 12)}...`, 'success');
      updateOpStep(opId, 'Step 3/3: Claiming locked BTC...');

      // ── Step 3: Complete Order (claim locked BTC) ──
      const market2 = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market2.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim2 = await withRetry(() => market2.completeOrder(BigInt(orderId)));
      if ((sim2 as CallResult).revert) throw new Error(`Revert: ${(sim2 as CallResult).revert}`);

      const tp2 = await buildTxParams(provider, walletAddress);
      (tp2 as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      await (sim2 as CallResult).sendTransaction(tp2);

      updateOpStep(opId, 'Auto-swap complete! Settling...');
      toast(`Order #${orderId} auto-completed! BTC claimed.`, 'success');

      void waitForNextBlock(provider).then(() => {
        completeOp(opId);
        void unlockOrder(lockKey, walletAddress);
        toast(`Order #${orderId} fully settled!`, 'success');
        void fetchOrders();
      }).catch(() => { completeOp(opId); void unlockOrder(lockKey, walletAddress); });
      void fetchOrders();
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

      const addrBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) addrBytes[i] = parseInt(targetHex.slice(i * 2, i * 2 + 2), 16);
      let end = addrBytes.indexOf(0);
      if (end === -1) end = 32;
      const targetFractalAddr = new TextDecoder().decode(addrBytes.slice(0, end));

      const validPfx = CURRENT_ENV === 'mainnet' ? 'bc1' : 'tb1';
      if (!targetFractalAddr.startsWith(validPfx)) {
        throw new Error(`Invalid Fractal address for ${CURRENT_ENV} (expected ${validPfx}): ${targetFractalAddr}`);
      }

      const txid = await sendFractalBTC(targetFractalAddr, Number(fbAmountSats), 1);
      toast(`FB sent! TX: ${txid.slice(0, 12)}...`, 'success');
      updateOpStep(opId, 'Step 2/2: Claiming locked BTC...');

      // ── Step 2: Complete Order ──
      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr ?? undefined);
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{ value: order.btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: myScript, to: walletAddress }],
      });

      const sim = await withRetry(() => market.completeOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: myScript, value: Number(order.btcAmount) }];
      await (sim as CallResult).sendTransaction(tp);

      updateOpStep(opId, 'Auto-claim complete! Settling...');
      toast(`Order #${orderId} completed! BTC claimed.`, 'success');

      void waitForNextBlock(provider).then(() => {
        completeOp(opId);
        toast(`Order #${orderId} fully settled!`, 'success');
        void fetchOrders();
      }).catch(() => completeOp(opId));
      void fetchOrders();
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
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast('Refund sent! BTC returned. Confirming...', 'success');
      setActioning(null);

      void waitForNextBlock(provider).then(() => {
        toast('Refund confirmed!', 'success');
        void fetchOrders();
      }).catch(() => {});
      void fetchOrders();
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
      mldsaHex && o.creator.toLowerCase() === mldsaHex,
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
