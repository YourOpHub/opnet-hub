/**
 * useTokenEscrow — Token Bridge escrow order business logic
 *
 * Encapsulates:
 *  - handleTbCreate: create token escrow order (SELL/BUY direction)
 *  - handleTbTake: take a token escrow order
 *  - handleTbConfirm: confirm swap with HTLC preimage
 *  - handleTbCancel: cancel token escrow order
 *  - handleTbRefund: refund expired token escrow order
 */

import { useCallback } from 'react';
import { getContract, TransactionOutputFlags, type CallResult, type BaseContractProperties } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { TOKEN_ESCROW_ABI } from '../abis';
import { NETWORK } from '../config';
import { TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_PUBKEY, DEPLOYER_MLDSA_HEX } from '../contracts';
import { buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import { ensureAllowance } from '../txUtils';
import { generateHTLCPair, verifyPreimage, hexToBigInt } from '../crosschain/htlc';
import { buildP2OPScript, getP2OPAddress, DIR_SELL_TOKEN, DIR_BUY_TOKEN, resolveToken, TOKEN_OPTIONS } from './crossChainShared';
import type { CrossChainState } from './useCrossChainState';

export { resolveToken, TOKEN_OPTIONS, DIR_SELL_TOKEN, DIR_BUY_TOKEN };

/** Typed interface for TokenEscrowBridge contract */
interface TokenEscrowContract extends BaseContractProperties {
  createOrder(direction: bigint, token: Address, tokenAmount: bigint, btcPrice: bigint, hashlock: bigint, expiry: bigint, makerAddr: bigint): Promise<CallResult>;
  takeOrder(orderId: bigint, takerAddr: bigint): Promise<CallResult>;
  confirmSwap(orderId: bigint, preimage: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
  refundExpired(orderId: bigint): Promise<CallResult>;
}

export interface TokenEscrowActions {
  handleTbCreate: () => Promise<void>;
  handleTbTake: (orderId: string, takerAddrInput: string) => Promise<void>;
  handleTbConfirm: (orderId: string, preimageHex: string) => Promise<void>;
  handleTbCancel: (orderId: string) => Promise<void>;
  handleTbRefund: (orderId: string) => Promise<void>;
}

export function useTokenEscrow(state: CrossChainState): TokenEscrowActions {
  const {
    walletAddress, senderAddr, openConnectModal,
    provider,
    escrowOrders, feeBps, currentBlock,
    escrowReady,
    tbToken, tbDirection, tbTokenAmount, tbBtcPrice, tbMakerAddr, tbExpiry,
    setTbCreating, setTbStep,
    setActioning, setActionStep,
    fetchEscrowOrders,
    savePreimage,
    toast,
  } = state;

  // ── Create Token Escrow Order ──
  const handleTbCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) { setActionStep('Token Escrow contract not deployed yet'); setTimeout(() => setActionStep(''), 5000); return; }
    if (!tbTokenAmount || !tbBtcPrice || !tbMakerAddr) return;

    const selectedToken = TOKEN_OPTIONS.find(t => t.address === tbToken);
    if (!selectedToken) return;

    const tokenAmountRaw = BigInt(Math.round(parseFloat(tbTokenAmount) * (10 ** selectedToken.decimals)));
    const btcPriceSats = BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8));
    if (tokenAmountRaw <= 0n || btcPriceSats <= 0n) return;

    setTbCreating(true);
    try {
      if (tbDirection === DIR_SELL_TOKEN) {
        const escrowPubkey = TOKEN_ESCROW_PUBKEY.startsWith('0x') ? TOKEN_ESCROW_PUBKEY : '0x' + TOKEN_ESCROW_PUBKEY;
        await ensureAllowance(
          tbToken, escrowPubkey, tokenAmountRaw,
          provider, senderAddr!, walletAddress,
          setTbStep, selectedToken.symbol,
        );
      }

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr ?? undefined);

      setTbStep('Generating HTLC preimage...');
      const { preimage, hashlock } = await generateHTLCPair();
      const hashlockU256 = hexToBigInt(hashlock);
      const expiryU256 = BigInt(currentBlock + parseInt(tbExpiry));

      const addrBytes = new TextEncoder().encode(tbMakerAddr);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let makerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) makerAddrU256 = (makerAddrU256 << 8n) | BigInt(padded[i]!);

      setTbStep('Creating token escrow order...');
      const tokenAddr = Address.fromString(selectedToken.pubkey.replace('0x', ''));
      const sim = await withRetry(() =>
        bridge.createOrder(BigInt(tbDirection), tokenAddr, tokenAmountRaw, btcPriceSats, hashlockU256, expiryU256, makerAddrU256),
      );
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      const nextId = escrowOrders.length > 0 ? Math.max(...escrowOrders.map(o => parseInt(o.id))) + 1 : 1;
      savePreimage(`tb_${nextId}`, preimage);

      toast(`Token escrow order created! ${tbDirection === DIR_SELL_TOKEN ? 'Tokens locked.' : 'Intent posted.'}`, 'success');
      setTbStep('');
      state.setTbTokenAmount('');
      state.setTbBtcPrice('');
      state.setTbMakerAddr('');

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setTbStep(formatTxError(e));
      setTimeout(() => setTbStep(''), 5000);
    } finally { setTbCreating(false); }
  }, [
    walletAddress, senderAddr, tbToken, tbDirection, tbTokenAmount, tbBtcPrice, tbMakerAddr, tbExpiry,
    currentBlock, provider, openConnectModal, escrowReady, escrowOrders, fetchEscrowOrders,
    savePreimage, toast, setTbCreating, setTbStep, setActionStep, state,
  ]);

  // ── Take Token Escrow Order ──
  const handleTbTake = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Taking token escrow order...');
    try {
      const order = escrowOrders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      if (order.direction === DIR_BUY_TOKEN) {
        const tokenInfo = resolveToken(order.tokenHex);
        if (tokenInfo) {
          const escrowPubkey = TOKEN_ESCROW_PUBKEY.startsWith('0x') ? TOKEN_ESCROW_PUBKEY : '0x' + TOKEN_ESCROW_PUBKEY;
          await ensureAllowance(
            tokenInfo.address, escrowPubkey, order.tokenAmount,
            provider, senderAddr!, walletAddress,
            setActionStep, tokenInfo.symbol,
          );
        }
      }

      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]!);

      const rawFee = (order.btcPrice * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr ?? undefined);
      bridge.setTransactionDetails({
        inputs: [],
        outputs: [{ value: feeSats, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeRecipientScript, to: feeRecipientAddress }],
      });

      setActionStep(`Taking order (fee: ${Number(feeSats)} sats)...`);
      const sim = await withRetry(() => bridge.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{ script: feeRecipientScript, value: Number(feeSats) }];
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + 50_000n;
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast(`Order taken! Fee: ${Number(feeSats)} sats.`, 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, escrowOrders, feeBps, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast, setActioning, setActionStep]);

  // ── Confirm Swap (reveal preimage) ──
  const handleTbConfirm = useCallback(async (orderId: string, preimageHex: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Verifying preimage...');
    try {
      const order = escrowOrders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const valid = await verifyPreimage(preimageHex, order.hashlock);
      if (!valid) throw new Error('Invalid preimage');

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr ?? undefined);

      setActionStep('Confirming swap on-chain...');
      const sim = await withRetry(() => bridge.confirmSwap(BigInt(orderId), hexToBigInt(preimageHex)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast('Swap confirmed! Tokens released.', 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, escrowOrders, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast, setActioning, setActionStep]);

  // ── Cancel Order ──
  const handleTbCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Cancelling token escrow order...');
    try {
      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr ?? undefined);
      const sim = await withRetry(() => bridge.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast('Token escrow order cancelled! Tokens returned.', 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast, setActioning, setActionStep]);

  // ── Refund Expired ──
  const handleTbRefund = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Refunding expired token escrow...');
    try {
      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr ?? undefined);
      const sim = await withRetry(() => bridge.refundExpired(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast('Refund sent! Tokens returned.', 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast, setActioning, setActionStep]);

  return {
    handleTbCreate,
    handleTbTake,
    handleTbConfirm,
    handleTbCancel,
    handleTbRefund,
  };
}
