import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract, ABIDataTypes, BitcoinAbiTypes,
  TransactionOutputFlags,
  type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import {
  CROSSCHAIN_ADDRESS, DEPLOYER_MLDSA_HEX,
  getContractOpscanUrl,
} from '../contracts';
import { SUPPORTED_CHAINS, suggestedExpiryBlocks } from '../crosschain/chains';
import {
  generateHTLCPair, verifyPreimage, truncateHex, formatBlockCountdown,
  hexToBigInt,
} from '../crosschain/htlc';
import {
  type FractalSwapOrder, OrderStatus, SwapDirection, MAKER_STEPS, TAKER_STEPS,
} from '../crosschain/types';
import TxStepIndicator from './TxStepIndicator';
import {
  type UnisatWalletState,
  isUnisatInstalled, connectUnisat, disconnectUnisat,
  sendFractalBTC, getFractalTxUrl, getFractalAddressUrl,
} from '../wallets/unisat';

/** FractalSwap ABI — matches new contract methods */
const FRACTALSWAP_ABI: BitcoinInterfaceAbi = [
  {
    name: 'createOrder', type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'amount', type: ABIDataTypes.UINT256 },
      { name: 'hashlock', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'makerAddr', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'takeOrder', type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'confirmSwap', type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'preimage', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'cancelOrder', type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'refundExpired', type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'getOrder', type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'status', type: ABIDataTypes.UINT256 },
      { name: 'creator', type: ABIDataTypes.UINT256 },
      { name: 'taker', type: ABIDataTypes.UINT256 },
      { name: 'amount', type: ABIDataTypes.UINT256 },
      { name: 'hashlock', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'makerAddr', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
      { name: 'preimage', type: ABIDataTypes.UINT256 },
      { name: 'feePaid', type: ABIDataTypes.UINT256 },
    ],
  },
  {
    name: 'getNextOrderId', type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'getFeeInfo', type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [
      { name: 'feeRecipient', type: ABIDataTypes.UINT256 },
      { name: 'feeBps', type: ABIDataTypes.UINT256 },
    ],
  },
];

const ZERO_HEX = '0'.repeat(64);
const fractalChain = SUPPORTED_CHAINS[0]; // Fractal Bitcoin

/** Status badge config */
const STATUS_COLORS: Record<number, { bg: string; text: string; label: string }> = {
  [OrderStatus.Open]: { bg: 'rgba(34,197,94,.15)', text: '#22c55e', label: 'Open' },
  [OrderStatus.Taken]: { bg: 'rgba(245,158,11,.15)', text: '#f59e0b', label: 'Taken' },
  [OrderStatus.Confirmed]: { bg: 'rgba(59,130,246,.15)', text: '#3b82f6', label: 'Confirmed' },
  [OrderStatus.Cancelled]: { bg: 'rgba(107,114,128,.15)', text: '#6b7280', label: 'Cancelled' },
  [OrderStatus.Refunded]: { bg: 'rgba(239,68,68,.15)', text: '#ef4444', label: 'Refunded' },
};

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '.7rem', fontWeight: 600, color: 'var(--t2)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em',
};

const btnSmall: React.CSSProperties = {
  background: 'rgba(255,255,255,.08)', color: 'var(--t2)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '4px 10px', fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
};

/** Build P2OP scriptPubKey from 64-char MLDSA hex */
function buildP2OPScript(mldsaHex: string): Buffer {
  const bytes = new Uint8Array(34);
  bytes[0] = 0x60; // OP_16
  bytes[1] = 0x20; // PUSH_32
  for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Buffer.from(bytes);
}

/** Get P2OP bech32m address from 64-char MLDSA hex */
function getP2OPAddress(mldsaHex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Address.wrap(bytes).p2op(NETWORK);
}

/** Format sats as BTC/FB string */
function satsToBtc(sats: bigint, unit: 'BTC' | 'FB' = 'BTC'): string {
  const btc = Number(sats) / 1e8;
  if (btc >= 1) return btc.toFixed(4) + ' ' + unit;
  if (btc >= 0.001) return btc.toFixed(6) + ' ' + unit;
  return Number(sats).toLocaleString() + ' sats';
}

/* ═══════════════════════════════════════════════════════════════
   FRACTALSWAP — Native BTC ↔ Fractal BTC Exchange
   ═══════════════════════════════════════════════════════════════ */
