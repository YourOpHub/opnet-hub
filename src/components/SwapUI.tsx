import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type IOP20Contract, type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import * as opnetRpc from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { addTxRecord, getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';
import {
  TESTNET_CONTRACTS,
  POOL_ADDRESS, POOL_PUBKEY,
  getTxUrl, getContractOpscanUrl,
} from '../contracts';
import LiquidityModal from './LiquidityModal';

/** OPNet testnet network config */
const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';
const FAUCET_URL = 'https://188-137-250-160.sslip.io/faucet';

/** Custom ABI for SimplePool contract */
const POOL_ABI: BitcoinInterfaceAbi = [
  {
    name: 'swap',
    inputs: [
      { name: 'tokenIn', type: ABIDataTypes.ADDRESS },
      { name: 'amountIn', type: ABIDataTypes.UINT256 },
      { name: 'minAmountOut', type: ABIDataTypes.UINT256 },
    ],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserves',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'reserveA', type: ABIDataTypes.UINT256 },
      { name: 'reserveB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'sync',
    inputs: [],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

/** ABI for MintableToken publicMint method */
const MINTABLE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

const MINT_AMOUNT = 1000; // Fixed 1000 tokens per mint

/** Fetch network gas parameters and build proper tx params */
async function buildTxParams(provider: JSONRpcProvider, refundTo: string) {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  // priorityFee = baseGas converted to sats via gasPerSat, capped at reasonable range
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    signer: null,
    mldsaSigner: null,
    refundTo,
    maximumAllowedSatToSpend: 250_000n,
    network: NETWORK,
    feeRate,
    priorityFee,
  } as any;
}

/** Retry wrapper for flaky RPC simulations */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Retry exhausted');
}

interface IPoolContract {
  swap(tokenIn: Address, amountIn: bigint, minAmountOut: bigint): Promise<CallResult>;
  getReserves(): Promise<CallResult>;
  sync(): Promise<CallResult>;
}

/** Initial pool reserves (will be read from chain once pool is deployed) */
const INIT_RESERVE_A = 5_000_000;  // MINE
const INIT_RESERVE_B = 25_000_000; // VIBE

function getAmountOut(amountIn: number, reserveIn: number, reserveOut: number): { out: number; impact: number } {
  const fee = amountIn * 0.003;
  const inAfterFee = amountIn - fee;
  const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const effectivePrice = out / amountIn;
  const impact = Math.abs(1 - effectivePrice / spotPrice) * 100;
  return { out, impact };
}

interface Token { symbol: string; name: string; icon: string; decimals: number; address: string; pubkey: string; }

const TOKENS: Token[] = [
  { symbol: 'MINE', name: TESTNET_CONTRACTS.MINE.name, icon: TESTNET_CONTRACTS.MINE.icon, decimals: 8, address: TESTNET_CONTRACTS.MINE.address, pubkey: TESTNET_CONTRACTS.MINE.pubkey },
  { symbol: 'VIBE', name: TESTNET_CONTRACTS.VIBE.name, icon: TESTNET_CONTRACTS.VIBE.icon, decimals: 8, address: TESTNET_CONTRACTS.VIBE.address, pubkey: TESTNET_CONTRACTS.VIBE.pubkey },
];

type SwapResultType = { type: 'success' | 'error'; hash?: string; amtOut?: string; error?: string };

const SwapUI: React.FC = () => {
  const { walletAddress, walletInstance, publicKey, hashedMLDSAKey, address: senderAddr, openConnectModal } = useWalletConnect();

  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [fromAmt, setFromAmt] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [swapping, setSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState('');
  const [swapResult, setSwapResult] = useState<SwapResultType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [balLoading, setBalLoading] = useState(false);
  const [balRefreshKey, setBalRefreshKey] = useState(0);
  const [minting, setMinting] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<{sym: string; ok: boolean; msg: string} | null>(null);
  const [tokenSupplies, setTokenSupplies] = useState<Record<string, bigint>>({});
  const [reserveA, setReserveA] = useState(INIT_RESERVE_A);
  const [reserveB, setReserveB] = useState(INIT_RESERVE_B);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [showLiquidity, setShowLiquidity] = useState(false);
  const [lpMineAmt, setLpMineAmt] = useState('');
  const [lpVibeAmt, setLpVibeAmt] = useState('');
  const [addingLP, setAddingLP] = useState(false);
  const [lpStep, setLpStep] = useState('');
  const [lpResult, setLpResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lpUserMine, setLpUserMine] = useState(() => {
    try { return Number(localStorage.getItem('hub_lp_mine') || '0'); } catch { return 0; }
  });
  const [lpUserVibe, setLpUserVibe] = useState(() => {
    try { return Number(localStorage.getItem('hub_lp_vibe') || '0'); } catch { return 0; }
  });

  useEffect(() => {
    if (walletAddress) setHistory(getTxHistory(walletAddress).filter(r => r.type === 'swap' || r.type === 'mint' || r.type === 'claim'));
  }, [walletAddress, balRefreshKey]);

  const poolReady = !!POOL_ADDRESS;

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
    } catch { /* fallback to init */ }
  }, []);

  useEffect(() => { fetchReserves(); }, [fetchReserves]);
  useEffect(() => { fetchBtcPrice().then(p => { if (p.usd > 0) setBtcPrice(p.usd); }); }, []);

  useEffect(() => {
    opnetRpc.setNetwork('testnet');
    Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
      opnetRpc.getTokenTotalSupply(tok.address).then(supply => {
        if (supply > 0n) setTokenSupplies(prev => ({ ...prev, [sym]: supply }));
      }).catch(() => {});
    });
  }, []);

  // Fetch balances
  useEffect(() => {
    if (!walletAddress || !hashedMLDSAKey) { setBalances({}); return; }
    opnetRpc.setNetwork('testnet');
    setBalLoading(true);
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    const jobs: Promise<void>[] = [];
    for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
      jobs.push(
        opnetRpc.getTokenBalance(tok.address, mldsa, tweaked)
          .then(b => setBalances(prev => ({ ...prev, [sym]: b })))
          .catch(() => {})
      );
    }
    jobs.push(
      opnetRpc.getBalance(walletAddress)
        .then(b => setBalances(prev => ({ ...prev, BTC: b })))
        .catch(() => {})
    );
    Promise.allSettled(jobs).finally(() => setBalLoading(false));
  }, [walletAddress, hashedMLDSAKey, publicKey, balRefreshKey]);

  const from = TOKENS[fromIdx] || TOKENS[0];
  const to = TOKENS[toIdx] || TOKENS[1];
  const fromVal = parseFloat(fromAmt) || 0;

  // Determine reserves based on direction
  const isAToB = from.symbol === 'MINE';
  const rIn = isAToB ? reserveA : reserveB;
  const rOut = isAToB ? reserveB : reserveA;
  const hasPool = rIn > 0 && rOut > 0;
  const quote = hasPool && fromVal > 0 ? getAmountOut(fromVal, rIn, rOut) : null;
  const toVal = quote?.out ?? 0;
  const priceImpact = quote?.impact ?? 0;
  const rate = hasPool ? rOut / rIn : 0;
  const fee = fromVal * 0.003;

  const fromBal = balances[from.symbol];
  const toBal = balances[to.symbol];
  const fmtBal = (b: bigint | undefined, dec: number) => b != null ? (Number(b) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : (balLoading ? '...' : '--');

  const flip = () => { setFromIdx(toIdx); setToIdx(fromIdx); setFromAmt(''); setSwapResult(null); };

  /** Create opnet provider (memoized) */
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  // senderAddr comes directly from useWalletConnect() as 'address'

  /**
   * Execute a REAL on-chain swap via SimplePool AMM:
   * Step 1: increaseAllowance(poolAddress, amountIn) on token-in
   * Step 2: swap(tokenIn, amountIn, minAmountOut) on pool contract
   * Uses getContract() from opnet — proper ABI encoding + wallet signing.
   */
  const doSwap = useCallback(async () => {
    if (!fromVal || fromVal <= 0 || !hasPool) return;

    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    if (!poolReady) {
      setSwapResult({ type: 'error', error: 'Pool contract not yet deployed. Coming soon!' });
      return;
    }

    if (!senderAddr) {
      setSwapResult({ type: 'error', error: 'Wallet public key not available. Reconnect wallet.' });
      return;
    }

    setSwapping(true);
    setSwapResult(null);

    try {
      const rawAmount = BitcoinUtils.expandToDecimals(fromVal, from.decimals);
      const minOut = BitcoinUtils.expandToDecimals(toVal * (1 - slippage / 100), to.decimals);

      // STEP 1: Approve pool to spend token-in
      setSwapStep('Approving token spend...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenContract = getContract<IOP20Contract>(
        from.address, OP_20_ABI, provider, NETWORK, senderAddr as any,
      );
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;
      const approveSim = await withRetry(() => tokenContract.increaseAllowance(poolAddr, rawAmount));

      if (approveSim.revert) {
        throw new Error(`Approval simulation reverted: ${approveSim.revert}`);
      }

      const txParams1 = await buildTxParams(provider, walletAddress!);
      const approveReceipt = await approveSim.sendTransaction(txParams1);
      console.log('[Swap] Approve TX:', approveReceipt.transactionId);

      // Wait for approval to propagate on-chain (needs block confirmation)
      setSwapStep('Waiting for approval confirmation (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // STEP 2: Call swap on pool — rebuild txParams (UTXOs changed)
      setSwapStep('Executing swap on pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(
        POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any,
      ) as unknown as IPoolContract;
      const tokenInAddr = Address.fromString(from.pubkey);
      const swapSim = await withRetry(() => poolContract.swap(tokenInAddr, rawAmount, minOut));

      if ((swapSim as CallResult).revert) {
        throw new Error(`Swap simulation reverted: ${(swapSim as CallResult).revert}`);
      }

      const txParams2 = await buildTxParams(provider, walletAddress!);
      const swapReceipt = await (swapSim as CallResult).sendTransaction(txParams2);
      const txHash = swapReceipt.transactionId || '';

      setSwapStep('');
      setSwapResult({
        type: 'success', hash: txHash,
        amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      });
      addTxRecord({ type: 'swap', txHash, tokenA: from.symbol, tokenB: to.symbol, amountA: fromVal.toString(), amountB: toVal.toFixed(6), status: 'confirmed', wallet: walletAddress! });
      localStorage.setItem('hub_swapped', '1');
      // Refresh balances after swap
      setTimeout(() => setBalRefreshKey(k => k + 1), 3000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Swap failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'Your wallet has no BTC UTXOs. Get testnet BTC first: https://faucet.opnet.org';
      else if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('fetch')) msg = 'Network timeout — try again in a few seconds.';
      else if (msg.toLowerCase().includes('revert')) msg += ' (Try again — testnet can be flaky)';
      console.error('[Swap]', e);
      setSwapStep('');
      setSwapResult({ type: 'error', error: msg });
    } finally {
      setSwapping(false);
    }
  }, [fromVal, hasPool, walletAddress, walletInstance, from, to, toVal, slippage, poolReady, openConnectModal, provider, senderAddr]);

  /** On-chain publicMint — mints fixed 1000 tokens via MintableToken contract */
  const mintTokens = useCallback(async (sym: string) => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!senderAddr) { setMintResult({ sym, ok: false, msg: 'Wallet not available. Reconnect.' }); return; }
    setMinting(sym);
    setMintResult(null);
    try {
      const tok = TESTNET_CONTRACTS[sym as keyof typeof TESTNET_CONTRACTS];
      if (!tok) throw new Error('Unknown token');
      const rawAmount = BitcoinUtils.expandToDecimals(MINT_AMOUNT, tok.decimals);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract = getContract<any>(tok.address, MINTABLE_ABI, provider, NETWORK, senderAddr as any);
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      if ((sim as CallResult).revert) throw new Error(`Mint reverted: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress!);
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      setMintResult({ sym, ok: true, msg: `Minted ${MINT_AMOUNT.toLocaleString()} ${sym}! TX: ${txHash.slice(0, 16)}…` });
      addTxRecord({ type: 'mint', txHash, tokenA: sym, amountA: MINT_AMOUNT.toString(), status: 'confirmed', wallet: walletAddress! });
      setTimeout(() => setBalRefreshKey(k => k + 1), 5000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC: https://faucet.opnet.org';
      setMintResult({ sym, ok: false, msg });
    } finally {
      setMinting(null);
    }
  }, [walletAddress, walletInstance, openConnectModal, provider, senderAddr]);

  /** Add Liquidity: transfer MINE + VIBE to pool → call sync() */
  const addLiquidity = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const mineAmt = parseFloat(lpMineAmt);
    const vibeAmt = parseFloat(lpVibeAmt);
    if (!mineAmt || !vibeAmt || mineAmt <= 0 || vibeAmt <= 0) {
      setLpResult({ ok: false, msg: 'Enter both MINE and VIBE amounts' });
      return;
    }
    if (!senderAddr) { setLpResult({ ok: false, msg: 'Wallet public key not available' }); return; }

    setAddingLP(true);
    setLpResult(null);
    try {
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;

      // 1. Transfer MINE to pool
      setLpStep('Transferring MINE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mineContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.MINE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const mineRaw = BitcoinUtils.expandToDecimals(mineAmt, 8);
      const mineSim = await withRetry(() => mineContract.transfer(poolAddr, mineRaw));
      if (mineSim.revert) throw new Error(`MINE transfer failed: ${mineSim.revert}`);
      const txParams1 = await buildTxParams(provider, walletAddress);
      const mineReceipt = await mineSim.sendTransaction(txParams1);
      console.log('[LP] MINE transfer TX:', mineReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for MINE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 2. Transfer VIBE to pool — fresh txParams (UTXOs changed)
      setLpStep('Transferring VIBE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vibeContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.VIBE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const vibeRaw = BitcoinUtils.expandToDecimals(vibeAmt, 8);
      const vibeSim = await withRetry(() => vibeContract.transfer(poolAddr, vibeRaw));
      if (vibeSim.revert) throw new Error(`VIBE transfer failed: ${vibeSim.revert}`);
      const txParams2 = await buildTxParams(provider, walletAddress);
      const vibeReceipt = await vibeSim.sendTransaction(txParams2);
      console.log('[LP] VIBE transfer TX:', vibeReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for VIBE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 3. Call sync() on pool — fresh txParams again
      setLpStep('Syncing pool reserves...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any);
      const syncSim = await withRetry(() => poolContract.sync());
      if ((syncSim as CallResult).revert) throw new Error(`Sync failed: ${(syncSim as CallResult).revert}`);
      const txParams3 = await buildTxParams(provider, walletAddress);
      const syncReceipt = await (syncSim as CallResult).sendTransaction(txParams3);

      setLpStep('');
      setLpResult({ ok: true, msg: `Liquidity added! ${mineAmt} MINE + ${vibeAmt} VIBE. Sync TX: ${syncReceipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: syncReceipt.transactionId || '', tokenA: 'LP', amountA: `${mineAmt}+${vibeAmt}`, status: 'confirmed', wallet: walletAddress });
      setLpUserMine(prev => { const v = prev + mineAmt; localStorage.setItem('hub_lp_mine', String(v)); return v; });
      setLpUserVibe(prev => { const v = prev + vibeAmt; localStorage.setItem('hub_lp_vibe', String(v)); return v; });
      // Refresh reserves + balances after LP
      setTimeout(() => { fetchReserves(); setBalRefreshKey(k => k + 1); }, 3000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Add liquidity failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC: https://faucet.opnet.org';
      setLpStep('');
      setLpResult({ ok: false, msg });
    } finally {
      setAddingLP(false);
    }
  }, [walletAddress, walletInstance, lpMineAmt, lpVibeAmt, provider, senderAddr, openConnectModal]);

  /** Auto-calculate VIBE amount based on current pool ratio */
  useEffect(() => {
    const mineAmt = parseFloat(lpMineAmt);
    if (mineAmt > 0 && reserveA > 0 && reserveB > 0) {
      const vibeNeeded = mineAmt * (reserveB / reserveA);
      setLpVibeAmt(vibeNeeded.toFixed(2));
    }
  }, [lpMineAmt, reserveA, reserveB]);

  useEffect(() => {
    if (fromIdx === toIdx) setToIdx(fromIdx === 0 ? 1 : 0);
  }, [fromIdx, toIdx]);

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
    color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
    fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
    flexShrink: 0, minWidth: 120, maxWidth: 140, whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', overflow: 'hidden', appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b95a9' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
    paddingRight: '28px',
  };

  const connected = !!walletAddress;

  return (
    <div>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <div style={{
          padding: '24px 22px', position: 'relative', borderRadius: 22,
          background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.06)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '.95rem', fontWeight: 800, color: 'var(--w)', letterSpacing: '-.02em' }}>Swap</span>
              {connected && <span style={{ fontSize: '.5rem', background: 'rgba(16,185,129,.08)', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>LIVE</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => { setShowLiquidity(!showLiquidity); setShowSettings(false); }} style={{
                background: showLiquidity ? 'rgba(14,165,233,.1)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (showLiquidity ? 'rgba(14,165,233,.25)' : 'rgba(255,255,255,.06)'), borderRadius: 10,
                color: showLiquidity ? '#0ea5e9' : 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>💧</button>
              <button onClick={() => { setShowSettings(!showSettings); setShowLiquidity(false); }} style={{
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10,
                color: 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>⚙ {slippage}%</button>
            </div>
          </div>

          {showSettings && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Slippage Tolerance</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }} style={{
                    flex: 1, padding: '6px', borderRadius: 'var(--rad)',
                    background: slippage === s ? 'var(--oG)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${slippage === s ? 'rgba(247,147,26,.2)' : 'var(--bd)'}`,
                    color: slippage === s ? 'var(--o)' : 'var(--t2)', fontSize: '.75rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--ff)'
                  }}>{s}%</button>
                ))}
              </div>
            </div>
          )}

          {/* Liquidity Modal */}
          <LiquidityModal
            open={showLiquidity}
            onClose={() => setShowLiquidity(false)}
            reserveA={reserveA}
            reserveB={reserveB}
            balances={balances}
            onRefresh={() => { fetchReserves(); setBalRefreshKey(k => k + 1); }}
          />

          {/* From */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>From</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(fromBal, from.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="decimal" value={fromAmt}
                onChange={e => { setFromAmt(e.target.value); setSwapResult(null); }}
                placeholder="0.0"
                style={{ flex: 1, background: 'none', border: 'none', color: 'var(--w)', fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, outline: 'none', minWidth: 0 }}
              />
              {fromBal != null && fromBal > 0n && (
                <button onClick={() => setFromAmt((Number(fromBal) / Math.pow(10, from.decimals)).toString())} style={{
                  background: 'rgba(247,147,26,.08)', border: '1px solid rgba(247,147,26,.2)', borderRadius: 6,
                  color: 'var(--o)', fontSize: '.6rem', fontWeight: 700, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--ff)'
                }}>MAX</button>
              )}
              <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Flip */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0', position: 'relative', zIndex: 2 }}>
            <button onClick={flip} style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--o), var(--o2))',
              border: '3px solid rgba(10,10,18,.8)', color: '#000', fontSize: '.9rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .25s cubic-bezier(.4,0,.2,1)', fontWeight: 700,
              boxShadow: '0 2px 12px rgba(247,147,26,.2)',
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>To (estimated)</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(toBal, to.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, color: toVal > 0 ? 'var(--w)' : 'var(--t4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Rate info */}
          {fromVal > 0 && hasPool && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Rate</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>1 {from.symbol} = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {to.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>LP Fee (0.3%)</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fee.toFixed(4)} {from.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Price Impact</span>
                <span style={{ color: priceImpact > 1 ? 'var(--r)' : 'var(--g)', fontFamily: 'var(--fm)' }}>{priceImpact.toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--t3)' }}>Min. Received</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{(toVal * (1 - slippage / 100)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span>
              </div>
            </div>
          )}

          {/* Pool badge */}
          {hasPool && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '.6rem', color: 'var(--t4)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: poolReady ? 'var(--g)' : 'var(--y)', display: 'inline-block' }} />
              Pool: {reserveA.toLocaleString()} MINE / {reserveB.toLocaleString()} VIBE {poolReady ? '(on-chain)' : '(deploying)'}
            </div>
          )}

          {/* Swap / Connect button */}
          {connected ? (
            <button onClick={doSwap}
              disabled={!fromVal || fromVal <= 0 || swapping || !hasPool}
              style={{
                width: '100%', padding: '14px', marginTop: 10,
                background: fromVal > 0 && hasPool ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'var(--bg4)',
                border: 'none', borderRadius: 'var(--rad)',
                color: fromVal > 0 && hasPool ? '#000' : 'var(--t4)', fontWeight: 700, fontSize: '.92rem',
                cursor: fromVal > 0 && hasPool ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--ff)', transition: 'all .2s',
                boxShadow: fromVal > 0 && hasPool ? '0 4px 16px rgba(247, 147, 26, .25)' : 'none',
                opacity: swapping ? 0.7 : 1
              }}>
              {swapping ? (swapStep || 'Processing...') : !poolReady ? 'Pool deploying soon...' : !hasPool ? 'No pool for this pair' : fromVal > 0 ? `Swap ${from.symbol} → ${to.symbol}` : 'Enter an amount'}
            </button>
          ) : (
            <button onClick={openConnectModal} style={{
              width: '100%', padding: '14px', marginTop: 10,
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', borderRadius: 'var(--rad)',
              color: '#fff', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', fontFamily: 'var(--ff)'
            }}>Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px',
              background: swapResult.type === 'error' ? 'rgba(239,68,68,.06)' : 'var(--gG)',
              border: `1px solid ${swapResult.type === 'error' ? 'rgba(239,68,68,.2)' : 'var(--gB)'}`,
              borderRadius: 'var(--rad)', fontSize: '.72rem' }}>
              {swapResult.type === 'success' && (
                <>
                  <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✓ Swap Executed On-Chain</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>Received: {swapResult.amtOut} {to.symbol}</div>
                  <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.58rem', marginTop: 4 }}>tx: {swapResult.hash}</div>
                  <a href={getTxUrl(swapResult.hash!)} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View on Explorer →</a>
                </>
              )}
              {swapResult.type === 'error' && (
                <>
                  <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>Transaction Failed</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>{swapResult.error}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Live contracts */}
        <div style={{ marginTop: 14, padding: '18px 20px', borderRadius: 18, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(16px)' }}>
          <div style={{ fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#5a6578', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Tokens</span>
            <span style={{ fontSize: '.48rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(247,147,26,.08)', color: '#F7931A', fontWeight: 700 }}>TESTNET</span>
          </div>
          {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
            const onChainSupply = tokenSupplies[sym];
            const supplyHuman = onChainSupply != null
              ? (Number(onChainSupply) / Math.pow(10, tok.decimals)).toLocaleString()
              : tok.supply.toLocaleString();
            return (
              <div key={tok.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '1rem', width: 20, flexShrink: 0 }}>{tok.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--w)', fontSize: '.78rem' }}>{tok.symbol}</span>
                    {onChainSupply != null && <span style={{ fontSize: '.48rem', background: 'var(--gG)', color: 'var(--g)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tok.address}</div>
                  <div style={{ fontSize: '.55rem', color: 'var(--t3)', marginTop: 1 }}>Supply: {supplyHuman}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, alignItems: 'flex-end' }}>
                  <button onClick={() => mintTokens(sym)} disabled={minting === sym}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: 'none', cursor: minting === sym ? 'wait' : 'pointer',
                      background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: 'white',
                      fontSize: '.6rem', fontWeight: 700, fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                      boxShadow: '0 2px 8px rgba(168,85,247,.25)',
                    }}>
                    {minting === sym ? 'Minting...' : `🪙 Mint 1K ${sym}`}
                  </button>
                  <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '.54rem', color: 'var(--c2)', whiteSpace: 'nowrap', textDecoration: 'none' }}>OPScan ↗</a>
                </div>
              </div>
            );
          })}
          {mintResult && (
            <div style={{ marginTop: 8, padding: '8px 12px',
              background: mintResult.ok ? 'var(--gG)' : 'rgba(239,68,68,.06)',
              border: `1px solid ${mintResult.ok ? 'var(--gB)' : 'rgba(239,68,68,.2)'}`,
              borderRadius: 'var(--rad)', fontSize: '.7rem',
              color: mintResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all' }}>
              {mintResult.msg}
            </div>
          )}
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.15)', borderRadius: 'var(--rad)', fontSize: '.62rem', color: 'var(--t3)' }}>
            Click <strong>Mint</strong> to receive 1,000 tokens via on-chain <code>publicMint</code>. Requires testnet BTC for gas.
          </div>
        </div>

        {/* Pool info */}
        <div style={{ marginTop: 14, padding: '18px 20px', borderRadius: 18, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(16px)' }}>
          <div style={{ fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#5a6578', marginBottom: 12 }}>Pool — SimplePool AMM</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ padding: '10px', background: 'rgba(255,255,255,.02)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 4, fontWeight: 600 }}>MINE</div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.78rem', fontWeight: 700, color: '#fff' }}>{reserveA.toLocaleString()}</div>
            </div>
            <div style={{ padding: '10px', background: 'rgba(255,255,255,.02)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 4, fontWeight: 600 }}>VIBE</div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.78rem', fontWeight: 700, color: '#fff' }}>{reserveB.toLocaleString()}</div>
            </div>
            <div style={{ padding: '10px', background: 'rgba(255,255,255,.02)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 4, fontWeight: 600 }}>RATE</div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.78rem', fontWeight: 700, color: '#F7931A' }}>1:{(reserveB / reserveA).toFixed(1)}</div>
            </div>
          </div>
          {poolReady && (
            <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.1)', borderRadius: 10, fontSize: '.58rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                <span style={{ color: '#10b981', fontWeight: 600 }}>Pool Live</span>
              </div>
              <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
                style={{ color: '#38bdf8', textDecoration: 'none', fontSize: '.56rem' }}>OPScan ↗</a>
            </div>
          )}
          {!poolReady && (
            <div style={{ padding: '8px 12px', background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.12)', borderRadius: 10, fontSize: '.6rem', color: '#f59e0b' }}>
              Pool deploying...
            </div>
          )}
          {btcPrice > 0 && <div style={{ marginTop: 8, fontSize: '.58rem', color: '#3d4555' }}>BTC: ${btcPrice.toLocaleString()}</div>}
        </div>

        {/* Pool share info */}
        {lpUserMine > 0 && (
          <div style={{ marginTop: 14, padding: '16px 20px', borderRadius: 18, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(14,165,233,.08)', backdropFilter: 'blur(16px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '.58rem', color: '#5a6578', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your Position</div>
                <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#fff' }}>{lpUserMine.toLocaleString()} MINE + {lpUserVibe.toLocaleString()} VIBE</div>
              </div>
              {reserveA > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '.5rem', color: '#5a6578', marginBottom: 2 }}>Share</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0ea5e9', fontFamily: "'JetBrains Mono', monospace" }}>{((lpUserMine / reserveA) * 100).toFixed(2)}%</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Transaction History */}
        {history.length > 0 && (
          <div style={{ marginTop: 14, padding: '18px 20px', borderRadius: 18, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(16px)' }}>
            <div style={{ fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#5a6578', marginBottom: 12 }}>History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {history.slice(0, 10).map(tx => (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,255,255,.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,.04)', fontSize: '.72rem' }}>
                  <span style={{ fontSize: '.85rem', width: 22, textAlign: 'center' }}>{tx.type === 'swap' ? '🔄' : '🎁'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '.72rem' }}>
                      {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `Claimed ${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                    </div>
                    <div style={{ fontSize: '.55rem', color: '#3d4555' }}>{formatTimeAgo(tx.ts)}</div>
                  </div>
                  {tx.txHash && (
                    <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.54rem', color: '#38bdf8', textDecoration: 'none', whiteSpace: 'nowrap' }}>TX ↗</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SwapUI;
