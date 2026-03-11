/**
 * useCrossChainState — shared state, polling, derived state
 *
 * Encapsulates:
 *  - UniSat wallet state (connect/disconnect)
 *  - FractalSwap orders fetching & polling
 *  - Token Escrow orders fetching & polling
 *  - Block height polling
 *  - Fee info fetching
 *  - Order locks polling
 *  - Preimage store (localStorage)
 *  - Rate persistence (localStorage + server)
 *  - Derived state (myOrders, otherOpenOrders, availBuyFb, availGetBtc, etc.)
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, type BaseContractProperties, type CallResult } from 'opnet';
import { type Address } from '@btc-vision/transaction';
import { FRACTALSWAP_ABI, TOKEN_ESCROW_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import { getActiveLocks, type OrderLock } from '../swapApi';
import { useOps } from '../contexts/OpsContext';
import { CROSSCHAIN_ADDRESS, TOKEN_ESCROW_ADDRESS } from '../contracts';
import {
  type FractalSwapOrder, OrderStatus, SwapDirection,
} from '../crosschain/types';
import { useToast } from '../components/Toast';
import {
  type UnisatWalletState,
  isUnisatInstalled, connectUnisat, disconnectUnisat,
} from '../wallets/unisat';
import { suggestedExpiryBlocks } from '../crosschain/chains';
import {
  TOKEN_OPTIONS, DIR_SELL_TOKEN, type BridgeMode, type TokenEscrowOrder,
} from './crossChainShared';

// Re-export for child components
export { isUnisatInstalled };

/** Typed interface for FractalSwap contract (read-only subset) */
interface FractalSwapContract extends BaseContractProperties {
  getOrder(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
  getFeeInfo(): Promise<CallResult>;
}

/** Typed interface for TokenEscrowBridge contract (read-only subset) */
interface TokenEscrowContract extends BaseContractProperties {
  getOrder(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
}

export interface CrossChainState {
  // Wallet
  walletAddress: string | null;
  openConnectModal: () => void;
  mldsaHex: string;
  senderAddr: Address | null;
  provider: ReturnType<typeof getProvider>;

  // UniSat
  unisat: UnisatWalletState;
  unisatConnecting: boolean;
  handleConnectUnisat: () => Promise<void>;
  handleDisconnectUnisat: () => void;

  // FractalSwap orders
  orders: FractalSwapOrder[];
  loading: boolean;
  fetchOrders: () => Promise<void>;

  // Block / fee
  currentBlock: number;
  feeBps: number;

  // Locks
  locks: Record<string, OrderLock>;

  // Preimage store
  preimageStore: Record<string, string>;
  savePreimage: (orderId: string, preimage: string) => void;

  // Rate persistence
  saveRate: (orderId: string, rateNum: number, receiveSats: bigint, sendSats: bigint, sUnit: string, rUnit: string) => void;

  // UI state (shared across sub-hooks)
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  msg: string;
  setMsg: (msg: string) => void;
  actionStep: string;
  setActionStep: (step: string) => void;
  actioning: string | null;
  setActioning: (id: string | null) => void;

  // Create form
  formDirection: SwapDirection;
  setFormDirection: (d: SwapDirection) => void;
  formAmount: string;
  setFormAmount: (v: string) => void;
  formReceive: string;
  setFormReceive: (v: string) => void;
  formMakerAddr: string;
  setFormMakerAddr: (v: string) => void;
  setMakerAddrManual: (v: boolean) => void;
  formExpiry: string;
  setFormExpiry: (v: string) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  createStep: string;
  setCreateStep: (v: string) => void;

  // Contract readiness
  contractReady: boolean;
  escrowReady: boolean;

  // FractalSwap derived state
  activeOrders: FractalSwapOrder[];
  myOrders: FractalSwapOrder[];
  otherOpenOrders: FractalSwapOrder[];
  totalVolumeSats: bigint;
  availBuyFb: FractalSwapOrder[];
  availGetBtc: FractalSwapOrder[];
  isMyOrderFn: (o: FractalSwapOrder) => boolean;
  isTakerFn: (o: FractalSwapOrder) => boolean;

  // Computed form values
  formAmountSats: bigint;
  formReceiveSats: bigint;
  formFeeSats: bigint;
  formRate: string;
  sendUnit: string;
  receiveUnit: string;
  expiryOpts: ReturnType<typeof suggestedExpiryBlocks>;

