/**
 * useSwap — business logic hook extracted from SwapUI.tsx
 *
 * Encapsulates:
 *  - Token lists (base + Motoswap + indexer-discovered)
 *  - Held token balances
 *  - Pool reserves loading & polling
 *  - Swap state (amounts, slippage, from/to indices)
 *  - Price/rate/fee/impact calculation
 *  - doSwap — executes swap through SimplePool or Motoswap Router
 *  - mintTokens — publicMint for MINE/VIBE
 *  - Pool creation (createPool)
 *  - User pools (localStorage persistence)
 *  - LP user position (localStorage)
 *  - TX history
 */

import type React from 'react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address, BinaryWriter } from '@btc-vision/transaction';
import { Transaction } from '@btc-vision/bitcoin';
import {
  getContract, BitcoinUtils,
  MOTOSWAP_ROUTER_ABI,
  type IMotoswapRouterContract,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { POOL_ABI, MINTABLE_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import { ensureAllowance, buildTxParams, withRetry, formatTxError } from '../txUtils';
import * as opnetRpc from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { addTxRecord, getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';
import {
  DEPLOYED_CONTRACTS,
  POOL_ADDRESS, POOL_PUBKEY,
  MOTOSWAP_ROUTER_ADDRESS, MOTOSWAP_ROUTER_PUBKEY,
  getTxUrl, getContractOpscanUrl,
} from '../contracts';
import { fetchAllTokens, fetchHolderBalances, fetchMotoswapPools, type MotoswapPool } from '../tokenApi';
import { useOps } from '../contexts/OpsContext';

export type SwapMainTab = 'swap' | 'pools';

export interface Token {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  address: string;
  pubkey: string;
}

export interface UserPool {
  address: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  deployedAt: number;
  deployer: string;
}

export type SwapResultType = { type: 'success' | 'error'; hash?: string; amtOut?: string; error?: string };

interface IPoolContract extends BaseContractProperties {
  swap(tokenIn: Address, amountIn: bigint, minAmountOut: bigint): Promise<CallResult>;
  getReserves(): Promise<CallResult>;
}

interface IMintableContract extends BaseContractProperties {
  publicMint(amount: bigint): Promise<CallResult>;
}

const MINT_AMOUNT = 1000;
const INIT_RESERVE_A = 5_000_000;
const INIT_RESERVE_B = 25_000_000;

export const BASE_TOKENS: Token[] = [
  { symbol: 'MINE', name: DEPLOYED_CONTRACTS.MINE.name, icon: DEPLOYED_CONTRACTS.MINE.icon, decimals: 8, address: DEPLOYED_CONTRACTS.MINE.address, pubkey: DEPLOYED_CONTRACTS.MINE.pubkey },
  { symbol: 'VIBE', name: DEPLOYED_CONTRACTS.VIBE.name, icon: DEPLOYED_CONTRACTS.VIBE.icon, decimals: 8, address: DEPLOYED_CONTRACTS.VIBE.address, pubkey: DEPLOYED_CONTRACTS.VIBE.pubkey },
];

export function getAmountOut(amountIn: number, reserveIn: number, reserveOut: number): { out: number; impact: number } {
  const fee = amountIn * 0.003;
  const inAfterFee = amountIn - fee;
  const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const effectivePrice = out / amountIn;
  const impact = Math.abs(1 - effectivePrice / spotPrice) * 100;
  return { out, impact };
}

// Re-export for components that need them
export { getTxUrl, getContractOpscanUrl, formatTimeAgo };

export interface UseSwapReturn {
  walletAddress: string | null;
  connected: boolean;
  openConnectModal: () => void;
  senderAddr: Address | null;
  SWAP_TOKENS: Token[];
  heldTokens: Token[];
  motoPools: MotoswapPool[];
  reserveA: number;
  reserveB: number;
  fetchReserves: () => Promise<void>;
  poolReady: boolean;
  fromIdx: number;
  setFromIdx: React.Dispatch<React.SetStateAction<number>>;
  toIdx: number;
  setToIdx: React.Dispatch<React.SetStateAction<number>>;
  fromAmt: string;
  setFromAmt: React.Dispatch<React.SetStateAction<string>>;
  slippage: number;
  setSlippage: React.Dispatch<React.SetStateAction<number>>;
  swapping: boolean;
  swapStep: string;
  swapResult: SwapResultType | null;
  setSwapResult: React.Dispatch<React.SetStateAction<SwapResultType | null>>;
  showSettings: boolean;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  balances: Record<string, bigint>;
  balLoading: boolean;
  setBalRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  from: Token;
  to: Token;
  fromVal: number;
  toVal: number;
  hasPool: boolean;
  rIn: number;
  rOut: number;
  isSimplePool: boolean;
  motoPool: MotoswapPool | null;
  priceImpact: number;
  rate: number;
  fee: number;
  fromBal: bigint | undefined;
  toBal: bigint | undefined;
  fmtBal: (b: bigint | undefined, dec: number) => string;
  flip: () => void;
  doSwap: () => Promise<void>;
  minting: string | null;
  mintResult: { sym: string; ok: boolean; msg: string } | null;
  setMintResult: React.Dispatch<React.SetStateAction<{ sym: string; ok: boolean; msg: string } | null>>;
  mintTokens: (sym: string) => Promise<void>;
  history: TxRecord[];
  mainTab: SwapMainTab;
  setMainTab: React.Dispatch<React.SetStateAction<SwapMainTab>>;
  userPools: UserPool[];
  removeUserPool: (address: string) => void;
  createPoolOpen: boolean;
  setCreatePoolOpen: React.Dispatch<React.SetStateAction<boolean>>;
  poolTokenA: string;
  setPoolTokenA: React.Dispatch<React.SetStateAction<string>>;
  poolTokenB: string;
  setPoolTokenB: React.Dispatch<React.SetStateAction<string>>;
  poolSymA: string;
  setPoolSymA: React.Dispatch<React.SetStateAction<string>>;
  poolSymB: string;
  setPoolSymB: React.Dispatch<React.SetStateAction<string>>;
  deployingPool: boolean;
  poolDeployStep: string;
  poolDeployResult: { ok: boolean; msg: string; address?: string } | null;
  createPool: () => Promise<void>;
  showLiquidity: boolean;
  setShowLiquidity: React.Dispatch<React.SetStateAction<boolean>>;
  lpUserMine: number;
  MINT_AMOUNT: number;
  failOp: (id: string, error: string) => void;
  provider: ReturnType<typeof getProvider>;
}

export function useSwap(): UseSwapReturn {
  const { walletAddress, walletInstance, publicKey, hashedMLDSAKey, address: senderAddr, openConnectModal } = useWalletConnect();
  const { trackOp, completeOp, failOp } = useOps();

  // Dynamic token list: base + indexer-discovered
  const [, setExtraTokens] = useState<Token[]>([]);

  // Tokens user actually holds (for pool creation picker)
  const [heldTokens, setHeldTokens] = useState<Token[]>([]);

  // Motoswap pools discovered by backend
  const [motoPools, setMotoPools] = useState<MotoswapPool[]>([]);

  // Fetch Motoswap pools
  useEffect(() => {
    fetchMotoswapPools().then(pools => {
      if (pools.length > 0) setMotoPools(pools);
    }).catch((e) => { logger.warn('[useSwap] Motoswap pools fetch error:', e); });
    const iv = setInterval(() => {
      fetchMotoswapPools().then(pools => {
        if (pools.length > 0) setMotoPools(pools);
      }).catch((e) => { logger.warn('[useSwap] Motoswap pools poll error:', e); });
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  // Fetch tokens from indexer on mount
  useEffect(() => {
    fetchAllTokens().then(indexed => {
      const extra: Token[] = indexed
        .filter(t => !BASE_TOKENS.some(bt => bt.address === t.address))
        .map(t => ({
          symbol: t.symbol,
          name: t.name,
          icon: '',
          decimals: t.decimals,
          address: t.address,
          pubkey: t.pubkey,
        }));
      if (extra.length > 0) setExtraTokens(extra);
    }).catch((e) => { logger.warn('[useSwap] Indexer token fetch error:', e); });
  }, []);

  // Load tokens user holds (for pool creation picker)
  useEffect(() => {
    if (!walletAddress || !hashedMLDSAKey) { setHeldTokens([]); return; }
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    fetchHolderBalances(mldsa, tweaked).then(results => {
      const held: Token[] = results.map(r => ({
        symbol: r.symbol, name: r.name, icon: '',
        decimals: r.decimals, address: r.token, pubkey: r.pubkey,
      }));
      const heldAddrs = new Set(held.map(t => t.pubkey));
      const base = BASE_TOKENS.filter(bt => heldAddrs.has(bt.pubkey));
      const extra = held.filter(t => !BASE_TOKENS.some(bt => bt.pubkey === t.pubkey));
      setHeldTokens([...base, ...extra]);
    }).catch((e) => { logger.warn('[useSwap] Held tokens fetch error:', e); });
  }, [walletAddress, hashedMLDSAKey, publicKey]);

  // Swap state
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [fromAmt, setFromAmt] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [swapping, setSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState('');
  const [swapResult, setSwapResult] = useState<SwapResultType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [, setBtcPrice] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [balLoading, setBalLoading] = useState(false);
  const [balRefreshKey, setBalRefreshKey] = useState(0);
  const [minting, setMinting] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<{sym: string; ok: boolean; msg: string} | null>(null);
  const [, setTokenSupplies] = useState<Record<string, bigint>>({});
  const [reserveA, setReserveA] = useState(INIT_RESERVE_A);
  const [reserveB, setReserveB] = useState(INIT_RESERVE_B);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [mainTab, setMainTab] = useState<SwapMainTab>('swap');

  // Pool creation state
  const [userPools, setUserPools] = useState<UserPool[]>(() => {
    try { return JSON.parse(localStorage.getItem('hub_user_pools') || '[]'); } catch (e) { logger.warn('[useSwap] Failed to parse user pools from localStorage:', e); return []; }
  });
  const [createPoolOpen, setCreatePoolOpen] = useState(false);
  const [poolTokenA, setPoolTokenA] = useState('');
  const [poolTokenB, setPoolTokenB] = useState('');
  const [poolSymA, setPoolSymA] = useState('');
  const [poolSymB, setPoolSymB] = useState('');
  const [, setPoolSeedA] = useState('');
  const [, setPoolSeedB] = useState('');
  const [deployingPool, setDeployingPool] = useState(false);
  const [poolDeployStep, setPoolDeployStep] = useState('');
  const [poolDeployResult, setPoolDeployResult] = useState<{ ok: boolean; msg: string; address?: string } | null>(null);
  const [showLiquidity, setShowLiquidity] = useState(false);

  // LP position (read from localStorage, updated by addLiquidity)
  const [lpUserMine] = useState(() => {
    try { return Number(localStorage.getItem('hub_lp_mine') || '0'); } catch (e) { logger.warn('[useSwap] Failed to parse LP MINE from localStorage:', e); return 0; }
  });

  // TX history
  useEffect(() => {
    if (walletAddress) setHistory(getTxHistory(walletAddress).filter(r => r.type === 'swap' || r.type === 'mint' || r.type === 'claim'));
  }, [walletAddress, balRefreshKey]);

  const poolReady = !!POOL_ADDRESS;

  /** Singleton opnet provider */
  const provider = useMemo(() => getProvider(), []);

  /** Fetch pool reserves from chain */
  const fetchReserves = useCallback(async () => {
    if (!POOL_ADDRESS) return;
    try {
      const res = await opnetRpc.callContract(POOL_ADDRESS, '06374bfc');
      if (res) {
        const hex = res.startsWith('0x') ? res.slice(2) : res;
        if (hex.length >= 128) {
          const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
          const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
          if (r0 > 0) setReserveA(r0);
          if (r1 > 0) setReserveB(r1);
        }
      }
    } catch (e) { logger.warn('[useSwap] Pool reserves fetch failed:', e); }
  }, []);

  useEffect(() => { void fetchReserves(); }, [fetchReserves]);
  useEffect(() => { void fetchBtcPrice().then(p => { if (p.usd > 0) setBtcPrice(p.usd); }); }, []);

  useEffect(() => {
    const prevNet = opnetRpc.getNetwork();
    opnetRpc.setNetwork(CURRENT_ENV);
    Object.entries(DEPLOYED_CONTRACTS).forEach(([sym, tok]) => {
      opnetRpc.getTokenTotalSupply(tok.address).then(supply => {
        if (supply > 0n) setTokenSupplies(prev => ({ ...prev, [sym]: supply }));
      }).catch((e) => { logger.warn('[useSwap] Token supply fetch error:', e); });
    });
    return () => { opnetRpc.setNetwork(prevNet); };
  }, []);

  // Fetch balances
  useEffect(() => {
    if (!walletAddress || !hashedMLDSAKey) { setBalances({}); return; }
    const prevNet = opnetRpc.getNetwork();
    opnetRpc.setNetwork(CURRENT_ENV);
    setBalLoading(true);
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    const jobs: Promise<void>[] = [];
    for (const [sym, tok] of Object.entries(DEPLOYED_CONTRACTS)) {
      jobs.push(
        opnetRpc.getTokenBalance(tok.address, mldsa, tweaked)
          .then(b => setBalances(prev => ({ ...prev, [sym]: b })))
          .catch((e) => { logger.warn('[useSwap] Token balance fetch error:', e); })
      );
    }
    jobs.push(
      opnetRpc.getBalance(walletAddress)
        .then(b => setBalances(prev => ({ ...prev, BTC: b })))
        .catch((e) => { logger.warn('[useSwap] BTC balance fetch error:', e); })
    );
    void Promise.allSettled(jobs).finally(() => setBalLoading(false));
    return () => { opnetRpc.setNetwork(prevNet); };
  }, [walletAddress, hashedMLDSAKey, publicKey, balRefreshKey]);

  // Build swappable tokens list: BASE_TOKENS + unique tokens from Motoswap pools
  const SWAP_TOKENS = useMemo(() => {
    const known = new Set(BASE_TOKENS.map(t => t.pubkey));
    const extra: Token[] = [];
    for (const p of motoPools) {
      if (!known.has(p.token0_pubkey)) {
        known.add(p.token0_pubkey);
        extra.push({ symbol: p.token0_symbol, name: p.token0_symbol, icon: '', decimals: p.token0_decimals, address: p.token0_pubkey, pubkey: p.token0_pubkey });
      }
      if (!known.has(p.token1_pubkey)) {
        known.add(p.token1_pubkey);
        extra.push({ symbol: p.token1_symbol, name: p.token1_symbol, icon: '', decimals: p.token1_decimals, address: p.token1_pubkey, pubkey: p.token1_pubkey });
      }
    }
    return [...BASE_TOKENS, ...extra];
  }, [motoPools]);

  // SWAP_TOKENS always contains BASE_TOKENS (MINE + VIBE), so indices 0/1 are guaranteed
  const from = SWAP_TOKENS[fromIdx] ?? (SWAP_TOKENS[0] as Token);
  const to = SWAP_TOKENS[toIdx] ?? (SWAP_TOKENS[1] as Token);
  const fromVal = parseFloat(fromAmt) || 0;

  // Find which pool handles this pair: SimplePool (MINE/VIBE) or Motoswap
  const motoPool = useMemo(() => {
    if (!from || !to) return null;
    return motoPools.find(p =>
      (p.token0_pubkey === from.pubkey && p.token1_pubkey === to.pubkey) ||
      (p.token1_pubkey === from.pubkey && p.token0_pubkey === to.pubkey)
    ) || null;
  }, [from, to, motoPools]);

  const isSimplePool = from && to && (
    (from.symbol === 'MINE' && to.symbol === 'VIBE') ||
    (from.symbol === 'VIBE' && to.symbol === 'MINE')
  );

  // Determine reserves based on direction
  const isAToB = from?.symbol === 'MINE';
  let rIn = 0, rOut = 0;
  if (isSimplePool) {
    rIn = isAToB ? reserveA : reserveB;
    rOut = isAToB ? reserveB : reserveA;
  } else if (motoPool && from) {
    const isForward = from.pubkey === motoPool.token0_pubkey;
    const mr0 = Number(BigInt(motoPool.reserve0)) / Math.pow(10, motoPool.token0_decimals);
    const mr1 = Number(BigInt(motoPool.reserve1)) / Math.pow(10, motoPool.token1_decimals);
    rIn = isForward ? mr0 : mr1;
    rOut = isForward ? mr1 : mr0;
  }
  const hasPool = rIn > 0 && rOut > 0;
  const quote = hasPool && fromVal > 0 ? getAmountOut(fromVal, rIn, rOut) : null;
  const toVal = quote?.out ?? 0;
  const priceImpact = quote?.impact ?? 0;
  const rate = hasPool ? rOut / rIn : 0;
  const fee = fromVal * 0.003;

  const fromBal = balances[from?.symbol ?? ''];
  const toBal = balances[to?.symbol ?? ''];
  const fmtBal = (b: bigint | undefined, dec: number): string =>
    b != null ? (Number(b) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : (balLoading ? '...' : '--');

  const flip = (): void => { setFromIdx(toIdx); setToIdx(fromIdx); setFromAmt(''); setSwapResult(null); };

  useEffect(() => {
    if (fromIdx === toIdx) setToIdx(fromIdx === 0 ? 1 : 0);
  }, [fromIdx, toIdx]);

  /**
   * Execute swap — routes through SimplePool (MINE/VIBE) or Motoswap Router.
   */
  const doSwap = useCallback(async () => {
    if (!fromVal || fromVal <= 0 || !hasPool) return;

    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    if (!senderAddr) {
      setSwapResult({ type: 'error', error: 'Wallet public key not available. Reconnect wallet.' });
      return;
    }

    // Narrowed constants — guards above guarantee these are defined
    const activeWallet = walletAddress;
    const activeSender = senderAddr;

    setSwapping(true);
    setSwapResult(null);

    try {
      const rawAmount = BitcoinUtils.expandToDecimals(fromVal, from.decimals);
      const minOut = BitcoinUtils.expandToDecimals(toVal * (1 - slippage / 100), to.decimals);

      if (isSimplePool && poolReady) {
        // ── SimplePool swap (MINE ↔ VIBE) ──
        await ensureAllowance(
          from.address, POOL_PUBKEY, rawAmount,
          provider, activeSender, activeWallet, setSwapStep, from.symbol,
        );
        setSwapStep('Executing swap on SimplePool...');
        const poolContract = getContract<IPoolContract>(
          POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr,
        ) as unknown as IPoolContract;
        const tokenInAddr = Address.fromString(from.pubkey);
        const swapSim = await withRetry(() => poolContract.swap(tokenInAddr, rawAmount, minOut));
        if ((swapSim as CallResult).revert) throw new Error(`Swap simulation reverted: ${(swapSim as CallResult).revert}`);
        const txParams2 = await buildTxParams(provider, activeWallet);
        const swapOpId = `swap_${Date.now()}`;
        trackOp({ id: swapOpId, market: 'swap', orderId: `${from.symbol}→${to.symbol}`, direction: '', role: '', step: `Swapping ${fromVal} ${from.symbol}→${to.symbol}...` });
        const swapReceipt = await (swapSim as CallResult).sendTransaction(txParams2);
        const txHash = swapReceipt.transactionId || '';
        completeOp(swapOpId);
        setSwapStep('');
        setSwapResult({ type: 'success', hash: txHash, amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) });
        addTxRecord({ type: 'swap', txHash, tokenA: from.symbol, tokenB: to.symbol, amountA: fromVal.toString(), amountB: toVal.toFixed(6), status: 'confirmed', wallet: activeWallet });
      } else if (motoPool) {
        // ── Motoswap Router swap ──
        await ensureAllowance(
          from.pubkey, MOTOSWAP_ROUTER_PUBKEY, rawAmount,
          provider, activeSender, activeWallet, setSwapStep, from.symbol,
        );
        setSwapStep('Executing swap via Motoswap Router...');
        const router = getContract<IMotoswapRouterContract>(
          MOTOSWAP_ROUTER_ADDRESS, MOTOSWAP_ROUTER_ABI, provider, NETWORK, senderAddr,
        );
        const tokenInAddr = Address.fromString(from.pubkey);
        const tokenOutAddr = Address.fromString(to.pubkey);
        const toAddr = typeof activeSender === 'string' ? Address.fromString(activeSender) : activeSender;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min
        const swapSim = await withRetry(() =>
          router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            rawAmount, minOut, [tokenInAddr, tokenOutAddr], toAddr, deadline,
          )
        );
        if ((swapSim as CallResult).revert) throw new Error(`Motoswap swap reverted: ${(swapSim as CallResult).revert}`);
        const txParams2 = await buildTxParams(provider, activeWallet);
        const swapOpId = `motoswap_${Date.now()}`;
        trackOp({ id: swapOpId, market: 'swap', orderId: `${from.symbol}→${to.symbol}`, direction: 'motoswap', role: '', step: `Swapping via Motoswap...` });
        const swapReceipt = await (swapSim as CallResult).sendTransaction(txParams2);
        const txHash = swapReceipt.transactionId || '';
        completeOp(swapOpId);
        setSwapStep('');
        setSwapResult({ type: 'success', hash: txHash, amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) });
        addTxRecord({ type: 'swap', txHash, tokenA: from.symbol, tokenB: to.symbol, amountA: fromVal.toString(), amountB: toVal.toFixed(6), status: 'confirmed', wallet: activeWallet });
      } else {
        throw new Error('No pool found for this pair');
      }

      localStorage.setItem('hub_swapped', '1');
      setTimeout(() => setBalRefreshKey(k => k + 1), 3000);
    } catch (e) {
      logger.error('[Swap]', e);
      setSwapStep('');
      setSwapResult({ type: 'error', error: formatTxError(e) });
    } finally {
      setSwapping(false);
    }
  }, [fromVal, hasPool, walletAddress, walletInstance, from, to, toVal, slippage, poolReady, isSimplePool, motoPool, openConnectModal, provider, senderAddr, completeOp, trackOp]);

  /** On-chain publicMint — mints fixed 1000 tokens via MintableToken contract */
  const mintTokens = useCallback(async (sym: string) => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!senderAddr) { setMintResult({ sym, ok: false, msg: 'Wallet not available. Reconnect.' }); return; }

    // Narrowed constant — guard above guarantees walletAddress is defined
    const activeWallet = walletAddress;

    setMinting(sym);
    setMintResult(null);
    try {
      const tok = DEPLOYED_CONTRACTS[sym as keyof typeof DEPLOYED_CONTRACTS];
      if (!tok) throw new Error('Unknown token');
      const rawAmount = BitcoinUtils.expandToDecimals(MINT_AMOUNT, tok.decimals);
      const contract = getContract<IMintableContract>(tok.address, MINTABLE_ABI, provider, NETWORK, senderAddr);
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      if ((sim as CallResult).revert) throw new Error(`Mint reverted: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, activeWallet);
      const mOpId = `mint_${sym}_${Date.now()}`;
      trackOp({ id: mOpId, market: 'mint', orderId: sym, direction: '', role: '', step: `Minting ${MINT_AMOUNT.toLocaleString()} ${sym}...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      completeOp(mOpId);
      const txHash = receipt.transactionId || '';
      setMintResult({ sym, ok: true, msg: `Minted ${MINT_AMOUNT.toLocaleString()} ${sym}! TX: ${txHash.slice(0, 16)}…` });
      addTxRecord({ type: 'mint', txHash, tokenA: sym, amountA: MINT_AMOUNT.toString(), status: 'confirmed', wallet: activeWallet });
      setTimeout(() => setBalRefreshKey(k => k + 1), 5000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = `No BTC UTXOs.${CURRENT_ENV !== 'mainnet' ? ' Get ' + CURRENT_ENV + ' BTC: https://faucet.opnet.org' : ''}`;
      setMintResult({ sym, ok: false, msg });
    } finally {
      setMinting(null);
    }
  }, [walletAddress, walletInstance, openConnectModal, provider, senderAddr, trackOp, completeOp]);

  /** Deploy a new SimplePool for any token pair */
  const createPool = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!poolTokenA || !poolTokenB) return;
    if (poolTokenA === poolTokenB) { setPoolDeployResult({ ok: false, msg: 'Token A and B must be different' }); return; }

    const inst = walletInstance as { web3?: Record<string, unknown>; deployContract?: unknown };
    const web3 = inst.web3 || inst;
    if (!(web3 as Record<string, unknown>)?.deployContract) { setPoolDeployResult({ ok: false, msg: 'Wallet does not support deployment. Use OP_WALLET.' }); return; }

    setDeployingPool(true); setPoolDeployResult(null);
    try {
      setPoolDeployStep('Loading SimplePool bytecode...');
      const base = import.meta.env.BASE_URL || '/';
      const resp = await fetch(`${base}wasm/SimplePool.wasm`);
      if (!resp.ok) throw new Error('Failed to load SimplePool.wasm');
      const bytecode = new Uint8Array(await resp.arrayBuffer());

      setPoolDeployStep('Encoding token addresses...');
      const writer = new BinaryWriter();
      writer.writeAddress(Address.fromString(poolTokenA));
      writer.writeAddress(Address.fromString(poolTokenB));

      setPoolDeployStep('Fetching UTXOs...');
      const provider2 = getProvider();
      const utxos = await provider2.utxoManager.getUTXOs({ address: walletAddress });
      if (!utxos?.length) throw new Error(`No UTXOs.${CURRENT_ENV !== 'mainnet' ? ' Get ' + CURRENT_ENV + ' BTC from faucet.' : ''}`);

      setPoolDeployStep('Sign in your wallet...');
      const deployFn = (web3 as { deployContract: (...args: unknown[]) => Promise<{ transaction: string[]; contractAddress?: string }> }).deployContract;
      const result = await deployFn({
        bytecode, calldata: writer.getBuffer(), utxos, from: walletAddress,
        feeRate: 10, priorityFee: 10_000n, gasSatFee: 100_000n,
        revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
      });

      setPoolDeployStep('Broadcasting...');
      const [fundingTx, deployTx] = result.transaction;
      if (fundingTx) await provider2.sendRawTransaction(fundingTx, false);
      if (deployTx) await provider2.sendRawTransaction(deployTx, false);

      let txid = '';
      try { txid = Transaction.fromHex(deployTx || fundingTx || '').getId(); } catch (e) { logger.warn('[useSwap] pool deploy txid parse error:', e); }

      const newPool: UserPool = {
        address: result.contractAddress || txid,
        tokenA: poolTokenA, tokenB: poolTokenB,
        symbolA: poolSymA || poolTokenA.slice(-6).toUpperCase(),
        symbolB: poolSymB || poolTokenB.slice(-6).toUpperCase(),
        deployedAt: Date.now(), deployer: walletAddress,
      };

      const updatedPools = [...userPools, newPool];
      setUserPools(updatedPools);
      localStorage.setItem('hub_user_pools', JSON.stringify(updatedPools));

      setPoolDeployResult({ ok: true, msg: `Pool deployed at ${newPool.address}`, address: newPool.address });
      setCreatePoolOpen(false);
      setPoolTokenA(''); setPoolTokenB(''); setPoolSymA(''); setPoolSymB('');
      setPoolSeedA(''); setPoolSeedB('');
    } catch (e) {
      setPoolDeployResult({ ok: false, msg: e instanceof Error ? e.message : 'Deployment failed' });
    } finally {
      setDeployingPool(false);
      setPoolDeployStep('');
    }
  }, [walletAddress, walletInstance, poolTokenA, poolTokenB, poolSymA, poolSymB, userPools, openConnectModal]);

  const removeUserPool = useCallback((address: string) => {
    const updated = userPools.filter(p => p.address !== address);
    setUserPools(updated);
    localStorage.setItem('hub_user_pools', JSON.stringify(updated));
  }, [userPools]);

  return {
    // Wallet
    walletAddress,
    connected: !!walletAddress,
    openConnectModal,
    senderAddr,
    // Tokens
    SWAP_TOKENS,
    heldTokens,
    motoPools,
    // Pool reserves
    reserveA,
    reserveB,
    fetchReserves,
    poolReady,
    // Swap state
    fromIdx, setFromIdx,
    toIdx, setToIdx,
    fromAmt, setFromAmt,
    slippage, setSlippage,
    swapping,
    swapStep,
    swapResult, setSwapResult,
    showSettings, setShowSettings,
    // Balances
    balances,
    balLoading,
    setBalRefreshKey,
    // Derived swap values
    from, to, fromVal, toVal,
    hasPool, rIn, rOut,
    isSimplePool, motoPool,
    priceImpact, rate, fee,
    fromBal, toBal, fmtBal,
    // Actions
    flip,
    doSwap,
    // Mint
    minting,
    mintResult, setMintResult,
    mintTokens,
    // TX history
    history,
    // Pool creation
    mainTab, setMainTab,
    userPools, removeUserPool,
    createPoolOpen, setCreatePoolOpen,
    poolTokenA, setPoolTokenA,
    poolTokenB, setPoolTokenB,
    poolSymA, setPoolSymA,
    poolSymB, setPoolSymB,
    deployingPool,
    poolDeployStep,
    poolDeployResult,
    createPool,
    // Liquidity modal
    showLiquidity, setShowLiquidity,
    // LP position
    lpUserMine,
    // Misc
    MINT_AMOUNT,
    failOp,
    provider,
  };
}
