import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes,
  TransactionOutputFlags,
  type BitcoinInterfaceAbi, type CallResult, type BaseContractProperties,
  type TransactionParameters,
} from 'opnet';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { Address } from '@btc-vision/transaction';
import { ensureAllowance, buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import { fmtNum, hashColor, genLogo, timeAgo } from '../launchpad/types';
import { MARKET_ADDRESS, MARKET_PUBKEY, TESTNET_CONTRACTS, getContractOpscanUrl, getTxUrl, addressToPubkey } from '../contracts';
import { SkeletonOrderbook, SkeletonCard, SkeletonStyle } from './Skeleton';
import { useToast } from './Toast';
import { lockOrder, unlockOrder, getActiveLocks, type OrderLock } from '../swapApi';
import { useOps } from '../contexts/OpsContext';
const LP_API = import.meta.env.VITE_LP_API || '';
const MARKET_API = import.meta.env.VITE_API_URL || '';

/** Typed interface for P2PMarket contract methods (generated dynamically from ABI) */
interface MarketContract extends BaseContractProperties {
  getNextOrderId(): Promise<CallResult>;
  getOrder(orderId: bigint): Promise<CallResult>;
  createSellOrder(token: Address, amount: bigint, pricePerToken: bigint): Promise<CallResult>;
  createBuyOrder(token: Address, amount: bigint, pricePerToken: bigint): Promise<CallResult>;
  fillSellOrder(orderId: bigint, fillAmount: bigint): Promise<CallResult>;
  acceptBuyOrder(orderId: bigint): Promise<CallResult>;
  executeBuyOrder(orderId: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
}

/** P2PMarket ABI */
const MARKET_ABI: BitcoinInterfaceAbi = [
  { name: 'createSellOrder', inputs: [
    { name: 'token', type: ABIDataTypes.ADDRESS },
    { name: 'amount', type: ABIDataTypes.UINT256 },
    { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'fillSellOrder', inputs: [
    { name: 'orderId', type: ABIDataTypes.UINT256 },
    { name: 'fillAmount', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'createBuyOrder', inputs: [
    { name: 'token', type: ABIDataTypes.ADDRESS },
    { name: 'amount', type: ABIDataTypes.UINT256 },
    { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'acceptBuyOrder', inputs: [
    { name: 'orderId', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'executeBuyOrder', inputs: [
    { name: 'orderId', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'cancelOrder', inputs: [
    { name: 'orderId', type: ABIDataTypes.UINT256 },
  ], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'getOrder', inputs: [
    { name: 'orderId', type: ABIDataTypes.UINT256 },
  ], outputs: [
    { name: 'orderType', type: ABIDataTypes.UINT256 },
    { name: 'status', type: ABIDataTypes.UINT256 },
    { name: 'creator', type: ABIDataTypes.UINT256 },
    { name: 'token', type: ABIDataTypes.UINT256 },
    { name: 'amount', type: ABIDataTypes.UINT256 },
    { name: 'filled', type: ABIDataTypes.UINT256 },
    { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
    { name: 'seller', type: ABIDataTypes.UINT256 },
  ], type: BitcoinAbiTypes.Function },
  { name: 'getNextOrderId', inputs: [], outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
];

/* ─── Types ─── */
interface Order {
  id: string;
  type: 'sell' | 'buy';
  creator: string;
  seller: string; // for accepted buy orders — the seller who locked tokens
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amount: number;
  amountFilled: number;
  pricePerToken: number;
  totalPrice: number;
  createdAt: number;
  status: 'active' | 'filled' | 'cancelled' | 'accepted';
  fills: { id: string; filler: string; amount: number; price: number; timestamp: number }[];
}

interface MarketToken {
  address: string;
  pubkey: string;
  symbol: string;
  name: string;
  decimals: number;
  sellCount: number;
  buyCount: number;
  totalVolume: number;
}

/** Hardcoded known tokens — always available even when LP_API is offline */
const KNOWN_TOKENS: MarketToken[] = Object.values(TESTNET_CONTRACTS).map(t => ({
  address: t.address,
  pubkey: t.pubkey,
  symbol: t.symbol,
  name: t.name,
  decimals: t.decimals,
  sellCount: 0,
  buyCount: 0,
  totalVolume: 0,
}));

/** Resolve 64-char hex token address → { bech32, symbol, name, decimals } from KNOWN_TOKENS */
function resolveTokenHex(hex64: string): { address: string; symbol: string; name: string; decimals: number } | null {
  const withPrefix = '0x' + hex64;
  const found = KNOWN_TOKENS.find(t => t.pubkey === withPrefix);
  if (found) return { address: found.address, symbol: found.symbol, name: found.name, decimals: found.decimals };
  return null;
}

/** Build a P2OP scriptPubKey (OP_16 PUSH_32 <32-byte MLDSA hash>) from a 64-char hex string */
function buildP2OPScript(mldsaHex: string): Buffer {
  const bytes = new Uint8Array(34);
  bytes[0] = 0x60; // OP_16 (witness version 16)
  bytes[1] = 0x20; // PUSH_32
  for (let i = 0; i < 32; i++) {
    bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  }
  return Buffer.from(bytes);
}

/** Get P2OP bech32m address from 64-char MLDSA hash hex (opt1sq...) */
function getP2OPAddress(mldsaHex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Address.wrap(bytes).p2op(NETWORK);
}

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box' as const,
};

/* ═══════════════════════════════════════════════════════════════
   MARKETPLACE — per-token orderbook with partial fills
   ═══════════════════════════════════════════════════════════════ */
const Marketplace: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { toast } = useToast();

  // Convert senderAddr (Address/Uint8Array) to 64-char hex for own-order comparison
  const senderHex = useMemo(() => {
    if (!senderAddr) return '';
    try {
      const bytes = new Uint8Array(senderAddr as unknown as ArrayBufferLike);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  }, [senderAddr]);

  // View state: token list vs token detail
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenList, setTokenList] = useState<MarketToken[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create order form
  const [orderType, setOrderType] = useState<'sell' | 'buy'>('sell');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  // Fill form
  const [fillId, setFillId] = useState<string | null>(null);
  const [fillAmount, setFillAmount] = useState('');
  const [filling, setFilling] = useState(false);
  const [fillStep, setFillStep] = useState('');

  // Status messages
  const [msg, setMsg] = useState('');
  const [lastTxId, setLastTxId] = useState<string | null>(null);

  // Global ops context
  const { trackOp, completeOp, failOp } = useOps();

  // Order locks
  const [locks, setLocks] = useState<Record<string, OrderLock>>({});
  useEffect(() => {
    getActiveLocks().then(setLocks);
    const iv = setInterval(() => getActiveLocks().then(setLocks), 15_000);
    return () => clearInterval(iv);
  }, []);

  // Read orders directly from on-chain contract (fallback when LP_API unavailable)
  const fetchOrdersOnChain = useCallback(async (tokenFilter?: string) => {
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKET_ABI, provider, NETWORK);
      const nextIdResult = await market.getNextOrderId();
      const nextId = Number((nextIdResult?.properties as Record<string, unknown>)?.nextOrderId ?? 1n);
      const chainOrders: Order[] = [];
      for (let i = 1; i < nextId && i < 200; i++) {
        try {
          const r = await market.getOrder(BigInt(i));
          if (!r?.properties) continue;
          const p = r.properties as Record<string, unknown>;
          const orderType = Number(p.orderType ?? 0n);
          const status = Number(p.status ?? 0n);
          // Show active (1) and accepted (4) orders
          if (status !== 1 && status !== 4) continue;
          const tokenHex = ((p.token ?? 0n) as bigint).toString(16).padStart(64, '0');
          // Resolve token hex to bech32 address and metadata
          const resolved = resolveTokenHex(tokenHex);
          const tokenBech32 = resolved?.address || tokenHex;
          if (tokenFilter) {
            // Match by bech32 address or hex pubkey
            if (tokenBech32 !== tokenFilter && !tokenHex.includes(tokenFilter.replace('opt1sq', '').slice(-16))) continue;
          }
          const decimals = resolved?.decimals || 8;
          const amount = Number(p.amount ?? 0n) / Math.pow(10, decimals);
          const filled = Number(p.filled ?? 0n) / Math.pow(10, decimals);
          const price = Number(p.pricePerToken ?? 0n);
          const statusStr = status === 1 ? 'active' : 'accepted';
          const sellerHex = ((p.seller ?? 0n) as bigint).toString(16).padStart(64, '0');
          chainOrders.push({
            id: String(i),
            type: orderType === 1 ? 'sell' : 'buy',
            creator: ((p.creator ?? 0n) as bigint).toString(16).padStart(64, '0'),
            seller: sellerHex,
            tokenAddress: tokenBech32,
            tokenSymbol: resolved?.symbol || '???',
            tokenName: resolved?.name || 'OP20 Token',
            amount, amountFilled: filled,
            pricePerToken: price,
            totalPrice: (amount - filled) * price,
            createdAt: Date.now() / 1000,
            status: statusStr,
            fills: [],
          });
        } catch { /* skip unreadable orders */ }
      }
      return chainOrders;
    } catch { return []; }
  }, [provider]);

  // Fetch token list (server first, hardcoded fallback)
  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${MARKET_API}/market/tokens`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const serverTokens = (await res.json()).tokens || [];
        // Merge server tokens with known tokens (ensure pubkey is present)
        const merged = serverTokens.map((st: MarketToken) => {
          const known = KNOWN_TOKENS.find(k => k.address === st.address);
          return { ...st, pubkey: st.pubkey || known?.pubkey || '', decimals: st.decimals || known?.decimals || 8 };
        });
        // Add known tokens not in server list
        for (const kt of KNOWN_TOKENS) {
          if (!merged.find((m: MarketToken) => m.address === kt.address)) merged.push(kt);
        }
        setTokenList(merged);
        setLoading(false);
        return;
      }
    } catch { /* server offline */ }
    // Fallback: use hardcoded known tokens
    setTokenList(KNOWN_TOKENS);
    setLoading(false);
  }, []);

  // Fetch orders always from on-chain (LP_API has incompatible ord_xxx IDs)
  const fetchOrders = useCallback(async (tokenAddr?: string) => {
    const addr = tokenAddr || selectedToken;
    if (!addr) return;
    const chainOrders = await fetchOrdersOnChain(addr);
    setOrders(chainOrders);
  }, [selectedToken, fetchOrdersOnChain]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);
  useEffect(() => { if (selectedToken) fetchOrders(); }, [selectedToken, fetchOrders]);

  // Filtered token list
  const filteredTokens = useMemo(() => {
    if (!search) return tokenList;
    const q = search.toLowerCase();
    return tokenList.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [tokenList, search]);

  // Currently selected token info
  const selInfo = tokenList.find(t => t.address === selectedToken);

  // Sell orders / buy orders for current token (include accepted buy orders too)
  const sellOrders = orders.filter(o => o.type === 'sell' && o.status === 'active').sort((a, b) => a.pricePerToken - b.pricePerToken);
  const buyOrders = orders.filter(o => o.type === 'buy' && (o.status === 'active' || o.status === 'accepted')).sort((a, b) => b.pricePerToken - a.pricePerToken);
  const myOrders = orders.filter(o => o.creator === senderHex || o.seller === senderHex);

  // Create order — ON-CHAIN via P2PMarket contract
  const handleCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!selectedToken || !orderAmount || !orderPrice) return;
    const amt = parseFloat(orderAmount);
    const ppt = parseFloat(orderPrice);
    if (amt <= 0 || ppt <= 0) return;

    setCreating(true);
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKET_ABI, provider, NETWORK, senderAddr);
      const decimals = selInfo?.decimals || 8;
      const amountU256 = BigInt(Math.round(amt * Math.pow(10, decimals))); // token amount in smallest units
      const priceU256 = BigInt(Math.round(ppt));   // price per token in raw sats (integer)

      // SDK expects Address object — resolve pubkey from known map or use address directly
      const pubkey = selInfo?.pubkey || addressToPubkey(selectedToken);
      const tokenAddr = Address.fromString(pubkey);

      if (orderType === 'sell') {
        // Step 1: Ensure allowance for P2PMarket to pull tokens
        setCreateStep('Approving tokens for marketplace...');
        await ensureAllowance(selectedToken, MARKET_PUBKEY, amountU256, provider, senderAddr!, walletAddress, setCreateStep, selInfo?.symbol || 'token');

        // Step 2: Call createSellOrder on-chain
        setCreateStep('Creating sell order on-chain...');
        const sim = await withRetry(() => market.createSellOrder(tokenAddr, amountU256, priceU256));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
        const tp = await buildTxParams(provider, walletAddress);
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      } else {
        // Buy order: just stores intent on-chain (no tokens locked)
        setCreateStep('Creating buy order on-chain...');
        const sim = await withRetry(() => market.createBuyOrder(tokenAddr, amountU256, priceU256));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
        const tp = await buildTxParams(provider, walletAddress);
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      }

      setCreateStep('');
      setOrderAmount(''); setOrderPrice('');
      toast(`${orderType === 'sell' ? 'Sell' : 'Buy'} order submitted! Confirming...`, 'success');
      setCreating(false);

      // Persist op
      const createOpId = `p2p:create:${Date.now()}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'p2p', orderId: 'pending',
        direction: orderType, role: 'maker', step: 'Confirming...',
        amounts: { amount: orderAmount, price: orderPrice, token: selInfo?.symbol || '' },
      });

      // Non-blocking: notify indexer + wait for block then refresh
      try {
        fetch(`${MARKET_API}/market/create`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: orderType, creator: walletAddress,
            tokenAddress: selectedToken,
            tokenSymbol: selInfo?.symbol || '', tokenName: selInfo?.name || '',
            amount: amt, pricePerToken: ppt,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      } catch { /* indexer optional */ }

      waitForNextBlock(provider).then(() => {
        toast('Order confirmed on-chain!', 'success');
        completeOp(createOpId);
        fetchOrders(); fetchTokens();
      }).catch(() => {});
      fetchOrders();
      return;
    } catch (e) {
      setCreateStep(formatTxError(e));
      setTimeout(() => setCreateStep(''), 5000);
    } finally { setCreating(false); }
  }, [walletAddress, senderAddr, selectedToken, orderAmount, orderPrice, orderType, selInfo, provider, openConnectModal, fetchOrders, fetchTokens]);

  // Fill order — ON-CHAIN with BTC output verification
  const handleFill = useCallback(async (orderId: string, amount?: number) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }

    // Lock order
    const lockKey = `p2p:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    setFilling(true); setFillStep('Preparing fill...');
    const opId = `p2p:fill:${orderId}:${walletAddress}`;
    try {
      // Find the order to get seller address and price
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      // Check: cannot fill your own order
      if (order.creator === senderHex || order.seller === senderHex) {
        throw new Error('Cannot fill your own order. Use a different wallet.');
      }

      const fillAmt = amount || (order.amount - order.amountFilled);
      const fillAmtU256 = BigInt(Math.round(fillAmt * 1e8));

      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKET_ABI, provider, NETWORK, senderAddr);

      if (order.type === 'sell') {
        // Buyer fills sell order: must include BTC output to seller's P2OP address
        const rawPayment = BigInt(Math.ceil(fillAmt * order.pricePerToken));
        const btcPaymentSats = rawPayment < 330n ? 330n : rawPayment; // enforce dust minimum
        // order.creator is the seller's MLDSA hash hex (from on-chain) — build P2OP
        const sellerP2OPScript = buildP2OPScript(order.creator);
        const sellerP2OPAddress = getP2OPAddress(order.creator);

        setFillStep(`Sending ${Number(btcPaymentSats)} sats to seller...`);

        // Set transaction details so contract can verify P2OP output during simulation
        // KEY: hasScriptPubKey populates output.scriptPublicKey (bytes the contract checks)
        // Must also include `to` for RPC validation
        market.setTransactionDetails({
          inputs: [],
          outputs: [{
            value: btcPaymentSats,
            index: 1, // index 0 is reserved
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: sellerP2OPScript,
            to: sellerP2OPAddress,
          }],
        });

        const sim = await withRetry(() => market.fillSellOrder(BigInt(orderId), fillAmtU256));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

        const tp = await buildTxParams(provider, walletAddress);
        // Use raw script for P2OP outputs — PSBT can't decode P2OP addresses
        (tp as unknown as Record<string, unknown>).extraOutputs = [{
          script: sellerP2OPScript,
          value: btcPaymentSats,
        }];
        (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = btcPaymentSats + 50_000n;
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      } else {
        // Seller accepts buy order: approve tokens → contract locks them
        // No BTC in this step — buyer will pay BTC later via executeBuyOrder
        setFillStep('Approving tokens for marketplace...');
        const totalRemaining = BigInt(Math.round((order.amount - order.amountFilled) * 1e8));
        await ensureAllowance(order.tokenAddress, MARKET_PUBKEY, totalRemaining, provider, senderAddr!, walletAddress, setFillStep);

        setFillStep('Accepting buy order (locking tokens)...');
        const sim = await withRetry(() => market.acceptBuyOrder(BigInt(orderId)));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

        const tp = await buildTxParams(provider, walletAddress);
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      }

      setFillStep(''); setFillId(null); setFillAmount('');
      toast('Order filled! Confirming...', 'success');
      setFilling(false);

      // Persist op
      trackOp({
        id: opId, market: 'p2p', orderId,
        direction: order.type, role: 'taker', step: 'Confirming...',
        amounts: { amount: String(fillAmt), price: String(order.pricePerToken), token: order.tokenSymbol },
      });

      fetch(`${MARKET_API}/market/fill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, filler: walletAddress, amount: fillAmt }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      waitForNextBlock(provider).then(() => {
        toast('Fill confirmed on-chain!', 'success');
        completeOp(opId);
        unlockOrder(lockKey, walletAddress);
        fetchOrders();
      }).catch(() => { unlockOrder(lockKey, walletAddress); });
      fetchOrders();
      return;
    } catch (e) {
      failOp(opId, formatTxError(e));
      unlockOrder(lockKey, walletAddress);
      setFillStep(formatTxError(e));
      setTimeout(() => setFillStep(''), 5000);
    } finally { setFilling(false); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, fetchOrders, toast, trackOp, completeOp, failOp]);

  // Execute accepted buy order — buyer pays BTC, gets tokens (TRUSTLESS)
  const handleExecuteBuyOrder = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }

    // Lock order
    const lockKey = `p2p:exec:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    setFilling(true); setFillStep('Preparing BTC payment...');
    const opId = `p2p:exec:${orderId}:${walletAddress}`;
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');
      if (order.status !== 'accepted') throw new Error('Order not accepted yet');

      const remaining = order.amount - order.amountFilled;
      const rawPayment = BigInt(Math.ceil(remaining * order.pricePerToken));
      const btcPaymentSats = rawPayment < 330n ? 330n : rawPayment; // enforce dust minimum
      // order.seller is the seller's MLDSA hash hex — build P2OP script and address
      const sellerP2OPScript = buildP2OPScript(order.seller);
      const sellerP2OPAddress = getP2OPAddress(order.seller);

      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKET_ABI, provider, NETWORK, senderAddr);

      setFillStep(`Sending ${Number(btcPaymentSats)} sats to seller...`);

      // Set transaction details so contract can verify P2OP output during simulation
      // KEY: hasScriptPubKey populates output.scriptPublicKey (bytes the contract checks)
      market.setTransactionDetails({
        inputs: [],
        outputs: [{
          value: btcPaymentSats,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: sellerP2OPScript,
          to: sellerP2OPAddress,
        }],
      });

      const sim = await withRetry(() => market.executeBuyOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      // Use raw script for P2OP outputs — PSBT can't decode P2OP addresses
      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: sellerP2OPScript,
        value: btcPaymentSats,
      }];
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = btcPaymentSats + 50_000n;
      await (sim as CallResult).sendTransaction(tp as TransactionParameters);

      setFillStep(''); setFillId(null);
      toast('Buy order executed! Confirming...', 'success');
      setFilling(false);

      // Persist op
      trackOp({
        id: opId, market: 'p2p', orderId,
        direction: 'buy', role: 'maker', step: 'Confirming...',
        amounts: { amount: String(remaining), price: String(order.pricePerToken), token: order.tokenSymbol },
      });

      waitForNextBlock(provider).then(() => {
        toast('Execution confirmed on-chain!', 'success');
        completeOp(opId);
        unlockOrder(lockKey, walletAddress);
        fetchOrders();
      }).catch(() => { unlockOrder(lockKey, walletAddress); });
      fetchOrders();
      return;
    } catch (e) {
      failOp(opId, formatTxError(e));
      unlockOrder(lockKey, walletAddress);
      setFillStep(formatTxError(e));
      setTimeout(() => setFillStep(''), 5000);
    } finally { setFilling(false); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, fetchOrders, trackOp, completeOp, failOp]);

  // Auto-detect ACCEPTED buy orders and auto-execute (buyer pays BTC via wallet popup)
  const autoExecuteRef = useRef(false);
  useEffect(() => {
    if (!walletAddress || !senderAddr || !selectedToken) return;
    const interval = setInterval(async () => {
      if (autoExecuteRef.current || filling) return;
      const freshOrders = await fetchOrdersOnChain(selectedToken);
      const myAccepted = freshOrders.find(
        o => o.type === 'buy' && o.status === 'accepted' && o.creator === senderHex
      );
      if (myAccepted) {
        autoExecuteRef.current = true;
        setOrders(freshOrders);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Buy Order Accepted!', { body: 'A seller locked tokens. Approve BTC payment in your wallet.' });
        }
        setMsg('Seller accepted your buy order! Approve BTC payment...');
        await handleExecuteBuyOrder(myAccepted.id);
        autoExecuteRef.current = false;
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [walletAddress, senderAddr, selectedToken, filling, fetchOrdersOnChain, handleExecuteBuyOrder]);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Cancel order — ON-CHAIN
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) return;
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKET_ABI, provider, NETWORK, senderAddr);
      const sim = await withRetry(() => market.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp as TransactionParameters);

      toast('Order cancel submitted! Confirming...', 'success');
      fetch(`${MARKET_API}/market/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, creator: walletAddress }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      waitForNextBlock(provider).then(() => {
        toast('Cancel confirmed!', 'success');
        fetchOrders();
      }).catch(() => {});
      fetchOrders();
    } catch (e) {
      setMsg(formatTxError(e));
      setTimeout(() => setMsg(''), 5000);
    }
  }, [walletAddress, senderAddr, provider, fetchOrders, walletAddress]);

  // Select token from search input (direct address entry or symbol search)
  const handleSearchSelect = () => {
    const q = search.trim().toLowerCase();
    // Match by symbol first
    const bySymbol = tokenList.find(t => t.symbol.toLowerCase() === q);
    if (bySymbol) { setSelectedToken(bySymbol.address); return; }
    // Match by address
    if (search.startsWith('opt1sq') && search.length > 20) {
      setSelectedToken(search);
      // Add to token list if not present
      if (!tokenList.find(t => t.address === search)) {
        // Try to find pubkey from known tokens
        const known = KNOWN_TOKENS.find(k => k.address === search);
        setTokenList(prev => [...prev, {
          address: search,
          pubkey: known?.pubkey || '',
          symbol: known?.symbol || search.slice(-6).toUpperCase(),
          name: known?.name || 'OP20 Token',
          decimals: known?.decimals || 8,
          sellCount: 0, buyCount: 0, totalVolume: 0,
        }]);
      }
    }
  };

  /* ─── RENDER ─── */

  // ════════════════════════════════
  // TOKEN DETAIL VIEW (orderbook)
  // ════════════════════════════════
  if (selectedToken) {
    const [c1] = hashColor(selInfo?.symbol || '??');
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Back button + header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => { setSelectedToken(null); setOrders([]); }}
            style={{ padding: '6px 14px', borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t3)', fontSize: '.74rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            &larr; Back
          </button>
          <img src={genLogo(selInfo?.symbol || '??')} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--w)' }}>{selInfo?.symbol || selectedToken.slice(-8)}</div>
            <div style={{ fontSize: '.64rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>{selectedToken}</div>
          </div>
        </div>

        {msg && (
          <div style={{ padding: '10px 14px', background: msg.startsWith('Error') || msg.startsWith('Revert') ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)', border: `1px solid ${msg.startsWith('Error') || msg.startsWith('Revert') ? 'rgba(239,68,68,.15)' : 'rgba(16,185,129,.15)'}`, borderRadius: 10, fontSize: '.74rem', color: msg.startsWith('Error') || msg.startsWith('Revert') ? '#ef4444' : 'var(--g)', marginBottom: 12 }}>
            {msg}
            {lastTxId && <a href={getTxUrl(lastTxId)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: 'var(--ac)', textDecoration: 'underline' }}>View on OPScan</a>}
          </div>
        )}

        {/* Two-column: Sell orders | Buy orders — exchange-style tables */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* SELL ORDERS (asks) */}
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#ef4444', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              Sell Orders
              <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>Asks</span>
              <span className="ob-badge" style={{ background: 'rgba(239,68,68,.1)', color: '#ef4444', marginLeft: 'auto' }}>{sellOrders.length}</span>
            </div>
            {sellOrders.length === 0 ? (
              <div className="ob-empty">No sell orders yet</div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 80px 1fr 45px auto' }}>
                  <span>Amount</span><span className="ob-r">Price</span><span className="ob-r">Total</span>
                  <span className="ob-r">Fill</span><span className="ob-r">Action</span>
                </div>
                {sellOrders.map(o => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  const pct = o.amount > 0 ? Math.round((o.amountFilled / o.amount) * 100) : 0;
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 80px 1fr 45px auto' }}>
                      <span className="ob-mono" style={{ color: 'var(--t1)' }}>
                        {fmtNum(remaining)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r" style={{ color: '#ef4444', fontWeight: 700 }}>{o.pricePerToken}</span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--o)' }}>{fmtNum(totalCostSats)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>sat</span></span>
                      <span className="ob-r" style={{ position: 'relative' }}>
                        <span style={{ color: 'var(--t2)' }}>{pct}%</span>
                        {pct > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1, background: 'rgba(255,255,255,.08)' }}>
                          <div style={{ height: '100%', borderRadius: 1, background: 'rgba(239,68,68,.5)', width: `${pct}%` }} />
                        </div>}
                      </span>
                      <div className="ob-act">
                        {o.creator === senderHex ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : fillId === o.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input value={fillAmount} onChange={e => setFillAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder={`${fmtNum(remaining)}`}
                              style={{ ...iStyle, width: 80, padding: '3px 6px', fontSize: '.64rem' }} />
                            <button className="ob-btn green" onClick={() => handleFill(o.id, parseFloat(fillAmount) || remaining)} disabled={filling}>
                              {filling ? '..' : 'OK'}
                            </button>
                            <button className="ob-btn" onClick={() => { setFillId(null); setFillAmount(''); }}>X</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="ob-btn green" onClick={() => handleFill(o.id)} disabled={filling}>Buy</button>
                            <button className="ob-btn" onClick={() => setFillId(o.id)}>Partial</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BUY ORDERS (bids) */}
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: 'var(--g)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              Buy Orders
              <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>Bids</span>
              <span className="ob-badge" style={{ background: 'rgba(16,185,129,.1)', color: 'var(--g)', marginLeft: 'auto' }}>{buyOrders.length}</span>
            </div>
            {buyOrders.length === 0 ? (
              <div className="ob-empty">No buy orders yet</div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 80px 1fr 60px auto' }}>
                  <span>Wants</span><span className="ob-r">Price</span><span className="ob-r">Pays</span>
                  <span>Status</span><span className="ob-r">Action</span>
                </div>
                {buyOrders.map(o => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  const isMyBuyOrder = o.creator === senderHex;
                  const isAccepted = o.status === 'accepted';
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 80px 1fr 60px auto' }}>
                      <span className="ob-mono" style={{ color: 'var(--t1)' }}>
                        {fmtNum(remaining)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--g)', fontWeight: 700 }}>{o.pricePerToken}</span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--o)' }}>{fmtNum(totalCostSats)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>sat</span></span>
                      <span>
                        {isAccepted
                          ? <span className="ob-badge" style={{ background: 'rgba(247,147,26,.15)', color: 'var(--o)' }}>ACCEPTED</span>
                          : <span className="ob-badge" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--g)' }}>OPEN</span>}
                      </span>
                      <div className="ob-act">
                        {isAccepted && isMyBuyOrder ? (
                          <>
                            <button className="ob-btn accent" onClick={() => handleExecuteBuyOrder(o.id)} disabled={filling}>
                              {filling ? '..' : `Pay ${fmtNum(totalCostSats)}`}
                            </button>
                            <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>X</button>
                          </>
                        ) : isMyBuyOrder || (isAccepted && o.seller === senderHex) ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : !isAccepted ? (
                          <button className="ob-btn accent" onClick={() => handleFill(o.id)} disabled={filling}>
                            {filling ? '..' : 'Accept'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '.62rem', color: 'var(--t3)' }}>Awaiting pay</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {fillStep && (
          <div style={{ padding: '10px 14px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.15)', borderRadius: 10, fontSize: '.72rem', color: 'var(--o)', marginBottom: 12 }}>
            {fillStep}
          </div>
        )}

        {/* Create order form */}
        <div className="P" style={{ padding: 18, marginBottom: 16 }}>
          <div className="Lb" style={{ marginBottom: 10 }}>Place Order</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['sell', 'buy'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                style={{
                  flex: 1, padding: '8px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700, fontSize: '.76rem',
                  border: '1px solid ' + (orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.4)' : 'rgba(16,185,129,.4)') : 'var(--bd)'),
                  background: orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)') : 'transparent',
                  color: orderType === t ? (t === 'sell' ? '#ef4444' : 'var(--g)') : 'var(--t3)',
                }}>
                {t === 'sell' ? 'Sell Tokens' : 'Buy Tokens (Bid)'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>
                {orderType === 'sell' ? 'Amount to sell' : 'Amount you want'}
              </label>
              <input style={iStyle} type="text" inputMode="numeric" value={orderAmount}
                onChange={e => setOrderAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="100000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Price (sats/token)</label>
              <input style={iStyle} type="text" inputMode="decimal" value={orderPrice}
                onChange={e => setOrderPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.5" />
            </div>
          </div>
          {orderAmount && orderPrice && (
            <div style={{ padding: '8px 12px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 10, fontSize: '.68rem', color: 'var(--t3)', marginBottom: 12 }}>
              Total: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {fmtNum(Math.floor(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0')))} sats
              </strong>
              {' '}({(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0') / 1e8).toFixed(6)} BTC)
            </div>
          )}
          {createStep && <div style={{ fontSize: '.68rem', color: createStep.includes('Failed') ? '#ef4444' : 'var(--o)', marginBottom: 8, textAlign: 'center' }}>{createStep}</div>}
          <button onClick={handleCreate} disabled={creating || !orderAmount || !orderPrice}
            className="lbtn" style={{ width: '100%', opacity: creating ? 0.6 : 1 }}>
            {creating ? 'Creating...' : walletAddress ? `Place ${orderType === 'sell' ? 'Sell' : 'Buy'} Order` : 'Connect Wallet'}
          </button>
          <div style={{ marginTop: 8, fontSize: '.54rem', color: 'var(--t4)', textAlign: 'center' }}>
            {orderType === 'sell'
              ? 'Tokens are locked in the P2PMarket contract on-chain. Buyers pay BTC directly to you.'
              : 'Trustless 3-step: 1) You post buy intent → 2) Seller locks tokens in contract → 3) You pay BTC and receive tokens automatically.'}
          </div>
        </div>

        {/* My orders — table */}
        {myOrders.length > 0 && (
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.82rem', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              My Orders
              <span className="ob-badge" style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', marginLeft: 'auto' }}>{myOrders.length}</span>
            </div>
            <div className="ob-scroll">
              <div className="ob-hdr" style={{ gridTemplateColumns: '55px 1fr 80px 65px auto' }}>
                <span>Type</span><span>Filled</span><span className="ob-r">Price</span>
                <span>Status</span><span className="ob-r">Action</span>
              </div>
              {myOrders.map(o => (
                <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '55px 1fr 80px 65px auto' }}>
                  <span>
                    <span className="ob-badge" style={{
                      background: o.type === 'sell' ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)',
                      color: o.type === 'sell' ? '#ef4444' : 'var(--g)',
                    }}>{o.type.toUpperCase()}</span>
                  </span>
                  <span className="ob-mono" style={{ color: 'var(--t1)' }}>{fmtNum(o.amountFilled)}/{fmtNum(o.amount)}</span>
                  <span className="ob-mono ob-r" style={{ color: 'var(--t2)' }}>{o.pricePerToken} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>sat</span></span>
                  <span>
                    <span className="ob-badge" style={{
                      background: o.status === 'active' ? 'rgba(16,185,129,.12)' : 'rgba(255,255,255,.06)',
                      color: o.status === 'active' ? 'var(--g)' : 'var(--t3)',
                    }}>{o.status}</span>
                  </span>
                  <div className="ob-act">
                    {o.status === 'active' && (
                      <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════
  // TOKEN LIST VIEW
  // ════════════════════════════════
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--w)', marginBottom: 4 }}>Marketplace <span style={{ fontSize: '.6rem', color: 'var(--g)', fontWeight: 500 }}>ON-CHAIN</span></h2>
        <p style={{ fontSize: '.74rem', color: 'var(--t3)', margin: 0 }}>
          P2P orderbook for OP20 tokens. Orders are executed on-chain via{' '}
          <a href={getContractOpscanUrl(MARKET_ADDRESS)} target="_blank" rel="noopener" style={{ color: 'var(--o)', textDecoration: 'none' }}>P2PMarket contract</a>.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, symbol or paste contract address..."
          onKeyDown={e => e.key === 'Enter' && handleSearchSelect()}
          style={{ ...iStyle, flex: 1 }} />
        {search.startsWith('opt1sq') && search.length > 20 && (
          <button onClick={handleSearchSelect} className="lbtn" style={{ padding: '10px 18px', fontSize: '.74rem', flexShrink: 0 }}>
            Open &rarr;
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--t4)', fontSize: '.82rem' }}>Loading tokens...</div>
      ) : filteredTokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>&#x1F50D;</div>
          <div style={{ color: 'var(--t4)', fontSize: '.82rem', marginBottom: 6 }}>No tokens found</div>
          <div style={{ color: 'var(--t4)', fontSize: '.66rem' }}>Paste a contract address above to open its orderbook</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {filteredTokens.map(t => {
            const [c1] = hashColor(t.symbol);
            return (
              <div key={t.address} onClick={() => setSelectedToken(t.address)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 16,
                  cursor: 'pointer', transition: 'border-color .15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = c1)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--bd)')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <img src={genLogo(t.symbol)} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--w)' }}>{t.symbol}</div>
                    <div style={{ fontSize: '.62rem', color: 'var(--t4)' }}>{t.name}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.64rem', color: 'var(--t3)' }}>
                  <span>Sells: <strong style={{ color: '#ef4444' }}>{t.sellCount}</strong></span>
                  <span>Bids: <strong style={{ color: 'var(--g)' }}>{t.buyCount}</strong></span>
                  <span>Vol: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>{fmtNum(t.totalVolume)}</strong></span>
                </div>
                <div style={{ fontSize: '.52rem', color: 'var(--t4)', fontFamily: 'var(--fm)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.address}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
