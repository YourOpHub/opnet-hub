/**
 * useMarketplace — business logic hook extracted from Marketplace.tsx
 *
 * Encapsulates:
 *  - Order state management (orders, loading)
 *  - Token list state + fetching
 *  - createSellOrder, createBuyOrder (via handleCreate)
 *  - fillSellOrder, acceptBuyOrder (via handleFill)
 *  - executeBuyOrder (via handleExecuteBuyOrder)
 *  - cancelOrder (via handleCancel)
 *  - Order fetching / polling
 *  - Auto-execute accepted buy orders
 *  - Order locking
 *  - senderHex computation
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract,
  TransactionOutputFlags,
  type CallResult, type BaseContractProperties,
  type TransactionParameters,
} from 'opnet';
import { MARKETPLACE_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { Address } from '@btc-vision/transaction';
import { ensureAllowance, buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import { MARKET_ADDRESS, MARKET_PUBKEY, DEPLOYED_CONTRACTS, getContractOpscanUrl, getTxUrl, addressToPubkey } from '../contracts';
import { useToast } from '../components/Toast';
import { lockOrder, unlockOrder, getActiveLocks } from '../swapApi';
import { useOps } from '../contexts/OpsContext';

const MARKET_API = import.meta.env.VITE_API_URL || '';

/** Typed interface for P2PMarket contract methods */
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