const CrossChainMarketplace: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

  // UniSat wallet state (for Fractal Bitcoin side)
  const [unisat, setUnisat] = useState<UnisatWalletState>({
    connected: false, address: '', publicKey: '',
    balance: { confirmed: 0, unconfirmed: 0, total: 0 },
    chain: { enum: '', name: '', network: '' },
  });
  const [unisatConnecting, setUnisatConnecting] = useState(false);

  const handleConnectUnisat = useCallback(async () => {
    setUnisatConnecting(true);
    try {
      const state = await connectUnisat(true); // testnet
      setUnisat(state);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'UniSat connection failed');
      setTimeout(() => setMsg(''), 5000);
    } finally { setUnisatConnecting(false); }
  }, []);

  const handleDisconnectUnisat = useCallback(() => {
    setUnisat(disconnectUnisat());
  }, []);

  // State
  const [orders, setOrders] = useState<FractalSwapOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState(100); // default 1%

  // Create form
  const [formDirection, setFormDirection] = useState<SwapDirection>(SwapDirection.BTC_TO_FB);
  const [formAmount, setFormAmount] = useState('');
  const [formMakerAddr, setFormMakerAddr] = useState('');
  const [formExpiry, setFormExpiry] = useState('144');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  // Action state
  const [actionStep, setActionStep] = useState('');
  const [actioning, setActioning] = useState(false);
  const [msg, setMsg] = useState('');

  // Preimage store (localStorage persistence)
  const [preimageStore, setPreimageStore] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('fractalswap_preimages') || '{}'); } catch { return {}; }
  });
  const savePreimage = useCallback((orderId: string, preimage: string) => {
    setPreimageStore(prev => {
      const next = { ...prev, [orderId]: preimage };
      localStorage.setItem('fractalswap_preimages', JSON.stringify(next));
      return next;
    });
  }, []);

  const contractReady = !!CROSSCHAIN_ADDRESS;

  // Auto-fill Fractal address when UniSat connects and direction is BTC→FB
  useEffect(() => {
    if (unisat.connected && unisat.address && formDirection === SwapDirection.BTC_TO_FB && !formMakerAddr) {
      setFormMakerAddr(unisat.address);
    }
  }, [unisat.connected, unisat.address, formDirection, formMakerAddr]);

  // Fetch current block
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const b = await provider.getBlockNumber();
        if (!cancelled) setCurrentBlock(Number(b));
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [provider]);

  // Fetch fee info
  useEffect(() => {
    if (!contractReady) return;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK);
        const r = await c.getFeeInfo();
        if (r?.properties?.feeBps) setFeeBps(Number(r.properties.feeBps));
      } catch { /* */ }
    })();
  }, [provider, contractReady]);

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    if (!contractReady) { setLoading(false); return; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK);
      const nextIdResult = await market.getNextOrderId();
      const nextId = Number(nextIdResult?.properties?.nextOrderId ?? 1n);
      const fetched: FractalSwapOrder[] = [];
      for (let i = 1; i < nextId && i < 200; i++) {
        try {
          const r = await market.getOrder(BigInt(i));
          if (!r?.properties) continue;
          const p = r.properties;
          const status = Number(p.status ?? 0n);
          if (status === 0) continue;
          fetched.push({
            id: String(i),
            direction: Number(p.direction ?? 0n) as SwapDirection,
            status: status as OrderStatus,
            creator: (p.creator ?? 0n).toString(16).padStart(64, '0'),
            taker: (p.taker ?? 0n).toString(16).padStart(64, '0'),
            amountSats: p.amount ?? 0n,
            hashlock: (p.hashlock ?? 0n).toString(16).padStart(64, '0'),
            preimage: (p.preimage ?? 0n).toString(16).padStart(64, '0'),
            expiry: Number(p.expiry ?? 0n),
            makerAddr: (p.makerAddr ?? 0n).toString(16).padStart(64, '0'),
            takerAddr: (p.takerAddr ?? 0n).toString(16).padStart(64, '0'),
            feePaid: p.feePaid ?? 0n,
          });
        } catch { /* skip */ }
      }
      setOrders(fetched);
    } catch { /* */ }
    setLoading(false);
  }, [provider, contractReady]);

  useEffect(() => {
    fetchOrders();
    const iv = setInterval(fetchOrders, 15000);
    return () => clearInterval(iv);
  }, [fetchOrders]);

  // Derived
  const activeOrders = orders.filter(o => o.status === OrderStatus.Open || o.status === OrderStatus.Taken);
  const btcToFbOrders = activeOrders.filter(o => o.direction === SwapDirection.BTC_TO_FB);
  const fbToBtcOrders = activeOrders.filter(o => o.direction === SwapDirection.FB_TO_BTC);
  const totalVolumeSats = orders
    .filter(o => o.status === OrderStatus.Confirmed)
    .reduce((sum, o) => sum + o.amountSats, 0n);

  const formAmountSats = formAmount ? BigInt(Math.round(parseFloat(formAmount) * 1e8)) : 0n;
  const formFeeSats = formAmountSats > 0n ? (formAmountSats * BigInt(feeBps)) / 10000n : 0n;
  const expiryOpts = suggestedExpiryBlocks(1);

  // ── Create Order ──
  const handleCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) { setMsg('Contract not deployed yet'); return; }
    if (!formAmount || !formMakerAddr) return;
    if (formAmountSats <= 0n) return;

    setCreating(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr as any);

      // Generate HTLC pair
      setCreateStep('Generating HTLC preimage...');
      const { preimage, hashlock } = await generateHTLCPair();
      const hashlockU256 = hexToBigInt(hashlock);
      const expiryU256 = BigInt(currentBlock + parseInt(formExpiry));

      // Encode maker address as u256 (pad to 32 bytes)
      const addrBytes = new TextEncoder().encode(formMakerAddr);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let makerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) makerAddrU256 = (makerAddrU256 << 8n) | BigInt(padded[i]);

      setCreateStep('Creating order...');
      const sim = await withRetry(() =>
        market.createOrder(BigInt(formDirection), formAmountSats, hashlockU256, expiryU256, makerAddrU256),
      );
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setCreateStep('Waiting for confirmation...');
      await waitForNextBlock(provider, setCreateStep);

      // Save preimage
      const nextId = orders.length > 0 ? Math.max(...orders.map(o => parseInt(o.id))) + 1 : 1;
      savePreimage(String(nextId), preimage);

      setMsg(`Order created! Save your preimage: ${preimage.slice(0, 16)}...`);
      setCreateStep('');
      setFormAmount('');
      setFormMakerAddr('');
      setTimeout(() => setMsg(''), 8000);
      await fetchOrders();
    } catch (e) {
      setCreateStep(formatTxError(e));
      setTimeout(() => setCreateStep(''), 5000);
    } finally { setCreating(false); }
  }, [walletAddress, senderAddr, formAmount, formMakerAddr, formDirection, formExpiry, formAmountSats, currentBlock, provider, openConnectModal, contractReady, orders, fetchOrders, savePreimage]);

  // ── Take Order (pays 1% BTC fee) ──
  const handleTake = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(true); setActionStep('Taking order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      // Encode taker address
      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]);

      // Calculate fee
      const feeSats = (order.amountSats * BigInt(feeBps)) / 10000n;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr as any);

      // Set transaction details for fee output verification
      // Contract v2 dual-checks: output.to (string, on-chain) AND output.scriptPublicKey (bytes, simulation)
      // Use hasScriptPubKey flag + provide `to` for RPC validation
      market.setTransactionDetails({
        inputs: [],
        outputs: [{
          value: feeSats,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: feeRecipientScript,
          to: feeRecipientAddress,
        }],
      });

      setActionStep(`Taking order (fee: ${Number(feeSats)} sats)...`);
      const sim = await withRetry(() => market.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      // Use raw script (not address) for P2OP outputs — PSBT can't decode P2OP addresses
      // Value must be bigint (PSBT validates typeof === 'bigint')
      (tp as Record<string, unknown>).extraOutputs = [{
        script: feeRecipientScript,
        value: feeSats,
      }];
      (tp as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + 50_000n;
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('Waiting for confirmation...');
      await waitForNextBlock(provider, setActionStep);

      setActionStep('');
      setMsg(`Order taken! Fee paid: ${Number(feeSats)} sats`);
      setTimeout(() => setMsg(''), 5000);
      await fetchOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(false); }
  }, [walletAddress, senderAddr, orders, feeBps, provider, openConnectModal, contractReady, fetchOrders]);

  // ── Confirm Swap (reveal preimage) ──
  const handleConfirm = useCallback(async (orderId: string, preimageHex: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(true); setActionStep('Verifying preimage...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const valid = await verifyPreimage(preimageHex, order.hashlock);
      if (!valid) throw new Error('Invalid preimage');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr as any);
      setActionStep('Confirming swap on-chain...');
      const sim = await withRetry(() => market.confirmSwap(BigInt(orderId), hexToBigInt(preimageHex)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('Waiting for confirmation...');
      await waitForNextBlock(provider, setActionStep);

      setActionStep('');
      setMsg('Swap confirmed!');
      setTimeout(() => setMsg(''), 5000);
      await fetchOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(false); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders]);

  // ── Cancel Order ──
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(true); setActionStep('Cancelling order...');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr as any);
      const sim = await withRetry(() => market.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('Waiting for confirmation...');
      await waitForNextBlock(provider, setActionStep);

      setActionStep('');
      setMsg('Order cancelled!');
      setTimeout(() => setMsg(''), 5000);
      await fetchOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(false); }
  }, [walletAddress, senderAddr, provider, openConnectModal, contractReady, fetchOrders]);

  // ── Send on Fractal (via UniSat) — taker sends FB-BTC to maker's address ──
  const handleSendFractal = useCallback(async (orderId: string) => {
    if (!unisat.connected) { handleConnectUnisat(); return; }
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    setActioning(true); setActionStep('Sending Fractal BTC via UniSat...');
    try {
      // Decode maker's Fractal address from u256 hex
      const addrBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) addrBytes[i] = parseInt(order.makerAddr.slice(i * 2, i * 2 + 2), 16);
      // Find first null byte or use full 32 bytes
      let end = addrBytes.indexOf(0);
      if (end === -1) end = 32;
      const makerFractalAddr = new TextDecoder().decode(addrBytes.slice(0, end));

      if (!makerFractalAddr.startsWith('bc1') && !makerFractalAddr.startsWith('tb1')) {
        throw new Error(`Invalid Fractal address: ${makerFractalAddr}`);
      }

      const txid = await sendFractalBTC(makerFractalAddr, Number(order.amountSats), 1);
      setActionStep('');
      setMsg(`Fractal BTC sent! TX: ${txid.slice(0, 16)}...`);
      setTimeout(() => setMsg(''), 8000);

      // Open explorer
      window.open(getFractalTxUrl(txid), '_blank');
    } catch (e) {
      setActionStep(e instanceof Error ? e.message : 'Fractal send failed');
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(false); }
  }, [unisat.connected, orders, handleConnectUnisat]);

  // ── Refund Expired ──
  const handleRefund = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(true); setActionStep('Refunding expired order...');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market = getContract<any>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr as any);
      const sim = await withRetry(() => market.refundExpired(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('Waiting for confirmation...');
      await waitForNextBlock(provider, setActionStep);

      setActionStep('');
      setMsg('Order refunded!');
      setTimeout(() => setMsg(''), 5000);
      await fetchOrders();
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(false); }
  }, [walletAddress, senderAddr, provider, openConnectModal, contractReady, fetchOrders]);

  // ── Render helpers ──
  const renderStatusBadge = (status: OrderStatus) => {
    const s = STATUS_COLORS[status] || STATUS_COLORS[OrderStatus.Open];
    return (
      <span style={{
        background: s.bg, color: s.text,
        padding: '3px 8px', borderRadius: 6, fontSize: '.68rem', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.04em',
      }}>
        {s.label}
      </span>
    );
  };

  const renderDirectionBadge = (dir: SwapDirection) => {
    const isBtcToFb = dir === SwapDirection.BTC_TO_FB;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: isBtcToFb ? 'rgba(245,158,11,.12)' : 'rgba(139,92,246,.12)',
        color: isBtcToFb ? '#f59e0b' : '#8b5cf6',
        padding: '4px 10px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700,
      }}>
        {isBtcToFb ? 'BTC → Fractal' : 'Fractal → BTC'}
      </span>
    );
  };

  const renderOrderCard = (order: FractalSwapOrder) => {
    const isExpanded = expandedOrder === order.id;
    const blocksLeft = order.expiry > 0 ? order.expiry - currentBlock : 0;
    const isExpired = order.expiry > 0 && blocksLeft <= 0;
    const myPreimage = preimageStore[order.id];
    const isMyOrder = walletAddress && order.creator.includes(walletAddress.replace('opt1', '').slice(-16));
    const feeSats = (order.amountSats * BigInt(feeBps)) / 10000n;
    const amountUnit = order.direction === SwapDirection.FB_TO_BTC ? 'FB' : 'BTC';

    return (
      <div key={order.id} className="Pg" style={{ marginBottom: 8, cursor: 'pointer' }}
        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {renderDirectionBadge(order.direction)}
            <span style={{ fontWeight: 700, fontSize: '.82rem' }}>
              {satsToBtc(order.amountSats, amountUnit)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {renderStatusBadge(order.status)}
            <span style={{ fontSize: '.72rem', color: 'var(--t3)' }}>#{order.id}</span>
          </div>
        </div>

        {/* Info row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '.72rem', color: 'var(--t2)' }}>
          <span>Fee: <b style={{ color: 'var(--o)' }}>+{Number(feeSats).toLocaleString()} sats</b></span>
          {order.feePaid > 0n && (
            <span>Paid: <b>{Number(order.feePaid).toLocaleString()} sats</b></span>
          )}
          {order.expiry > 0 && (
            <span style={{ color: isExpired ? 'var(--r)' : 'var(--g)' }}>
              {isExpired ? 'EXPIRED' : `Expires: ${formatBlockCountdown(blocksLeft)}`}
            </span>
          )}
        </div>

        {/* Hashlock preview */}
        <div style={{ marginTop: 6, fontSize: '.68rem', color: 'var(--t3)', fontFamily: 'var(--fm)' }}>
          Hashlock: {order.hashlock === ZERO_HEX ? '(pending)' : truncateHex(order.hashlock, 8)}
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
            <div style={{ fontSize: '.7rem', color: 'var(--t2)', marginBottom: 8 }}>
              <div><b>Hashlock:</b> <code style={{ fontSize: '.65rem', wordBreak: 'break-all' }}>{order.hashlock}</code></div>
              {order.preimage !== ZERO_HEX && (
                <div style={{ marginTop: 4 }}>
                  <b>Preimage (revealed):</b> <code style={{ fontSize: '.65rem', wordBreak: 'break-all' }}>{order.preimage}</code>
                </div>
              )}
              {myPreimage && order.preimage === ZERO_HEX && (
                <div style={{ marginTop: 4, background: 'rgba(245,158,11,.1)', padding: '6px 8px', borderRadius: 8 }}>
                  <b style={{ color: '#f59e0b' }}>Your Preimage (keep secret!):</b>
                  <code style={{ fontSize: '.65rem', wordBreak: 'break-all', display: 'block', marginTop: 2 }}>{myPreimage}</code>
                  <button style={{ ...btnSmall, marginTop: 4 }}
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(myPreimage); }}>
                    Copy
                  </button>
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <b>Maker Address:</b>{' '}
                {order.makerAddr === ZERO_HEX ? <code style={{ fontSize: '.65rem' }}>(none)</code> : (() => {
                  // Decode u256 hex to string address
                  const bytes = new Uint8Array(32);
                  for (let i = 0; i < 32; i++) bytes[i] = parseInt(order.makerAddr.slice(i * 2, i * 2 + 2), 16);
                  let end = bytes.indexOf(0); if (end === -1) end = 32;
                  const addr = new TextDecoder().decode(bytes.slice(0, end));
                  const isFractal = addr.startsWith('bc1') || addr.startsWith('tb1');
                  return (
                    <code style={{ fontSize: '.65rem' }}>
                      {isFractal ? (
                        <a href={getFractalAddressUrl(addr)} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#8b5cf6', textDecoration: 'none' }}>
                          {addr.slice(0, 16)}...{addr.slice(-6)}
                        </a>
                      ) : truncateHex(order.makerAddr, 12)}
                    </code>
                  );
                })()}
              </div>
              {order.taker !== ZERO_HEX && (
                <div style={{ marginTop: 4 }}>
                  <b>Taker:</b> <code style={{ fontSize: '.65rem' }}>{truncateHex(order.taker, 12)}</code>
                </div>
              )}
              {order.takerAddr !== ZERO_HEX && (
                <div style={{ marginTop: 4 }}>
                  <b>Taker Address:</b> <code style={{ fontSize: '.65rem' }}>{truncateHex(order.takerAddr, 12)}</code>
                </div>
              )}
              {order.expiry > 0 && (
                <div style={{ marginTop: 4 }}>
                  <b>Expiry Block:</b> {order.expiry.toLocaleString()} ({formatBlockCountdown(blocksLeft)})
                </div>
              )}
            </div>

            {/* Step indicator */}
            {order.status === OrderStatus.Open && isMyOrder && (
              <TxStepIndicator step="waiting" steps={MAKER_STEPS} />
            )}
            {order.status === OrderStatus.Taken && (
              <TxStepIndicator step="executing" steps={isMyOrder ? MAKER_STEPS : TAKER_STEPS} />
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {/* Take order — for open orders (not own) */}
              {order.status === OrderStatus.Open && !isExpired && !isMyOrder && (
                <TakeOrderButton orderId={order.id} feeSats={Number(feeSats)} onTake={handleTake} disabled={actioning} />
              )}

              {/* Confirm swap — reveal preimage (for taken orders) */}
              {order.status === OrderStatus.Taken && !isExpired && myPreimage && (
                <button className="btn-p" style={{ fontSize: '.72rem', padding: '6px 14px' }}
                  disabled={actioning}
                  onClick={(e) => { e.stopPropagation(); handleConfirm(order.id, myPreimage); }}>
                  Reveal Preimage
                </button>
              )}

              {/* Send on Fractal — taker sends FB-BTC to maker via UniSat */}
              {order.status === OrderStatus.Taken && !isExpired && !isMyOrder && (
                <button style={{
                  ...btnSmall, background: 'rgba(139,92,246,.15)', color: '#8b5cf6',
                  border: '1px solid rgba(139,92,246,.3)',
                }}
                  disabled={actioning}
                  onClick={(e) => { e.stopPropagation(); handleSendFractal(order.id); }}>
                  {unisat.connected ? `Send ${satsToBtc(order.amountSats)} on Fractal` : 'Connect UniSat to Send'}
                </button>
              )}

              {/* Confirm with manual preimage input */}
              {order.status === OrderStatus.Taken && !isExpired && !myPreimage && (
                <PreimageInput orderId={order.id} onConfirm={handleConfirm} disabled={actioning} />
              )}

              {/* Refund expired */}
              {isExpired && order.status === OrderStatus.Taken && (
                <button style={{ ...btnSmall, background: 'rgba(239,68,68,.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }}
                  disabled={actioning}
                  onClick={(e) => { e.stopPropagation(); handleRefund(order.id); }}>
                  Refund
                </button>
              )}

              {/* Cancel — only for open orders by creator */}
              {order.status === OrderStatus.Open && isMyOrder && (
                <button style={{ ...btnSmall, background: 'rgba(107,114,128,.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,.3)' }}
                  disabled={actioning}
                  onClick={(e) => { e.stopPropagation(); handleCancel(order.id); }}>
                  Cancel
                </button>
              )}
            </div>

            {actionStep && (
              <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {actionStep}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-.02em' }}>
            FractalSwap
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '.78rem', color: 'var(--t2)' }}>
            Native BTC \u2194 Fractal BTC exchange \u2014 trustless atomic swaps, {feeBps / 100}% fee
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${fractalChain.color}22`, color: fractalChain.color,
            padding: '6px 14px', borderRadius: 10, fontSize: '.76rem', fontWeight: 700,
            border: `1px solid ${fractalChain.color}44`,
          }}>
            {fractalChain.icon} {fractalChain.name}
          </span>
          {currentBlock > 0 && (
            <span style={{ fontSize: '.68rem', color: 'var(--t3)' }}>Block #{currentBlock.toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Dual Wallet Connection */}
      <div className="Pg" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* OPNet Wallet */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            OPNet Wallet
          </div>
          {walletAddress ? (
            <div>
              <div style={{ fontSize: '.72rem', fontFamily: 'var(--fm)', color: 'var(--w)', wordBreak: 'break-all' }}>
                {walletAddress.slice(0, 12)}...{walletAddress.slice(-8)}
              </div>
              <div style={{ fontSize: '.66rem', color: 'var(--g)', marginTop: 2 }}>Connected</div>
            </div>
          ) : (
            <button className="btn-p" style={{ fontSize: '.7rem', padding: '6px 12px', width: '100%' }}
              onClick={openConnectModal}>
              Connect OPWallet
            </button>
          )}
        </div>

        {/* UniSat Wallet (Fractal) */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.15)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            UniSat Wallet (Fractal)
          </div>
          {unisat.connected ? (
            <div>
              <div style={{ fontSize: '.72rem', fontFamily: 'var(--fm)', color: 'var(--w)', wordBreak: 'break-all' }}>
                {unisat.address.slice(0, 12)}...{unisat.address.slice(-8)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                <span style={{ fontSize: '.66rem', color: 'var(--g)' }}>
                  {(unisat.balance.total / 1e8).toFixed(6)} FB
                </span>
                <button style={{ ...btnSmall, fontSize: '.6rem', padding: '2px 6px' }} onClick={handleDisconnectUnisat}>
                  Disconnect
                </button>
              </div>
              {unisat.chain.enum && (
                <div style={{ fontSize: '.6rem', color: 'var(--t3)', marginTop: 2 }}>
                  {unisat.chain.name}
                </div>
              )}
            </div>
          ) : (
            <button className="btn-p" style={{
              fontSize: '.7rem', padding: '6px 12px', width: '100%',
              background: isUnisatInstalled() ? undefined : 'rgba(107,114,128,.3)',
            }}
              disabled={unisatConnecting}
              onClick={handleConnectUnisat}>
              {unisatConnecting ? 'Connecting...' : isUnisatInstalled() ? 'Connect UniSat' : 'Install UniSat Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Contract not deployed notice */}
      {!contractReady && (
        <div className="Pg" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>{'\u{1F6A7}'}</div>
          <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Contract Pending Deployment</h3>
          <p style={{ color: 'var(--t2)', fontSize: '.82rem', maxWidth: 500, margin: '0 auto' }}>
            The FractalSwap contract is ready. Once deployed to OPNet testnet,
            you can swap native BTC with Fractal Bitcoin via trustless atomic swaps.
          </p>
          <div style={{ marginTop: 12, fontSize: '.72rem', color: 'var(--t3)' }}>
            <code>cd deploy/OP_20 && npx asc src/crosschain/index.ts --target crosschain</code>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>Active Orders</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--w)' }}>{activeOrders.length}</div>
        </div>
        <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>Total Volume</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--o)' }}>{satsToBtc(totalVolumeSats)}</div>
        </div>
        <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>Fee</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#8b5cf6' }}>{feeBps / 100}%</div>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)',
          borderRadius: 12, padding: '10px 16px', marginBottom: 12,
          fontSize: '.78rem', color: '#22c55e', fontWeight: 600,
        }}>
          {msg}
        </div>
      )}

      {/* Create Order Form */}
      <div className="Pg" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 12 }}>Create Swap Order</div>

        {/* Direction toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            className={formDirection === SwapDirection.BTC_TO_FB ? 'btn-p' : 'btn-s'}
            style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
            onClick={() => setFormDirection(SwapDirection.BTC_TO_FB)}
          >
            BTC → Fractal
          </button>
          <button
            className={formDirection === SwapDirection.FB_TO_BTC ? 'btn-p' : 'btn-s'}
            style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
            onClick={() => setFormDirection(SwapDirection.FB_TO_BTC)}
          >
            Fractal → BTC
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Amount */}
          <div>
            <label style={labelStyle}>Amount (BTC)</label>
            <input style={iStyle} type="number" placeholder="0.001" value={formAmount}
              onChange={e => setFormAmount(e.target.value)} min="0" step="any" />
            {formAmountSats > 0n && (
              <div style={{ fontSize: '.66rem', color: 'var(--t3)', marginTop: 2 }}>
                = {Number(formAmountSats).toLocaleString()} sats
              </div>
            )}
          </div>

          {/* Expiry */}
          <div>
            <label style={labelStyle}>Expiry</label>
            <select style={iStyle as React.CSSProperties} value={formExpiry} onChange={e => setFormExpiry(e.target.value)}>
              <option value={String(expiryOpts.min)}>~12h ({expiryOpts.min} blocks)</option>
              <option value={String(expiryOpts.default)}>~24h ({expiryOpts.default} blocks) - Recommended</option>
              <option value="288">~48h (288 blocks)</option>
              <option value={String(expiryOpts.max)}>~4 days ({expiryOpts.max} blocks)</option>
            </select>
          </div>

          {/* Receiving address on source chain */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>
              Your {formDirection === SwapDirection.BTC_TO_FB ? 'Fractal' : 'Bitcoin'} Receiving Address
            </label>
            <input style={iStyle}
              placeholder={formDirection === SwapDirection.BTC_TO_FB ? 'bc1p... (your Fractal address)' : 'bc1p... (your Bitcoin address)'}
              value={formMakerAddr}
              onChange={e => setFormMakerAddr(e.target.value)} />
          </div>
        </div>

        {/* Fee display */}
        {formAmountSats > 0n && (
          <div style={{ marginTop: 10, fontSize: '.76rem', color: 'var(--t2)', display: 'flex', gap: 16 }}>
            <span>Taker fee: <b style={{ color: 'var(--o)' }}>{Number(formFeeSats).toLocaleString()} sats ({feeBps / 100}%)</b></span>
            <span>Total: <b>{satsToBtc(formAmountSats, formDirection === SwapDirection.FB_TO_BTC ? 'FB' : 'BTC')}</b></span>
          </div>
        )}

        {createStep && (
          <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
            {createStep}
          </div>
        )}

        <button className="btn-p" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
          disabled={creating || !formAmount || !formMakerAddr || !contractReady || formAmountSats <= 0n}
          onClick={handleCreate}
        >
          {creating ? 'Creating...' : 'Create Swap Order'}
        </button>
      </div>

      {/* Order Book */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* BTC → Fractal */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '.78rem', marginBottom: 8, color: '#f59e0b' }}>
            BTC → Fractal ({btcToFbOrders.length})
          </div>
          {loading ? (
            <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Loading...</div>
          ) : btcToFbOrders.length === 0 ? (
            <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: '.78rem' }}>
              No BTC→Fractal orders yet
            </div>
          ) : (
            btcToFbOrders.map(renderOrderCard)
          )}
        </div>

        {/* Fractal → BTC */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '.78rem', marginBottom: 8, color: '#8b5cf6' }}>
            Fractal → BTC ({fbToBtcOrders.length})
          </div>
          {loading ? (
            <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Loading...</div>
          ) : fbToBtcOrders.length === 0 ? (
            <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: '.78rem' }}>
              No Fractal→BTC orders yet
            </div>
          ) : (
            fbToBtcOrders.map(renderOrderCard)
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="Pg" style={{ marginTop: 20, padding: '16px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 10 }}>How FractalSwap Works</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { num: '1', title: 'Post Order', desc: 'Maker creates order with amount, hashlock, and receiving address' },
            { num: '2', title: 'Take + Pay Fee', desc: 'Taker commits to order and pays 1% BTC fee to contract' },
            { num: '3', title: 'Create HTLC', desc: 'Taker creates matching HTLC on Fractal with same hashlock' },
            { num: '4', title: 'Reveal & Settle', desc: 'Maker reveals preimage on Fractal, both parties settle' },
          ].map(s => (
            <div key={s.num} style={{ textAlign: 'center' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'rgba(139,92,246,.2)',
                color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 8px', fontWeight: 800, fontSize: '.82rem',
              }}>{s.num}</div>
              <div style={{ fontSize: '.72rem', fontWeight: 700, marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: '.66rem', color: 'var(--t3)', lineHeight: 1.4 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Explorer link */}
      {contractReady && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <a href={getContractOpscanUrl(CROSSCHAIN_ADDRESS)}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '.72rem', color: 'var(--o)', textDecoration: 'none' }}>
            View contract on OPScan →
          </a>
        </div>
      )}
    </div>
  );
};

/** Inline Take Order button with taker address input */
const TakeOrderButton: React.FC<{
  orderId: string; feeSats: number;
  onTake: (id: string, takerAddr: string) => void; disabled: boolean;
}> = ({ orderId, feeSats, onTake, disabled }) => {
  const [show, setShow] = useState(false);
  const [addr, setAddr] = useState('');

  if (!show) {
    return (
      <button className="btn-p" style={{ fontSize: '.72rem', padding: '6px 14px' }}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setShow(true); }}>
        Take Order (+{feeSats.toLocaleString()} sats fee)
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
      <input style={{ ...iStyle, width: 240, fontSize: '.68rem' }}
        placeholder="Your receiving address (bc1p... or bc1q...)"
        value={addr} onChange={e => setAddr(e.target.value)} />
      <button className="btn-p" style={{ fontSize: '.68rem', padding: '6px 10px' }}
        disabled={disabled || addr.length < 10}
        onClick={() => onTake(orderId, addr)}>
        Confirm
      </button>
      <button style={btnSmall} onClick={() => setShow(false)}>X</button>
    </div>
  );
};

/** Inline preimage input for confirm swap */
const PreimageInput: React.FC<{
  orderId: string; onConfirm: (id: string, preimage: string) => void; disabled: boolean;
}> = ({ orderId, onConfirm, disabled }) => {
  const [show, setShow] = useState(false);
  const [val, setVal] = useState('');

  if (!show) {
    return (
      <button className="btn-p" style={{ fontSize: '.72rem', padding: '6px 14px' }}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setShow(true); }}>
        Confirm with Preimage
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      <input style={{ ...iStyle, width: 200, fontSize: '.68rem' }} placeholder="Enter preimage hex..."
        value={val} onChange={e => setVal(e.target.value)} />
      <button className="btn-p" style={{ fontSize: '.68rem', padding: '6px 10px' }}
        disabled={disabled || val.length < 64}
        onClick={() => onConfirm(orderId, val)}>
        Confirm
      </button>
      <button style={btnSmall} onClick={() => setShow(false)}>X</button>
    </div>
  );
};

export default CrossChainMarketplace;
