import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract,
  TransactionOutputFlags,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { FRACTALSWAP_ABI, TOKEN_ESCROW_ABI } from '../abis';
import { Address } from '@btc-vision/transaction';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import { lockOrder, unlockOrder, getActiveLocks, type OrderLock } from '../swapApi';
import { useOps } from '../contexts/OpsContext';
import { buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import { ensureAllowance } from '../txUtils';
import {
  CROSSCHAIN_ADDRESS, CROSSCHAIN_PUBKEY, DEPLOYER_MLDSA_HEX,
  TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_PUBKEY,
  DEPLOYED_CONTRACTS,
  getContractOpscanUrl,
} from '../contracts';
import { SUPPORTED_CHAINS, suggestedExpiryBlocks } from '../crosschain/chains';
import {
  generateHTLCPair, verifyPreimage,
  hexToBigInt,
} from '../crosschain/htlc';
import {
  type FractalSwapOrder, OrderStatus, SwapDirection,
} from '../crosschain/types';
import { useToast } from './Toast';
import {
  type UnisatWalletState,
  isUnisatInstalled, connectUnisat, disconnectUnisat,
  sendFractalBTC,
} from '../wallets/unisat';
import CrossChainOrderForm from './crosschain/CrossChainOrderForm';
import { MyOrderRow, AvailableOrderRow, MY_COLS, AV_COLS } from './crosschain/CrossChainOrderRow';
import { EscrowOrderCard } from './crosschain/CrossChainOrderActions';
import { satsToBtc } from './crosschain/types';


/** Typed interface for FractalSwap v6 contract */
interface FractalSwapContract extends BaseContractProperties {
  createOrder(direction: bigint, btcAmount: bigint, wantAmount: bigint, expiry: bigint, fractalAddr: bigint): Promise<CallResult>;
  takeOrder(orderId: bigint, takerAddr: bigint): Promise<CallResult>;
  completeOrder(orderId: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
  refundExpired(orderId: bigint): Promise<CallResult>;
  getOrder(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
  getFeeInfo(): Promise<CallResult>;
}

/** Typed interface for TokenEscrowBridge contract */
interface TokenEscrowContract extends BaseContractProperties {
  createOrder(direction: bigint, token: Address, tokenAmount: bigint, btcPrice: bigint, hashlock: bigint, expiry: bigint, makerAddr: bigint): Promise<CallResult>;
  takeOrder(orderId: bigint, takerAddr: bigint): Promise<CallResult>;
  confirmSwap(orderId: bigint, preimage: bigint): Promise<CallResult>;
  cancelOrder(orderId: bigint): Promise<CallResult>;
  refundExpired(orderId: bigint): Promise<CallResult>;
  getOrder(orderId: bigint): Promise<CallResult>;
  getNextOrderId(): Promise<CallResult>;
  getFeeInfo(): Promise<CallResult>;
}

/** Token options for the bridge */
const TOKEN_OPTIONS = Object.entries(DEPLOYED_CONTRACTS).map(([sym, tok]) => ({
  symbol: sym,
  address: tok.address,
  pubkey: tok.pubkey,
  icon: tok.icon,
  decimals: tok.decimals,
}));

/** Direction constants for token escrow */
const DIR_SELL_TOKEN = 1; // Maker locks tokens, wants BTC
const DIR_BUY_TOKEN = 2;  // Maker posts intent to buy tokens with BTC

type BridgeMode = 'fractalswap' | 'tokenbridge';

/** Token escrow order type */
interface TokenEscrowOrder {
  id: string;
  direction: number; // 1=sell_token, 2=buy_token
  status: number;
  creator: string;
  taker: string;
  tokenHex: string; // token contract address as hex
  tokenAmount: bigint;
  btcPrice: bigint; // in sats
  hashlock: string;
  preimage: string;
  expiry: number;
  makerAddr: string;
  takerAddr: string;
  feePaid: bigint;
}

/** Resolve token hex back to known token info */
function resolveToken(tokenHex: string): { symbol: string; icon: string; decimals: number; address: string } | null {
  for (const tok of TOKEN_OPTIONS) {
    const pubHex = tok.pubkey.replace('0x', '').toLowerCase();
    if (tokenHex.toLowerCase() === pubHex || tokenHex.toLowerCase().endsWith(pubHex.slice(-32))) {
      return { symbol: tok.symbol, icon: tok.icon, decimals: tok.decimals, address: tok.address };
    }
  }
  return null;
}

const fractalChain = SUPPORTED_CHAINS[0]; // Fractal Bitcoin


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


/* ═══════════════════════════════════════════════════════════════
   FRACTALSWAP — Native BTC ↔ Fractal BTC Exchange
   ═══════════════════════════════════════════════════════════════ */
const CrossChainMarketplace: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal, hashedMLDSAKey } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

  // Normalized MLDSA hex for comparing with on-chain creator/taker fields
  const mldsaHex = useMemo(() => {
    if (!hashedMLDSAKey) return '';
    return (hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey).toLowerCase();
  }, [hashedMLDSAKey]);
  const { toast } = useToast();

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

  // State
  const [orders, setOrders] = useState<FractalSwapOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState(100); // default 1%

  // Create form
  const [formDirection, setFormDirection] = useState<SwapDirection>(SwapDirection.BTC_TO_FB);
  const [formAmount, setFormAmount] = useState('');
  const [formReceive, setFormReceive] = useState('');
  const [formMakerAddr, setFormMakerAddr] = useState('');
  const [formExpiry, setFormExpiry] = useState('144');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  // Action state
  const [actionStep, setActionStep] = useState('');
  const [actioning, setActioning] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // Global ops context
  const { trackOp, updateOpStep, completeOp, failOp } = useOps();

  // Order locks
  const [locks, setLocks] = useState<Record<string, OrderLock>>({});
  useEffect(() => {
    getActiveLocks().then(setLocks);
    const iv = setInterval(() => getActiveLocks().then(setLocks), 15_000);
    return () => clearInterval(iv);
  }, []);

  // Preimage store (localStorage persistence)
  const [preimageStore, setPreimageStore] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('fractalswap_preimages') || '{}'); } catch (e) { console.warn('[CrossChain] Failed to parse preimage store from localStorage:', e); return {}; }
  });
  const savePreimage = useCallback((orderId: string, preimage: string) => {
    setPreimageStore(prev => {
      const next = { ...prev, [orderId]: preimage };
      localStorage.setItem('fractalswap_preimages', JSON.stringify(next));
      return next;
    });
  }, []);

  // Bridge mode toggle
  const [mode] = useState<BridgeMode>('fractalswap');

  // Token Bridge state
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

  // Auto-fill receive address from connected wallets
  // Track if user manually edited the field
  const [makerAddrManual, setMakerAddrManual] = useState(false);
  useEffect(() => {
    if (makerAddrManual) return; // don't overwrite user input
    if (formDirection === SwapDirection.BTC_TO_FB && unisat.connected && unisat.address) {
      setFormMakerAddr(unisat.address);
    } else if (formDirection === SwapDirection.FB_TO_BTC && walletAddress) {
      setFormMakerAddr(walletAddress);
    }
  }, [unisat.connected, unisat.address, formDirection, makerAddrManual, walletAddress]);

  // Reset manual flag on direction change
  useEffect(() => { setMakerAddrManual(false); }, [formDirection]);

  // Auto-fill Token Bridge address
  useEffect(() => {
    if (tbMakerAddr) return;
    if (tbDirection === DIR_SELL_TOKEN && walletAddress) {
      setTbMakerAddr(walletAddress);
    }
  }, [tbDirection, walletAddress, tbMakerAddr]);

  // Fetch current block
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const b = await provider.getBlockNumber();
        if (!cancelled) setCurrentBlock(Number(b));
      } catch (e) { console.warn('[CrossChain] Block height poll failed:', e); }
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
        const c = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK);
        const r = await c.getFeeInfo();
        const feeProps = r?.properties as Record<string, unknown> | undefined;
        if (feeProps?.feeBps) setFeeBps(Number(feeProps.feeBps));
      } catch (e) { console.warn('[CrossChain] Fee info fetch failed:', e); }
    })();
  }, [provider, contractReady]);

  // Fetch orders
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
          if (!r?.properties) continue;
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
        } catch (e) { console.warn(`[CrossChain] Skipping unreadable order #${i}:`, e); }
      }
      setOrders(fetched);
    } catch (e) { console.warn('[CrossChain] Failed to fetch orders:', e); }
    setLoading(false);
  }, [provider, contractReady]);

  useEffect(() => {
    fetchOrders();
    const iv = setInterval(fetchOrders, 15000);
    return () => clearInterval(iv);
  }, [fetchOrders]);

  // Derived
  const activeOrders = orders.filter(o =>
    (o.status === OrderStatus.Open || o.status === OrderStatus.Taken) &&
    (o.expiry <= 0 || o.expiry > currentBlock),
  );
  const isMyOrderFn = (o: FractalSwapOrder) => !!(mldsaHex && o.creator.toLowerCase() === mldsaHex);
  const isTakerFn = (o: FractalSwapOrder) => !!(mldsaHex && o.taker.toLowerCase() === mldsaHex);
  const myOrders = activeOrders.filter(o => isMyOrderFn(o) || isTakerFn(o));
  const otherOpenOrders = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrderFn(o));
  const totalVolumeSats = orders
    .filter(o => o.status === OrderStatus.Completed)
    .reduce((sum, o) => sum + o.btcAmount, 0n);

  const formAmountSats = formAmount ? BigInt(Math.round(parseFloat(formAmount) * 1e8)) : 0n;
  const formReceiveSats = formReceive ? BigInt(Math.round(parseFloat(formReceive) * 1e8)) : 0n;
  // Fee is always on btcAmount: BTC_TO_FB = formAmountSats, FB_TO_BTC = formReceiveSats
  const formBtcSats = formDirection === SwapDirection.BTC_TO_FB ? formAmountSats : formReceiveSats;
  const formFeeSats = formBtcSats > 0n ? (formBtcSats * BigInt(feeBps)) / 10000n : 0n;
  const formRate = formAmountSats > 0n && formReceiveSats > 0n
    ? (Number(formReceiveSats) / Number(formAmountSats)).toFixed(4) : '';
  const sendUnit = formDirection === SwapDirection.BTC_TO_FB ? 'BTC' : 'FB';
  const receiveUnit = formDirection === SwapDirection.BTC_TO_FB ? 'FB' : 'BTC';
  const expiryOpts = suggestedExpiryBlocks(1);

  // Server-synced rates (visible to all users)
  const API_URL = import.meta.env.VITE_API_URL || '';
  const [, setServerRates] = useState<Record<string, { send_sats: string; receive_sats: string; send_unit: string; receive_unit: string; rate: number }>>({});

  // Fetch rates from server on mount
  useEffect(() => {
    if (!API_URL) return;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/orders/rates`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) setServerRates(await r.json());
      } catch (e) { console.warn('[CrossChain] Server rates fetch failed:', e); }
    })();
  }, [API_URL]);

  // Save rate to server + localStorage
  const saveRate = useCallback((orderId: string, rateNum: number, receiveSats: bigint, sendSats: bigint, sUnit: string, rUnit: string) => {
    // localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('fractalswap_rates') || '{}');
      stored[orderId] = { r: rateNum, rx: receiveSats.toString() };
      localStorage.setItem('fractalswap_rates', JSON.stringify(stored));
    } catch (e) { console.warn('[CrossChain] Failed to save rate to localStorage:', e); }
    // Server (non-blocking)
    if (API_URL) {
      fetch(`${API_URL}/api/orders/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, sendSats: sendSats.toString(), receiveSats: receiveSats.toString(), sendUnit: sUnit, receiveUnit: rUnit, rate: rateNum }),
      }).then(r => {
        if (r.ok) setServerRates(prev => ({ ...prev, [orderId]: { send_sats: sendSats.toString(), receive_sats: receiveSats.toString(), send_unit: sUnit, receive_unit: rUnit, rate: rateNum } }));
      }).catch(() => {});
    }
  }, [API_URL]);

  /** Contract P2OP script (for BTC locking) */
  const contractMldsaHex = CROSSCHAIN_PUBKEY.replace('0x', '');
  const contractP2OPScript = useMemo(() => buildP2OPScript(contractMldsaHex), [contractMldsaHex]);

  /** Get caller's P2OP script from senderAddr (Address type from wallet connect) */
  const getMyP2OPScript = useCallback((): Buffer => {
    if (!senderAddr) throw new Error('Wallet not connected');
    // Convert Address to hex string — Address.toString() returns hex representation
    const hex = String(senderAddr).replace('0x', '');
    return buildP2OPScript(hex.slice(0, 64));
  }, [senderAddr]);

  // ── Create Order (v6 — real BTC escrow) ──
  const handleCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) { setMsg('Contract not deployed yet'); return; }
    if (!formAmount || !formMakerAddr || !formReceive) return;
    if (formAmountSats <= 0n || formReceiveSats <= 0n) return;

    setCreating(true);
    try {
      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

      // Get actual next order ID from contract
      setCreateStep('Checking order ID...');
      const nextIdResult = await market.getNextOrderId();
      const nextIdProps = nextIdResult?.properties as Record<string, bigint> | undefined;
      const actualNextId = String(Number(nextIdProps?.nextOrderId ?? 1n));

      const expiryU256 = BigInt(currentBlock + parseInt(formExpiry));

      // Encode fractal address as u256 (pad to 32 bytes)
      const addrBytes = new TextEncoder().encode(formMakerAddr);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let fractalAddrU256 = 0n;
      for (let i = 0; i < 32; i++) fractalAddrU256 = (fractalAddrU256 << 8n) | BigInt(padded[i]);

      // Compute contract params based on direction
      // BTC_TO_FB: user pays BTC (btcAmount), wants FB (wantAmount)
      // FB_TO_BTC: user wants BTC (btcAmount from taker), pays FB (wantAmount)
      const contractBtcAmount = formDirection === SwapDirection.BTC_TO_FB ? formAmountSats : formReceiveSats;
      const contractWantAmount = formDirection === SwapDirection.BTC_TO_FB ? formReceiveSats : formAmountSats;

      // For BTC_TO_FB: maker locks BTC → add extraOutput to contract P2OP
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

      // For BTC_TO_FB: add BTC lock extraOutput
      if (formDirection === SwapDirection.BTC_TO_FB) {
        (tp as unknown as Record<string, unknown>).extraOutputs = [{
          script: contractP2OPScript,
          value: Number(contractBtcAmount),
        }];
        (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = contractBtcAmount + 50_000n;
      }

      await (sim as CallResult).sendTransaction(tp);

      // Save rate with actual contract ID
      if (formRate) saveRate(actualNextId, parseFloat(formRate), formReceiveSats, formAmountSats, sendUnit, receiveUnit);

      // Persist create op
      const createOpId = `fractalswap:create:${actualNextId}:${walletAddress}`;
      trackOp({
        id: createOpId, market: 'fractalswap', orderId: actualNextId,
        direction: formDirection === SwapDirection.BTC_TO_FB ? 'BTC_TO_FB' : 'FB_TO_BTC',
        role: 'maker', step: 'Created, confirming...',
        amounts: { btc: Number(contractBtcAmount).toString(), want: Number(contractWantAmount).toString() },
      });

      setCreateStep('Waiting for confirmation...');
      toast(`Order #${actualNextId} created!${formDirection === SwapDirection.BTC_TO_FB ? ' BTC locked in contract.' : ''} Waiting for block...`, 'success');
      setFormAmount('');
      setFormReceive('');
      setFormMakerAddr('');

      // Wait for block then refresh
      waitForNextBlock(provider).then(() => {
        setCreateStep('');
        toast(`Order #${actualNextId} confirmed on-chain!`, 'success');
        completeOp(createOpId);
        fetchOrders();
      }).catch(() => { setCreateStep(''); });
      fetchOrders();
    } catch (e) {
      setCreateStep(formatTxError(e));
      setTimeout(() => setCreateStep(''), 5000);
    } finally { setCreating(false); }
  }, [walletAddress, senderAddr, formAmount, formMakerAddr, formReceive, formDirection, formExpiry, formAmountSats, formReceiveSats, currentBlock, provider, openConnectModal, contractReady, fetchOrders, toast, formRate, saveRate, contractP2OPScript]);

  // ── Take Order (pays fee + locks BTC for FB_TO_BTC) ──
  const handleTake = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;

    // Lock order
    const lockKey = `fractalswap:${orderId}`;
    const lockRes = await lockOrder(lockKey, walletAddress);
    if (!lockRes.ok) { toast(lockRes.error || 'Order is locked by another user', 'error'); return; }

    setActioning(orderId); setActionStep('Taking order...');
    const opId = `fractalswap:${orderId}:${walletAddress}`;
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      // Encode taker address
      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]);

      // Calculate fee (always on btcAmount)
      const rawFee = (order.btcAmount * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

      // Build outputs: fee + optional BTC lock for FB_TO_BTC
      const isFbToBtc = order.direction === SwapDirection.FB_TO_BTC;
      const txOutputs: Array<{ value: bigint; index: number; flags: number; scriptPubKey: Buffer; to: string }> = [
        {
          value: feeSats,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: feeRecipientScript,
          to: feeRecipientAddress,
        },
      ];

      // FB_TO_BTC: taker locks BTC to contract
      if (isFbToBtc) {
        txOutputs.push({
          value: order.btcAmount,
          index: 2,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: contractP2OPScript,
          to: CROSSCHAIN_ADDRESS,
        });
      }

      market.setTransactionDetails({ inputs: [], outputs: txOutputs });

      setActionStep(`Taking order (fee: ${Number(feeSats)} sats${isFbToBtc ? ` + locking ${satsToBtc(order.btcAmount)}` : ''})...`);
      const sim = await withRetry(() => market.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      const extraOuts: Array<{ script: Buffer; value: number }> = [
        { script: feeRecipientScript, value: Number(feeSats) },
      ];
      if (isFbToBtc) {
        extraOuts.push({ script: contractP2OPScript, value: Number(order.btcAmount) });
      }
      (tp as unknown as Record<string, unknown>).extraOutputs = extraOuts;
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = feeSats + (isFbToBtc ? order.btcAmount : 0n) + 50_000n;
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'TX sent, confirming...', amounts: { btc: Number(order.btcAmount).toString() } });
      toast(`Order #${orderId} taken! Fee: ${satsToBtc(feeSats)}.${isFbToBtc ? ' BTC locked.' : ''} Confirming...`, 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => {
        completeOp(opId);
        unlockOrder(lockKey, walletAddress);
        toast(`Order #${orderId} confirmed on-chain!`, 'success');
        fetchOrders();
      }).catch(() => { completeOp(opId); unlockOrder(lockKey, walletAddress); });
      fetchOrders();
      return;
    } catch (e) {
      failOp(opId, formatTxError(e));
      unlockOrder(lockKey, walletAddress);
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, feeBps, provider, openConnectModal, contractReady, fetchOrders, toast, trackOp, completeOp, failOp, contractP2OPScript]);

  // ── Complete Order (v6 — claim locked BTC after sending FB) ──
  const handleComplete = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Completing order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

      // Contract verifies BTC output to caller — add extraOutput to self
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{
          value: order.btcAmount,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: myScript,
          to: walletAddress,
        }],
      });

      setActionStep('Completing swap — claiming locked BTC...');
      const sim = await withRetry(() => market.completeOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: myScript,
        value: Number(order.btcAmount),
      }];
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      const opId = `fractalswap:complete:${orderId}:${walletAddress}`;
      trackOp({ id: opId, market: 'fractalswap', orderId, direction: String(order.direction), role: 'taker', step: 'BTC claimed, settling...' });
      toast(`Order #${orderId} completed! BTC claimed.`, 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => {
        completeOp(opId);
        toast(`Order #${orderId} settled on-chain!`, 'success');
        fetchOrders();
      }).catch(() => { completeOp(opId); });
      fetchOrders();
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, trackOp, completeOp, getMyP2OPScript]);

  // ── Cancel Order (v6 — refunds locked BTC for BTC_TO_FB) ──
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Cancelling order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

      // BTC_TO_FB: contract verifies BTC refund to maker (creator)
      if (order.direction === SwapDirection.BTC_TO_FB) {
        const myScript = getMyP2OPScript();
        market.setTransactionDetails({
          inputs: [],
          outputs: [{
            value: order.btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: myScript,
            to: walletAddress,
          }],
        });
      }

      const sim = await withRetry(() => market.cancelOrder(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);

      // BTC_TO_FB: add BTC refund extraOutput
      if (order.direction === SwapDirection.BTC_TO_FB) {
        const myScript = getMyP2OPScript();
        (tp as unknown as Record<string, unknown>).extraOutputs = [{
          script: myScript,
          value: Number(order.btcAmount),
        }];
      }

      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast(`Order cancelled!${order.direction === SwapDirection.BTC_TO_FB ? ' BTC refunded.' : ''} Confirming...`, 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => {
        toast('Cancellation confirmed!', 'success');
        fetchOrders();
      }).catch(() => {});
      fetchOrders();
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript]);

  // ── AUTO-SWAP: Take + Send FB + Complete in one flow ──
  // For BTC_TO_FB taker: takeOrder → waitBlock → sendFB → completeOrder
  // For FB_TO_BTC taker: takeOrder (locks BTC) — maker handles FB later
  const handleTakeAndSwap = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!unisat.connected) { toast('Connect UniSat wallet first to send Fractal BTC', 'warning'); return; }
    if (!contractReady) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Lock order
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
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]);

      const rawFee = (order.btcAmount * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee;
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

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
      const market2 = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);
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

      waitForNextBlock(provider).then(() => {
        completeOp(opId);
        unlockOrder(lockKey, walletAddress);
        toast(`Order #${orderId} fully settled!`, 'success');
        fetchOrders();
      }).catch(() => { completeOp(opId); unlockOrder(lockKey, walletAddress); });
      fetchOrders();
    } catch (e) {
      failOp(opId, formatTxError(e));
      unlockOrder(lockKey, walletAddress);
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 8000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, feeBps, provider, unisat.connected, openConnectModal, contractReady, fetchOrders, toast, trackOp, updateOpStep, completeOp, failOp, contractP2OPScript, getMyP2OPScript]);

  // ── AUTO-CLAIM: Send FB + Complete in one flow (for Taken orders) ──
  // BTC_TO_FB: taker sends FB then claims BTC
  // FB_TO_BTC: maker sends FB then claims BTC
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
      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);
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

      waitForNextBlock(provider).then(() => {
        completeOp(opId);
        toast(`Order #${orderId} fully settled!`, 'success');
        fetchOrders();
      }).catch(() => completeOp(opId));
      fetchOrders();
    } catch (e) {
      failOp(opId, formatTxError(e));
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 8000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, unisat.connected, openConnectModal, contractReady, fetchOrders, toast, trackOp, updateOpStep, completeOp, failOp, getMyP2OPScript]);

  // ── Auto-send FB when maker's FB_TO_BTC order transitions Open → Taken ──
  const prevOrderStatusesRef = useRef<Record<string, OrderStatus>>({});
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;
  const unisatRef = useRef(unisat);
  unisatRef.current = unisat;
  const handleSendAndClaimRef = useRef(handleSendAndClaim);
  handleSendAndClaimRef.current = handleSendAndClaim;
  const actioningRef = useRef(actioning);
  actioningRef.current = actioning;

  useEffect(() => {
    const prev = prevOrderStatusesRef.current;
    const next: Record<string, OrderStatus> = {};
    for (const o of orders) next[o.id] = o.status;

    // Check for Open → Taken transitions on my FB_TO_BTC orders
    for (const order of orders) {
      if (order.direction !== SwapDirection.FB_TO_BTC) continue;
      if (order.status !== OrderStatus.Taken) continue;
      if (prev[order.id] !== OrderStatus.Open) continue;

      // Is this my order?
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
  }, [orders, toast]);

  // Auto-trigger when UniSat connects: check for pending Taken FB_TO_BTC orders
  const prevUnisatConnected = useRef(unisat.connected);
  useEffect(() => {
    const wasConnected = prevUnisatConnected.current;
    prevUnisatConnected.current = unisat.connected;
    if (wasConnected || !unisat.connected) return; // only on false → true

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
  }, [unisat.connected, orders, toast]);

  // ── Refund Expired (v6 — returns locked BTC to original locker) ──
  const handleRefund = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!contractReady) return;
    setActioning(orderId); setActionStep('Refunding expired order...');
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const market = getContract<FractalSwapContract>(CROSSCHAIN_ADDRESS, FRACTALSWAP_ABI, provider, NETWORK, senderAddr);

      // Contract verifies BTC refund to the party who locked it
      // BTC_TO_FB: refund to maker (creator)
      // FB_TO_BTC: refund to taker
      const myScript = getMyP2OPScript();
      market.setTransactionDetails({
        inputs: [],
        outputs: [{
          value: order.btcAmount,
          index: 1,
          flags: TransactionOutputFlags.hasScriptPubKey,
          scriptPubKey: myScript,
          to: walletAddress,
        }],
      });

      const sim = await withRetry(() => market.refundExpired(BigInt(orderId)));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: myScript,
        value: Number(order.btcAmount),
      }];
      await (sim as CallResult).sendTransaction(tp);

      setActionStep('');
      toast('Refund sent! BTC returned. Confirming...', 'success');
      setActioning(null);

      waitForNextBlock(provider).then(() => {
        toast('Refund confirmed!', 'success');
        fetchOrders();
      }).catch(() => {});
      fetchOrders();
      return;
    } catch (e) {
      setActionStep(formatTxError(e));
      setTimeout(() => setActionStep(''), 5000);
    } finally { setActioning(null); }
  }, [walletAddress, senderAddr, orders, provider, openConnectModal, contractReady, fetchOrders, getMyP2OPScript]);

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
          if (!r?.properties) continue;
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
        } catch (e) { console.warn(`[CrossChain] Skipping unreadable escrow order #${i}:`, e); }
      }
      setEscrowOrders(fetched);
    } catch (e) { console.warn('[CrossChain] Failed to fetch escrow orders:', e); }
    setEscrowLoading(false);
  }, [provider, escrowReady]);

  useEffect(() => {
    if (mode !== 'tokenbridge') return;
    fetchEscrowOrders();
    const iv = setInterval(fetchEscrowOrders, 15000);
    return () => clearInterval(iv);
  }, [mode, fetchEscrowOrders]);

  // ── Token Bridge: Create order ──
  const handleTbCreate = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) { setMsg('Token Escrow contract not deployed yet'); return; }
    if (!tbTokenAmount || !tbBtcPrice || !tbMakerAddr) return;

    const selectedToken = TOKEN_OPTIONS.find(t => t.address === tbToken);
    if (!selectedToken) return;

    const tokenAmountRaw = BigInt(Math.round(parseFloat(tbTokenAmount) * (10 ** selectedToken.decimals)));
    const btcPriceSats = BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8));
    if (tokenAmountRaw <= 0n || btcPriceSats <= 0n) return;

    setTbCreating(true);
    try {
      // For SELL_TOKEN direction, maker locks tokens → need allowance
      if (tbDirection === DIR_SELL_TOKEN) {
        const escrowPubkey = TOKEN_ESCROW_PUBKEY.startsWith('0x') ? TOKEN_ESCROW_PUBKEY : '0x' + TOKEN_ESCROW_PUBKEY;
        await ensureAllowance(
          tbToken, escrowPubkey, tokenAmountRaw,
          provider, senderAddr!, walletAddress,
          setTbStep, selectedToken.symbol,
        );
      }

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr);

      // Generate HTLC pair
      setTbStep('Generating HTLC preimage...');
      const { preimage, hashlock } = await generateHTLCPair();
      const hashlockU256 = hexToBigInt(hashlock);
      const expiryU256 = BigInt(currentBlock + parseInt(tbExpiry));

      // Encode maker address as u256
      const addrBytes = new TextEncoder().encode(tbMakerAddr);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let makerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) makerAddrU256 = (makerAddrU256 << 8n) | BigInt(padded[i]);

      setTbStep('Creating token escrow order...');
      const tokenAddr = Address.fromString(selectedToken.pubkey.replace('0x', ''));
      const sim = await withRetry(() =>
        bridge.createOrder(BigInt(tbDirection), tokenAddr, tokenAmountRaw, btcPriceSats, hashlockU256, expiryU256, makerAddrU256),
      );
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      await (sim as CallResult).sendTransaction(tp);

      // Save preimage
      const nextId = escrowOrders.length > 0 ? Math.max(...escrowOrders.map(o => parseInt(o.id))) + 1 : 1;
      savePreimage(`tb_${nextId}`, preimage);

      toast(`Token escrow order created! ${tbDirection === DIR_SELL_TOKEN ? 'Tokens locked.' : 'Intent posted.'}`, 'success');
      setTbStep('');
      setTbTokenAmount('');
      setTbBtcPrice('');
      setTbMakerAddr('');

      waitForNextBlock(provider).then(() => fetchEscrowOrders()).catch(() => {});
      fetchEscrowOrders();
    } catch (e) {
      setTbStep(formatTxError(e));
      setTimeout(() => setTbStep(''), 5000);
    } finally { setTbCreating(false); }
  }, [walletAddress, senderAddr, tbToken, tbDirection, tbTokenAmount, tbBtcPrice, tbMakerAddr, tbExpiry, currentBlock, provider, openConnectModal, escrowReady, escrowOrders, fetchEscrowOrders, savePreimage, toast]);

  // ── Token Bridge: Take order ──
  const handleTbTake = useCallback(async (orderId: string, takerAddrInput: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Taking token escrow order...');
    try {
      const order = escrowOrders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      // For BUY_TOKEN direction, taker locks tokens → need allowance
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

      // Encode taker address
      const addrBytes = new TextEncoder().encode(takerAddrInput);
      const padded = new Uint8Array(32);
      padded.set(addrBytes.slice(0, 32));
      let takerAddrU256 = 0n;
      for (let i = 0; i < 32; i++) takerAddrU256 = (takerAddrU256 << 8n) | BigInt(padded[i]);

      // Calculate fee
      const rawFee = (order.btcPrice * BigInt(feeBps)) / 10000n;
      const feeSats = rawFee < 330n ? 330n : rawFee; // enforce dust minimum
      const feeRecipientScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);
      const feeRecipientAddress = getP2OPAddress(DEPLOYER_MLDSA_HEX);

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr);

      bridge.setTransactionDetails({
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
      const sim = await withRetry(() => bridge.takeOrder(BigInt(orderId), takerAddrU256));
      if ((sim as CallResult).revert) throw new Error(`Revert: ${(sim as CallResult).revert}`);

      const tp = await buildTxParams(provider, walletAddress);
      (tp as unknown as Record<string, unknown>).extraOutputs = [{
        script: feeRecipientScript,
        value: Number(feeSats),
      }];
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
  }, [walletAddress, senderAddr, escrowOrders, feeBps, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast]);

  // ── Token Bridge: Confirm swap ──
  const handleTbConfirm = useCallback(async (orderId: string, preimageHex: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Verifying preimage...');
    try {
      const order = escrowOrders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const valid = await verifyPreimage(preimageHex, order.hashlock);
      if (!valid) throw new Error('Invalid preimage');

      // HTLC model: preimage IS the proof of payment. No in-tx BTC output needed.
      // BTC payment happens on the counterparty chain via HTLC.

      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr);

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
  }, [walletAddress, senderAddr, escrowOrders, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast]);

  // ── Token Bridge: Cancel order ──
  const handleTbCancel = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Cancelling token escrow order...');
    try {
      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr);
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
  }, [walletAddress, senderAddr, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast]);

  // ── Token Bridge: Refund expired ──
  const handleTbRefund = useCallback(async (orderId: string) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!escrowReady) return;
    setActioning('tb:' + orderId); setActionStep('Refunding expired token escrow...');
    try {
      const bridge = getContract<TokenEscrowContract>(TOKEN_ESCROW_ADDRESS, TOKEN_ESCROW_ABI, provider, NETWORK, senderAddr);
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
  }, [walletAddress, senderAddr, provider, openConnectModal, escrowReady, fetchEscrowOrders, toast]);

  // Token Bridge derived state
  const activeEscrowOrders = escrowOrders.filter(o => o.status === 1 || o.status === 2);
  const sellTokenOrders = activeEscrowOrders.filter(o => o.direction === DIR_SELL_TOKEN);
  const buyTokenOrders = activeEscrowOrders.filter(o => o.direction === DIR_BUY_TOKEN);

  const selectedTbToken = TOKEN_OPTIONS.find(t => t.address === tbToken);
  const tbTokenAmountRaw = tbTokenAmount && selectedTbToken
    ? BigInt(Math.round(parseFloat(tbTokenAmount) * (10 ** selectedTbToken.decimals)))
    : 0n;
  const tbBtcPriceSats = tbBtcPrice ? BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8)) : 0n;
  const tbFeeSats = tbBtcPriceSats > 0n ? (tbBtcPriceSats * BigInt(feeBps)) / 10000n : 0n;

  // Split available orders into two groups for taker perspective
  const availBuyFb = otherOpenOrders.filter(o => o.direction === SwapDirection.FB_TO_BTC);
  const availGetBtc = otherOpenOrders.filter(o => o.direction === SwapDirection.BTC_TO_FB);

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

      {/* FractalSwap header */}

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

      {/* Token Bridge removed — functionality merged into Marketplace */}
      {false && (
        <>
          {/* Contract not deployed notice */}
          {!escrowReady && (
            <div className="Pg" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>{'\u{1F6A7}'}</div>
              <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Token Escrow Contract Pending</h3>
              <p style={{ color: 'var(--t2)', fontSize: '.82rem', maxWidth: 500, margin: '0 auto' }}>
                The TokenEscrowBridge contract is ready for deployment. Once deployed,
                you can trade OP-20 tokens for BTC with trustless escrow.
              </p>
              <div style={{ marginTop: 12, fontSize: '.72rem', color: 'var(--t3)' }}>
                <code>cd deploy/OP_20 && npx asc --target tokenescrow</code>
              </div>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700 }}>Active Orders</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--w)' }}>{activeEscrowOrders.length}</div>
            </div>
            <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700 }}>Sell Orders</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ef4444' }}>{sellTokenOrders.length}</div>
            </div>
            <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700 }}>Buy Orders</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#22c55e' }}>{buyTokenOrders.length}</div>
            </div>
          </div>

          {/* Create Token Escrow Order */}
          <div className="Pg" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 12 }}>Create Token Escrow Order</div>

            {/* Direction toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className={tbDirection === DIR_SELL_TOKEN ? 'btn-p' : 'btn-s'}
                style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
                onClick={() => setTbDirection(DIR_SELL_TOKEN)}
              >
                Sell Tokens for BTC
              </button>
              <button
                className={tbDirection === DIR_BUY_TOKEN ? 'btn-p' : 'btn-s'}
                style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
                onClick={() => setTbDirection(DIR_BUY_TOKEN)}
              >
                Buy Tokens with BTC
              </button>
            </div>

            {/* Token selector */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Token</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {TOKEN_OPTIONS.map(tok => (
                  <button key={tok.address}
                    className={tbToken === tok.address ? 'btn-p' : 'btn-s'}
                    style={{ padding: '8px 16px', fontSize: '.76rem', fontWeight: 700 }}
                    onClick={() => setTbToken(tok.address)}
                  >
                    {tok.icon} {tok.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Token Amount */}
              <div>
                <label style={labelStyle}>Token Amount ({selectedTbToken?.symbol || 'TOKEN'})</label>
                <input style={iStyle} type="number" placeholder="1000" value={tbTokenAmount}
                  onChange={e => setTbTokenAmount(e.target.value)} min="0" step="any" />
                {tbTokenAmountRaw > 0n && (
                  <div style={{ fontSize: '.66rem', color: 'var(--t3)', marginTop: 2 }}>
                    = {tbTokenAmountRaw.toLocaleString()} raw units
                  </div>
                )}
              </div>

              {/* BTC Price */}
              <div>
                <label style={labelStyle}>BTC Price (total sats)</label>
                <input style={iStyle} type="number" placeholder="0.001" value={tbBtcPrice}
                  onChange={e => setTbBtcPrice(e.target.value)} min="0" step="any" />
                {tbBtcPriceSats > 0n && (
                  <div style={{ fontSize: '.66rem', color: 'var(--o)', marginTop: 2, fontWeight: 600 }}>
                    = {Number(tbBtcPriceSats).toLocaleString()} sats
                  </div>
                )}
              </div>

              {/* Expiry */}
              <div>
                <label style={labelStyle}>Expiry</label>
                <select style={iStyle as React.CSSProperties} value={tbExpiry} onChange={e => setTbExpiry(e.target.value)}>
                  <option value={String(expiryOpts.min)}>~12h ({expiryOpts.min} blocks)</option>
                  <option value={String(expiryOpts.default)}>~24h ({expiryOpts.default} blocks) - Recommended</option>
                  <option value="288">~48h (288 blocks)</option>
                  <option value={String(expiryOpts.max)}>~4 days ({expiryOpts.max} blocks)</option>
                </select>
              </div>

              {/* Your receiving address */}
              <div>
                <label style={labelStyle}>
                  Your Receiving Address (for {tbDirection === DIR_SELL_TOKEN ? 'BTC' : 'tokens'})
                </label>
                <input style={iStyle}
                  placeholder={tbDirection === DIR_SELL_TOKEN ? 'bc1p... or opt1...' : 'opt1...'}
                  value={tbMakerAddr}
                  onChange={e => setTbMakerAddr(e.target.value)} />
              </div>
            </div>

            {/* Summary */}
            {tbTokenAmountRaw > 0n && tbBtcPriceSats > 0n && (
              <div style={{ marginTop: 10, fontSize: '.76rem', color: 'var(--t2)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>
                  {tbDirection === DIR_SELL_TOKEN ? 'Selling' : 'Buying'}: <b style={{ color: 'var(--w)' }}>
                    {tbTokenAmount} {selectedTbToken?.symbol}
                  </b>
                </span>
                <span>
                  For: <b style={{ color: 'var(--o)' }}>{satsToBtc(tbBtcPriceSats)}</b>
                </span>
                <span>
                  Taker fee: <b>{Number(tbFeeSats).toLocaleString()} sats</b>
                </span>
                {tbDirection === DIR_SELL_TOKEN && (
                  <span style={{ color: 'var(--y)', fontSize: '.7rem' }}>
                    Tokens will be locked in contract on creation
                  </span>
                )}
              </div>
            )}

            {tbStep && (
              <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {tbStep}
              </div>
            )}

            <button className="btn-p" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
              disabled={tbCreating || !tbTokenAmount || !tbBtcPrice || !tbMakerAddr || !escrowReady || tbTokenAmountRaw <= 0n}
              onClick={handleTbCreate}
            >
              {tbCreating ? 'Creating...' : tbDirection === DIR_SELL_TOKEN ? 'Create Sell Order (Lock Tokens)' : 'Create Buy Order (Intent)'}
            </button>
          </div>

          {/* Order Book */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.78rem', marginBottom: 8, color: '#ef4444' }}>
                Selling Tokens ({sellTokenOrders.length})
              </div>
              {escrowLoading ? (
                <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Loading...</div>
              ) : sellTokenOrders.length === 0 ? (
                <div className="Pg" style={{ padding: 28, textAlign: 'center', color: 'var(--t3)' }}>
                  <div style={{ fontSize: '2rem', opacity: .3, marginBottom: 8 }}>📭</div>
                  <div style={{ fontSize: '.72rem' }}>No sell orders yet</div>
                </div>
              ) : (
                sellTokenOrders.map(order => (
                  <EscrowOrderCard key={`tb_${order.id}`} order={order}
                    currentBlock={currentBlock} actioning={actioning} actionStep={actionStep}
                    feeBps={feeBps} mldsaHex={mldsaHex} preimageStore={preimageStore}
                    expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder}
                    tokenInfo={resolveToken(order.tokenHex)}
                    onTake={handleTbTake} onConfirm={handleTbConfirm}
                    onRefund={handleTbRefund} onCancel={handleTbCancel} />
                ))
              )}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.78rem', marginBottom: 8, color: '#22c55e' }}>
                Buying Tokens ({buyTokenOrders.length})
              </div>
              {escrowLoading ? (
                <div className="Pg" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Loading...</div>
              ) : buyTokenOrders.length === 0 ? (
                <div className="Pg" style={{ padding: 28, textAlign: 'center', color: 'var(--t3)' }}>
                  <div style={{ fontSize: '2rem', opacity: .3, marginBottom: 8 }}>📭</div>
                  <div style={{ fontSize: '.72rem' }}>No buy orders yet</div>
                </div>
              ) : (
                buyTokenOrders.map(order => (
                  <EscrowOrderCard key={`tb_${order.id}`} order={order}
                    currentBlock={currentBlock} actioning={actioning} actionStep={actionStep}
                    feeBps={feeBps} mldsaHex={mldsaHex} preimageStore={preimageStore}
                    expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder}
                    tokenInfo={resolveToken(order.tokenHex)}
                    onTake={handleTbTake} onConfirm={handleTbConfirm}
                    onRefund={handleTbRefund} onCancel={handleTbCancel} />
                ))
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="Pg" style={{ marginTop: 20, padding: '16px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 10 }}>How Token Bridge Works</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { num: '1', title: 'Create Order', desc: 'Sell: tokens locked in contract. Buy: intent posted (no lock).' },
                { num: '2', title: 'Take Order', desc: 'Taker commits + pays fee. For buy orders, taker locks tokens.' },
                { num: '3', title: 'BTC Payment', desc: 'BTC buyer sends payment to counterparty\'s address.' },
                { num: '4', title: 'Reveal & Settle', desc: 'Reveal preimage to confirm swap. Tokens released to buyer.' },
              ].map(s => (
                <div key={s.num} style={{ textAlign: 'center' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,.2)',
                    color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 8px', fontWeight: 800, fontSize: '.82rem',
                  }}>{s.num}</div>
                  <div style={{ fontSize: '.72rem', fontWeight: 700, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: '.66rem', color: 'var(--t3)', lineHeight: 1.4 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Explorer link */}
          {escrowReady && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <a href={getContractOpscanUrl(TOKEN_ESCROW_ADDRESS)}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '.72rem', color: 'var(--o)', textDecoration: 'none' }}>
                View Token Escrow on OPScan {'\u2192'}
              </a>
            </div>
          )}
        </>
      )}

      {/* ═══════ FRACTALSWAP ═══════ */}
      {(
        <>
      {/* Contract not deployed notice */}
      {!contractReady && (
        <div className="Pg" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>{'\u{1F6A7}'}</div>
          <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Contract Pending Deployment</h3>
          <p style={{ color: 'var(--t2)', fontSize: '.82rem', maxWidth: 500, margin: '0 auto' }}>
            The FractalSwap contract is ready. Once deployed to OPNet {CURRENT_ENV},
            you can swap native BTC with Fractal Bitcoin via trustless atomic swaps.
          </p>
          <div style={{ marginTop: 12, fontSize: '.72rem', color: 'var(--t3)' }}>
            <code>cd deploy/OP_20 && npx asc src/crosschain/index.ts --target crosschain</code>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div className="Pg" style={{ textAlign: 'center', padding: '12px 8px', cursor: 'pointer' }} onClick={() => { fetchOrders(); toast('Refreshing orders...', 'info'); }}>
          <div style={{ fontSize: '.68rem', color: 'var(--t3)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>Active Orders ↻</div>
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
      <CrossChainOrderForm
        formDirection={formDirection}
        setFormDirection={setFormDirection}
        formAmount={formAmount}
        setFormAmount={setFormAmount}
        formReceive={formReceive}
        setFormReceive={setFormReceive}
        formMakerAddr={formMakerAddr}
        setFormMakerAddr={setFormMakerAddr}
        setMakerAddrManual={setMakerAddrManual}
        formExpiry={formExpiry}
        setFormExpiry={setFormExpiry}
        creating={creating}
        createStep={createStep}
        contractReady={contractReady}
        feeBps={feeBps}
        formAmountSats={formAmountSats}
        formReceiveSats={formReceiveSats}
        formFeeSats={formFeeSats}
        formRate={formRate}
        sendUnit={sendUnit}
        receiveUnit={receiveUnit}
        onSubmit={handleCreate}
      />

      {/* ── Your Orders (table) ── */}
      {myOrders.length > 0 && (
        <div className="P" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{
            padding: '10px 10px 0', fontWeight: 700, fontSize: '.78rem', color: '#f59e0b',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
              animation: myOrders.some(o => o.status === OrderStatus.Taken) ? 'pulse 2s infinite' : 'none',
            }} />
            Your Orders ({myOrders.length})
          </div>
          <div className="ob-scroll">
            <div className="ob-hdr" style={{ gridTemplateColumns: MY_COLS }}>
              <span>#</span><span>Dir</span><span className="ob-r">BTC</span><span className="ob-r">FB</span>
              <span className="ob-r">Rate</span><span>Status</span><span className="ob-r">Action</span>
            </div>
            {myOrders.map(order => (
              <MyOrderRow
                key={order.id}
                order={order}
                currentBlock={currentBlock}
                actioning={actioning}
                actionStep={actionStep}
                isMyOrder={isMyOrderFn(order)}
                isTaker={isTakerFn(order)}
                unisatConnected={unisat.connected}
                unisatConnecting={unisatConnecting}
                onCancel={handleCancel}
                onSendAndClaim={handleSendAndClaim}
                onComplete={handleComplete}
                onRefund={handleRefund}
                onConnectUnisat={handleConnectUnisat}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Available Swaps — split by direction ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Buy FB — taker pays BTC, gets FB */}
        <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#22c55e', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            Buy FB
            <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>pay BTC {'\u2192'} get FB</span>
            <span className="ob-badge" style={{ background: 'rgba(34,197,94,.1)', color: '#22c55e', marginLeft: 'auto' }}>{availBuyFb.length}</span>
          </div>
          {loading ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--t2)' }}>Loading...</div>
          ) : availBuyFb.length === 0 ? (
            <div className="ob-empty">
              <div style={{ fontSize: '1.4rem', marginBottom: 6, opacity: .4 }}>🔗</div>
              No cross-chain swaps yet — create one above!
            </div>
          ) : (
            <div className="ob-scroll">
              <div className="ob-hdr" style={{ gridTemplateColumns: AV_COLS }}>
                <span className="ob-r" style={{ color: '#22c55e' }}>You Get</span><span className="ob-r">You Pay</span>
                <span className="ob-r">Rate</span>
                <span className="ob-r">Action</span>
              </div>
              {availBuyFb.map(order => (
                <AvailableOrderRow
                  key={order.id}
                  order={order}
                  currentBlock={currentBlock}
                  actioning={actioning}
                  actionStep={actionStep}
                  feeBps={feeBps}
                  isLocked={!!locks[`fractalswap:${order.id}`] && locks[`fractalswap:${order.id}`].locked_by !== walletAddress}
                  walletAddress={walletAddress}
                  unisatAddress={unisat.address || ''}
                  onTakeAndSwap={handleTakeAndSwap}
                  onTake={handleTake}
                />
              ))}
            </div>
          )}
        </div>

        {/* Get BTC — taker pays FB, gets BTC */}
        <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#f59e0b', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            Get BTC
            <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>pay FB {'\u2192'} get BTC</span>
            <span className="ob-badge" style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', marginLeft: 'auto' }}>{availGetBtc.length}</span>
          </div>
          {loading ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--t2)' }}>Loading...</div>
          ) : availGetBtc.length === 0 ? (
            <div className="ob-empty">
              <div style={{ fontSize: '1.4rem', marginBottom: 6, opacity: .4 }}>🔗</div>
              No cross-chain swaps yet — create one above!
            </div>
          ) : (
            <div className="ob-scroll">
              <div className="ob-hdr" style={{ gridTemplateColumns: AV_COLS }}>
                <span className="ob-r" style={{ color: '#22c55e' }}>You Get</span><span className="ob-r">You Pay</span>
                <span className="ob-r">Rate</span>
                <span className="ob-r">Action</span>
              </div>
              {availGetBtc.map(order => (
                <AvailableOrderRow
                  key={order.id}
                  order={order}
                  currentBlock={currentBlock}
                  actioning={actioning}
                  actionStep={actionStep}
                  feeBps={feeBps}
                  isLocked={!!locks[`fractalswap:${order.id}`] && locks[`fractalswap:${order.id}`].locked_by !== walletAddress}
                  walletAddress={walletAddress}
                  unisatAddress={unisat.address || ''}
                  onTakeAndSwap={handleTakeAndSwap}
                  onTake={handleTake}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="Pg" style={{ marginTop: 20, padding: '16px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 10 }}>How It Works</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { num: '1', title: 'Create Order', desc: 'Post what you want to swap. BTC is locked in the smart contract for safety.' },
            { num: '2', title: 'Take & Auto-Swap', desc: 'One click: pay fee \u2192 send Fractal BTC \u2192 claim locked BTC. Fully automatic.' },
            { num: '3', title: 'Done', desc: 'Both sides receive their funds. Track progress in the Operations panel.' },
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
            View contract on OPScan {'\u2192'}
          </a>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default CrossChainMarketplace;