  // Token Bridge state
  escrowOrders: TokenEscrowOrder[];
  escrowLoading: boolean;
  fetchEscrowOrders: () => Promise<void>;
  tbToken: string;
  setTbToken: (v: string) => void;
  tbDirection: number;
  setTbDirection: (v: number) => void;
  tbTokenAmount: string;
  setTbTokenAmount: (v: string) => void;
  tbBtcPrice: string;
  setTbBtcPrice: (v: string) => void;
  tbMakerAddr: string;
  setTbMakerAddr: (v: string) => void;
  tbExpiry: string;
  setTbExpiry: (v: string) => void;
  tbCreating: boolean;
  setTbCreating: (v: boolean) => void;
  tbStep: string;
  setTbStep: (v: string) => void;

  // Token Bridge derived state
  activeEscrowOrders: TokenEscrowOrder[];
  sellTokenOrders: TokenEscrowOrder[];
  buyTokenOrders: TokenEscrowOrder[];
  selectedTbToken: (typeof TOKEN_OPTIONS)[number] | undefined;
  tbTokenAmountRaw: bigint;
  tbBtcPriceSats: bigint;
  tbFeeSats: bigint;

  // Ops context
  trackOp: ReturnType<typeof useOps>['trackOp'];
  updateOpStep: ReturnType<typeof useOps>['updateOpStep'];
  completeOp: ReturnType<typeof useOps>['completeOp'];
  failOp: ReturnType<typeof useOps>['failOp'];

  // Toast
  toast: ReturnType<typeof useToast>['toast'];

  // Mode
  mode: BridgeMode;
}

/**
 * Shared cross-chain state: wallet connections, order polling, block height, fee info, and derived order views.
 * @returns Complete cross-chain state consumed by useFractalSwap and useTokenEscrow.
 */
export function useCrossChainState(): CrossChainState {
  const { walletAddress, address: senderAddr, openConnectModal, hashedMLDSAKey } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

  const mldsaHex = useMemo(() => {
    if (!hashedMLDSAKey) return '';
    return (hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey).toLowerCase();
  }, [hashedMLDSAKey]);

  const { toast } = useToast();
  const { trackOp, updateOpStep, completeOp, failOp } = useOps();

  // ── UniSat wallet state ──
  const [unisat, setUnisat] = useState<UnisatWalletState>({
    connected: false, address: '', publicKey: '',
    balance: { confirmed: 0, unconfirmed: 0, total: 0 },
    chain: { enum: '', name: '', network: '' },
  });
  const [unisatConnecting, setUnisatConnecting] = useState(false);

  const [msg, setMsg] = useState('');

  const handleConnectUnisat = useCallback(async () => {
    setUnisatConnecting(true);
    try {
      const state = await connectUnisat(CURRENT_ENV !== 'mainnet');
      setUnisat(state);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'UniSat connection failed');
      setTimeout(() => setMsg(''), 5000);
    } finally { setUnisatConnecting(false); }
  }, []);

  const handleDisconnectUnisat = useCallback(() => {
    setUnisat(disconnectUnisat());
  }, []);

  // ── FractalSwap order state ──
  const [orders, setOrders] = useState<FractalSwapOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState(100);

  // ── Create form ──
  const [formDirection, setFormDirection] = useState<SwapDirection>(SwapDirection.BTC_TO_FB);
  const [formAmount, setFormAmount] = useState('');
  const [formReceive, setFormReceive] = useState('');
  const [formMakerAddr, setFormMakerAddr] = useState('');
  const [formExpiry, setFormExpiry] = useState('144');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  // ── Shared action state ──
  const [actionStep, setActionStep] = useState('');
  const [actioning, setActioning] = useState<string | null>(null);

  // ── Order locks ──
  const [locks, setLocks] = useState<Record<string, OrderLock>>({});
  useEffect(() => {
    void getActiveLocks().then(setLocks);
    const iv = setInterval(() => void getActiveLocks().then(setLocks), 15_000);
    return () => clearInterval(iv);
  }, []);