export interface Order {
  id: string;
  type: 'sell' | 'buy';
  creator: string;
  seller: string;
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

export interface MarketToken {
  address: string;
  pubkey: string;
  symbol: string;
  name: string;
  decimals: number;
  sellCount: number;
  buyCount: number;
  totalVolume: number;
}

const KNOWN_TOKENS: MarketToken[] = Object.values(DEPLOYED_CONTRACTS).map(t => ({
  address: t.address,
  pubkey: t.pubkey,
  symbol: t.symbol,
  name: t.name,
  decimals: t.decimals,
  sellCount: 0,
  buyCount: 0,
  totalVolume: 0,
}));

function resolveTokenHex(hex64: string): { address: string; symbol: string; name: string; decimals: number } | null {
  const withPrefix = '0x' + hex64;
  const found = KNOWN_TOKENS.find(t => t.pubkey === withPrefix);
  if (found) return { address: found.address, symbol: found.symbol, name: found.name, decimals: found.decimals };
  return null;
}

/** Build a P2OP scriptPubKey from a 64-char hex string */
export function buildP2OPScript(mldsaHex: string): Buffer {
  const bytes = new Uint8Array(34);
  bytes[0] = 0x60;
  bytes[1] = 0x20;
  for (let i = 0; i < 32; i++) {
    bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  }
  return Buffer.from(bytes);
}

/** Get P2OP bech32m address from 64-char MLDSA hash hex */
export function getP2OPAddress(mldsaHex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Address.wrap(bytes).p2op(NETWORK);
}

// Re-export for components that need them
export { KNOWN_TOKENS, resolveTokenHex, getContractOpscanUrl, getTxUrl, MARKET_ADDRESS };

export function useMarketplace() {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { toast } = useToast();

  const senderHex = useMemo(() => {
    if (!senderAddr) return '';
    try {
      const bytes = new Uint8Array(senderAddr as unknown as ArrayBufferLike);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { console.warn('[useMarketplace] Failed to convert senderAddr to hex:', e); return ''; }
  }, [senderAddr]);

  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenList, setTokenList] = useState<MarketToken[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [orderType, setOrderType] = useState<'sell' | 'buy'>('sell');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  const [fillId, setFillId] = useState<string | null>(null);
  const [fillAmount, setFillAmount] = useState('');
  const [filling, setFilling] = useState(false);
  const [fillStep, setFillStep] = useState('');

  const [msg, setMsg] = useState('');

  const { trackOp, completeOp, failOp } = useOps();

  // Order locks polling
  useEffect(() => {
    const iv = setInterval(() => getActiveLocks(), 15_000);
    return () => clearInterval(iv);
  }, []);

  // Read orders directly from on-chain contract
  const fetchOrdersOnChain = useCallback(async (tokenFilter?: string) => {
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKETPLACE_ABI, provider, NETWORK);
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
          if (status !== 1 && status !== 4) continue;
          const tokenHex = ((p.token ?? 0n) as bigint).toString(16).padStart(64, '0');
          const resolved = resolveTokenHex(tokenHex);
          const tokenBech32 = resolved?.address || tokenHex;
          if (tokenFilter) {
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
            status: statusStr as Order['status'],
            fills: [],
          });
        } catch (e) { console.warn(`[useMarketplace] Skipping unreadable order #${i}:`, e); }
      }
      return chainOrders;
    } catch (e) { console.warn('[useMarketplace] Failed to fetch on-chain orders:', e); return []; }
  }, [provider]);

  // Fetch token list
  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${MARKET_API}/market/tokens`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const serverTokens = (await res.json()).tokens || [];
        const merged = serverTokens.map((st: MarketToken) => {
          const known = KNOWN_TOKENS.find(k => k.address === st.address);
          return { ...st, pubkey: st.pubkey || known?.pubkey || '', decimals: st.decimals || known?.decimals || 8 };
        });
        for (const kt of KNOWN_TOKENS) {
          if (!merged.find((m: MarketToken) => m.address === kt.address)) merged.push(kt);
        }
        setTokenList(merged);
        setLoading(false);
        return;
      }
    } catch (e) { console.warn('[useMarketplace] Token server offline, using fallback:', e); }
    setTokenList(KNOWN_TOKENS);
    setLoading(false);
  }, []);

  // Fetch orders from chain
  const fetchOrders = useCallback(async (tokenAddr?: string) => {
    const addr = tokenAddr || selectedToken;
    if (!addr) return;
    const chainOrders = await fetchOrdersOnChain(addr);
    setOrders(chainOrders);
  }, [selectedToken, fetchOrdersOnChain]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);
  useEffect(() => { if (selectedToken) fetchOrders(); }, [selectedToken, fetchOrders]);

  // Derived state
  const filteredTokens = useMemo(() => {
    if (!search) return tokenList;
    const q = search.toLowerCase();
    return tokenList.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [tokenList, search]);

  const selInfo = tokenList.find(t => t.address === selectedToken);

  const sellOrders = orders.filter(o => o.type === 'sell' && o.status === 'active').sort((a, b) => a.pricePerToken - b.pricePerToken);
  const buyOrders = orders.filter(o => o.type === 'buy' && (o.status === 'active' || o.status === 'accepted')).sort((a, b) => b.pricePerToken - a.pricePerToken);
  const myOrders = orders.filter(o => o.creator === senderHex || o.seller === senderHex);

  // Create order
  const handleCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!selectedToken || !orderAmount || !orderPrice) return;
    const amt = parseFloat(orderAmount);
    const ppt = parseFloat(orderPrice);
    if (amt <= 0 || ppt <= 0) return;

    setCreating(true);
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKETPLACE_ABI, provider, NETWORK, senderAddr);
      const decimals = selInfo?.decimals || 8;
      const amountU256 = BigInt(Math.round(amt * Math.pow(10, decimals)));
      const priceU256 = BigInt(Math.round(ppt));

      const pubkey = selInfo?.pubkey || addressToPubkey(selectedToken);
      const tokenAddr = Address.fromString(pubkey);

      if (orderType === 'sell') {
        setCreateStep('Approving tokens for marketplace...');
        await ensureAllowance(selectedToken, MARKET_PUBKEY, amountU256, provider, senderAddr!, walletAddress, setCreateStep, selInfo?.symbol || 'token');

        setCreateStep('Creating sell order on-chain...');
        const sim = await withRetry(() => market.createSellOrder(tokenAddr, amountU256, priceU256));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
        const tp = await buildTxParams(provider, walletAddress);
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      } else {
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

      const createOpId = `p2p:create:${Date.now()}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'p2p', orderId: 'pending',
        direction: orderType, role: 'maker', step: 'Confirming...',
        amounts: { amount: orderAmount, price: orderPrice, token: selInfo?.symbol || '' },
      });

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
      } catch (e) { console.warn('[useMarketplace] Indexer notification failed:', e); }

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

  // Fill order
  const handleFill = useCallback(async (orderId: string, amount?: number) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }

    const lockKey = `p2p:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    setFilling(true); setFillStep('Preparing fill...');
    const opId = `p2p:fill:${orderId}:${walletAddress}`;
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      if (order.creator === senderHex || order.seller === senderHex) {
        throw new Error('Cannot fill your own order. Use a different wallet.');
      }

      const fillAmt = amount || (order.amount - order.amountFilled);
      const fillAmtU256 = BigInt(Math.round(fillAmt * 1e8));

      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKETPLACE_ABI, provider, NETWORK, senderAddr);

      if (order.type === 'sell') {
        const rawPayment = BigInt(Math.ceil(fillAmt * order.pricePerToken));
        const btcPaymentSats = rawPayment < 330n ? 330n : rawPayment;
        const sellerP2OPScript = buildP2OPScript(order.creator);
        const sellerP2OPAddress = getP2OPAddress(order.creator);

        setFillStep(`Sending ${Number(btcPaymentSats)} sats to seller...`);

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

        const sim = await withRetry(() => market.fillSellOrder(BigInt(orderId), fillAmtU256));
        if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

        const tp = await buildTxParams(provider, walletAddress);
        (tp as unknown as Record<string, unknown>).extraOutputs = [{
          script: sellerP2OPScript,
          value: Number(btcPaymentSats),
        }];
        (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = btcPaymentSats + 50_000n;
        await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      } else {
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

  // Execute accepted buy order
  const handleExecuteBuyOrder = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }

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
      const btcPaymentSats = rawPayment < 330n ? 330n : rawPayment;
      const sellerP2OPScript = buildP2OPScript(order.seller);
      const sellerP2OPAddress = getP2OPAddress(order.seller);

      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKETPLACE_ABI, provider, NETWORK, senderAddr);

      setFillStep(`Sending ${Number(btcPaymentSats)} sats to seller...`);

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
      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: sellerP2OPScript,
        value: Number(btcPaymentSats),
      }];
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = btcPaymentSats + 50_000n;
      await (sim as CallResult).sendTransaction(tp as TransactionParameters);

      setFillStep(''); setFillId(null);
      toast('Buy order executed! Confirming...', 'success');
      setFilling(false);

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
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, fetchOrders, toast, trackOp, completeOp, failOp]);

  // Auto-detect ACCEPTED buy orders and auto-execute
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

  // Cancel order
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) return;
    try {
      const market = getContract<MarketContract>(MARKET_ADDRESS, MARKETPLACE_ABI, provider, NETWORK, senderAddr);
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
  }, [walletAddress, senderAddr, provider, fetchOrders]);

  // Select token from search input
  const handleSearchSelect = useCallback(() => {
    const q = search.trim().toLowerCase();
    const bySymbol = tokenList.find(t => t.symbol.toLowerCase() === q);
    if (bySymbol) { setSelectedToken(bySymbol.address); return; }
    if (search.startsWith('opt1sq') && search.length > 20) {
      setSelectedToken(search);
      if (!tokenList.find(t => t.address === search)) {
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
  }, [search, tokenList]);

  return {
    // Wallet
    walletAddress,
    connected: !!walletAddress,
    senderAddr,
    senderHex,
    openConnectModal,
    provider,
    // Token list
    tokenList,
    loading,
    filteredTokens,
    search, setSearch,
    handleSearchSelect,
    // Token detail
    selectedToken, setSelectedToken,
    selInfo,
    // Orders
    orders, setOrders,
    sellOrders,
    buyOrders,
    myOrders,
    fetchOrders,
    fetchOrdersOnChain,
    // Create order form
    orderType, setOrderType,
    orderAmount, setOrderAmount,
    orderPrice, setOrderPrice,
    creating,
    createStep,
    handleCreate,
    // Fill form
    fillId, setFillId,
    fillAmount, setFillAmount,
    filling,
    fillStep,
    handleFill,
    handleExecuteBuyOrder,
    handleCancel,
    // Status
    msg, setMsg,
    lastTxId: null as string | null,
  };
}