  // ── Preimage store (sessionStorage — preimages are sensitive, should not persist across sessions) ──
  const [preimageStore, setPreimageStore] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem('fractalswap_preimages') ?? '{}') as Record<string, string>; } catch (e) { logger.warn('[CrossChain] Failed to parse preimage store:', e); return {}; }
  });
  const savePreimage = useCallback((orderId: string, preimage: string) => {
    setPreimageStore(prev => {
      const next = { ...prev, [orderId]: preimage };
      sessionStorage.setItem('fractalswap_preimages', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Bridge mode ──
  const [mode] = useState<BridgeMode>('fractalswap');

  // ── Token Bridge state ──
  const [escrowOrders, setEscrowOrders] = useState<TokenEscrowOrder[]>([]);
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [tbToken, setTbToken] = useState(TOKEN_OPTIONS[0]?.address || '');
  const [tbDirection, setTbDirection] = useState<number>(DIR_SELL_TOKEN);
  const [tbTokenAmount, setTbTokenAmount] = useState('');
  const [tbBtcPrice, setTbBtcPrice] = useState('');
  const [tbMakerAddr, setTbMakerAddr] = useState('');
  const [tbExpiry, setTbExpiry] = useState('144');
  const [tbCreating, setTbCreating] = useState(false);
  const [tbStep, setTbStep] = useState('');

  const contractReady = !!CROSSCHAIN_ADDRESS;
  const escrowReady = !!TOKEN_ESCROW_ADDRESS;

  // ── Auto-fill maker address from connected wallets ──
  const [makerAddrManual, setMakerAddrManual] = useState(false);
  useEffect(() => {
    if (makerAddrManual) return;
    if (formDirection === SwapDirection.BTC_TO_FB && unisat.connected && unisat.address) {
      setFormMakerAddr(unisat.address);
    } else if (formDirection === SwapDirection.FB_TO_BTC && walletAddress) {
      setFormMakerAddr(walletAddress);
    }
  }, [unisat.connected, unisat.address, formDirection, makerAddrManual, walletAddress]);

  useEffect(() => { setMakerAddrManual(false); }, [formDirection]);

  useEffect(() => {
    if (tbMakerAddr) return;
    if (tbDirection === DIR_SELL_TOKEN && walletAddress) {
      setTbMakerAddr(walletAddress);
    }
  }, [tbDirection, walletAddress, tbMakerAddr]);

  // ── Block height polling ──
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const b = await provider.getBlockNumber();
        if (!cancelled) setCurrentBlock(Number(b));
      } catch (e) { logger.warn('[CrossChain] Block height poll failed:', e); }
    };
    void poll();
    const iv = setInterval(() => void poll(), 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [provider]);

  // ── Fee info ──
  useEffect(() => {
    if (!contractReady) return;
    void (async () => {
      try {
        const c = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK);
        const r = await c.getFeeInfo();
        const feeProps = r?.properties as Record<string, unknown> | undefined;
        if (feeProps?.feeBps != null) setFeeBps(Number(feeProps.feeBps));
      } catch (e) { logger.warn('[CrossChain] Fee info fetch failed:', e); }
    })();
  }, [provider, contractReady]);

  // ── FractalSwap: Fetch orders ──
  const fetchOrders = useCallback(async () => {
    if (!contractReady) { setLoading(false); return; }
    try {
      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK);
      const nextIdResult = await market.getNextOrderId();
      const nextIdProps = nextIdResult?.properties as Record<string, bigint> | undefined;
      const nextId = Number(nextIdProps?.nextOrderId ?? 1n);
      const fetched: FractalSwapOrder[] = [];
      for (let i = 1; i < nextId && i < 200; i++) {
        try {
          const r = await market.getOrder(BigInt(i));
          if (r?.properties == null) continue;
          const p = r.properties as Record<string, bigint>;
          const status = Number(p.status ?? 0n);
          if (status === 0) continue;
          fetched.push({
            id: String(i),
            direction: Number(p.direction ?? 0n) as SwapDirection,
            status: status as OrderStatus,
            creator: (p.creator ?? 0n).toString(16).padStart(64, '0'),
            taker: (p.taker ?? 0n).toString(16).padStart(64, '0'),
            btcAmount: p.btcAmount ?? 0n,
            wantAmount: p.wantAmount ?? 0n,
            expiry: Number(p.expiry ?? 0n),
            makerAddr: (p.makerAddr ?? 0n).toString(16).padStart(64, '0'),
            takerAddr: (p.takerAddr ?? 0n).toString(16).padStart(64, '0'),
            feePaid: p.feePaid ?? 0n,
          });
        } catch (e) { logger.warn(`[CrossChain] Skipping unreadable order #${i}:`, e); }
      }
      setOrders(fetched);
    } catch (e) { logger.warn('[CrossChain] Failed to fetch orders:', e); }
    setLoading(false);
  }, [provider, contractReady]);

  useEffect(() => {
    void fetchOrders();
    const iv = setInterval(() => void fetchOrders(), 15000);
    return () => clearInterval(iv);
  }, [fetchOrders]);

  // ── Token Bridge: Fetch orders ──
  const fetchEscrowOrders = useCallback(async () => {
    if (!escrowReady) return;
    setEscrowLoading(true);
    try {
      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK);
      const nextIdResult = await bridge.getNextOrderId();
      const nextIdProps = nextIdResult?.properties as Record<string, bigint> | undefined;
      const nextId = Number(nextIdProps?.nextOrderId ?? 1n);
      const fetched: TokenEscrowOrder[] = [];
      for (let i = 1; i < nextId && i < 200; i++) {
        try {
          const r = await bridge.getOrder(BigInt(i));
          if (r?.properties == null) continue;
          const p = r.properties as Record<string, bigint>;
          const status = Number(p.status ?? 0n);
          if (status === 0) continue;
          fetched.push({
            id: String(i),
            direction: Number(p.direction ?? 0n),
            status,
            creator: (p.creator ?? 0n).toString(16).padStart(64, '0'),
            taker: (p.taker ?? 0n).toString(16).padStart(64, '0'),
            tokenHex: (p.token ?? 0n).toString(16).padStart(64, '0'),
            tokenAmount: p.tokenAmount ?? 0n,
            btcPrice: p.btcPrice ?? 0n,
            hashlock: (p.hashlock ?? 0n).toString(16).padStart(64, '0'),
            preimage: (p.preimage ?? 0n).toString(16).padStart(64, '0'),
            expiry: Number(p.expiry ?? 0n),
            makerAddr: (p.makerAddr ?? 0n).toString(16).padStart(64, '0'),
            takerAddr: (p.takerAddr ?? 0n).toString(16).padStart(64, '0'),
            feePaid: p.feePaid ?? 0n,
          });
        } catch (e) { logger.warn(`[CrossChain] Skipping unreadable escrow order #${i}:`, e); }
      }
      setEscrowOrders(fetched);
    } catch (e) { logger.warn('[CrossChain] Failed to fetch escrow orders:', e); }
    setEscrowLoading(false);
  }, [provider, escrowReady]);

  useEffect(() => {
    if (mode !== 'tokenbridge') return;
    void fetchEscrowOrders();
    const iv = setInterval(() => void fetchEscrowOrders(), 15000);
    return () => clearInterval(iv);
  }, [mode, fetchEscrowOrders]);

  // ── Rate persistence ──
  const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  const [, setServerRates] = useState<Record<string, { send_sats: string; receive_sats: string; send_unit: string; receive_unit: string; rate: number }>>({});

  useEffect(() => {
    // Rate persistence works with both full URL and same-origin proxy
    void (async () => {
      try {
        const r = await fetch(`${API_URL}/api/orders/rates`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) setServerRates((await r.json()) as Record<string, { send_sats: string; receive_sats: string; send_unit: string; receive_unit: string; rate: number }>);
      } catch (e) { logger.warn('[CrossChain] Server rates fetch failed:', e); }
    })();
  }, [API_URL]);

  const saveRate = useCallback((orderId: string, rateNum: number, receiveSats: bigint, sendSats: bigint, sUnit: string, rUnit: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem('fractalswap_rates') ?? '{}') as Record<string, { r: number; rx: string }>;
      stored[orderId] = { r: rateNum, rx: receiveSats.toString() };
      localStorage.setItem('fractalswap_rates', JSON.stringify(stored));
    } catch (e) { logger.warn('[CrossChain] Failed to save rate to localStorage:', e); }
    {
      fetch(`${API_URL}/api/orders/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, sendSats: sendSats.toString(), receiveSats: receiveSats.toString(), sendUnit: sUnit, receiveUnit: rUnit, rate: rateNum }),
      }).then(r => {
        if (r.ok) setServerRates(prev => ({ ...prev, [orderId]: { send_sats: sendSats.toString(), receive_sats: receiveSats.toString(), send_unit: sUnit, receive_unit: rUnit, rate: rateNum } }));
      }).catch((e) => { logger.warn('[useCrossChainState] Rate sync error:', e); });
    }
  }, [API_URL]);

  // ── FractalSwap derived state ──
  const activeOrders = orders.filter(o =>
    (o.status === OrderStatus.Open || o.status === OrderStatus.Taken) &&
    (o.expiry <= 0 || o.expiry > currentBlock),
  );
  const isMyOrderFn = useCallback((o: FractalSwapOrder) => !!(mldsaHex && o.creator.toLowerCase() === mldsaHex), [mldsaHex]);
  const isTakerFn = useCallback((o: FractalSwapOrder) => !!(mldsaHex && o.taker.toLowerCase() === mldsaHex), [mldsaHex]);
  const myOrders = activeOrders.filter(o => isMyOrderFn(o) || isTakerFn(o));
  const otherOpenOrders = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrderFn(o));
  const totalVolumeSats = orders
    .filter(o => o.status === OrderStatus.Completed)
    .reduce((sum, o) => sum + o.btcAmount, 0n);

  const formAmountSats = formAmount ? BigInt(Math.round(parseFloat(formAmount) * 1e8)) : 0n;
  const formReceiveSats = formReceive ? BigInt(Math.round(parseFloat(formReceive) * 1e8)) : 0n;
  const formBtcSats = formDirection === SwapDirection.BTC_TO_FB ? formAmountSats : formReceiveSats;
  const formFeeSats = formBtcSats > 0n ? (formBtcSats * BigInt(feeBps)) / 10000n : 0n;
  const formRate = formAmountSats > 0n && formReceiveSats > 0n
    ? (Number(formReceiveSats) / Number(formAmountSats)).toFixed(4) : '';
  const sendUnit = formDirection === SwapDirection.BTC_TO_FB ? 'BTC' : 'FB';
  const receiveUnit = formDirection === SwapDirection.BTC_TO_FB ? 'FB' : 'BTC';
  const expiryOpts = suggestedExpiryBlocks(1);

  const availBuyFb = otherOpenOrders.filter(o => o.direction === SwapDirection.FB_TO_BTC);
  const availGetBtc = otherOpenOrders.filter(o => o.direction === SwapDirection.BTC_TO_FB);

  // ── Token Bridge derived state ──
  const activeEscrowOrders = escrowOrders.filter(o => o.status === 1 || o.status === 2);
  const sellTokenOrders = activeEscrowOrders.filter(o => o.direction === DIR_SELL_TOKEN);
  const buyTokenOrders = activeEscrowOrders.filter(o => o.direction !== DIR_SELL_TOKEN);

  const selectedTbToken = TOKEN_OPTIONS.find(t => t.address === tbToken);
  const tbTokenAmountRaw = tbTokenAmount && selectedTbToken
    ? BigInt(Math.round(parseFloat(tbTokenAmount) * (10 ** selectedTbToken.decimals)))
    : 0n;
  const tbBtcPriceSats = tbBtcPrice ? BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8)) : 0n;
  const tbFeeSats = tbBtcPriceSats > 0n ? (tbBtcPriceSats * BigInt(feeBps)) / 10000n : 0n;

  return {
    // Wallet
    walletAddress,
    openConnectModal,
    mldsaHex,
    senderAddr,
    provider,

    // UniSat
    unisat,
    unisatConnecting,
    handleConnectUnisat,
    handleDisconnectUnisat,

    // FractalSwap orders
    orders,
    loading,
    fetchOrders,

    // Block / fee
    currentBlock,
    feeBps,

    // Locks
    locks,

    // Preimage store
    preimageStore,
    savePreimage,

    // Rate persistence
    saveRate,

    // UI state
    expandedOrder,
    setExpandedOrder,
    msg,
    setMsg,
    actionStep,
    setActionStep,
    actioning,
    setActioning,

    // Create form
    formDirection,
    setFormDirection,
    formAmount,
    setFormAmount,
    formReceive,
    setFormReceive,
    formMakerAddr,
    setFormMakerAddr,
    setMakerAddrManual,
    formExpiry,
    setFormExpiry,
    creating,
    setCreating,
    createStep,
    setCreateStep,

    // Contract readiness
    contractReady,
    escrowReady,

    // FractalSwap derived state
    activeOrders,
    myOrders,
    otherOpenOrders,
    totalVolumeSats,
    availBuyFb,
    availGetBtc,
    isMyOrderFn,
    isTakerFn,

    // Computed form values
    formAmountSats,
    formReceiveSats,
    formFeeSats,
    formRate,
    sendUnit,
    receiveUnit,
    expiryOpts,

    // Token Bridge state
    escrowOrders,
    escrowLoading,
    fetchEscrowOrders,
    tbToken,
    setTbToken,
    tbDirection,
    setTbDirection,
    tbTokenAmount,
    setTbTokenAmount,
    tbBtcPrice,
    setTbBtcPrice,
    tbMakerAddr,
    setTbMakerAddr,
    tbExpiry,
    setTbExpiry,
    tbCreating,
    setTbCreating,
    tbStep,
    setTbStep,

    // Token Bridge derived state
    activeEscrowOrders,
    sellTokenOrders,
    buyTokenOrders,
    selectedTbToken,
    tbTokenAmountRaw,
    tbBtcPriceSats,
    tbFeeSats,

    // Ops context
    trackOp,
    updateOpStep,
    completeOp,
    failOp,

    // Toast
    toast,

    // Mode
    mode,
  };
}
