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

      // STEP 1: Check allowance — skip approval if already sufficient
      setSwapStep('Checking allowance...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenContract = getContract<IOP20Contract>(
        from.address, OP_20_ABI, provider, NETWORK, senderAddr as any,
      );
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;

      let needsApproval = true;
      try {
        const allowanceRes = await tokenContract.allowance(senderAddr as any, poolAddr);
        if (!(allowanceRes as CallResult).revert) {
          const props = (allowanceRes as CallResult).properties as Record<string, unknown>;
          const cur = props?.remaining ? BigInt(String(props.remaining)) : 0n;
          if (cur >= rawAmount) needsApproval = false;
        }
      } catch { /* proceed with approval */ }

      if (needsApproval) {
        setSwapStep('Approving token spend...');
        const approveAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const approveSim = await withRetry(() => tokenContract.increaseAllowance(poolAddr, approveAmount));
        if ((approveSim as CallResult).revert) throw new Error(`Approval reverted: ${(approveSim as CallResult).revert}`);
        const txParams1 = await buildTxParams(provider, walletAddress!);
        await (approveSim as CallResult).sendTransaction(txParams1);

        // Poll for allowance confirmation
        setSwapStep('Waiting for approval confirmation...');
        const pollStart = Date.now();
        let confirmed = false;
        while (Date.now() - pollStart < 90_000) {
          await new Promise(r => setTimeout(r, 5_000));
          try {
            const checkRes = await tokenContract.allowance(senderAddr as any, poolAddr);
            if (!(checkRes as CallResult).revert) {
              const props = (checkRes as CallResult).properties as Record<string, unknown>;
              const cur = props?.remaining ? BigInt(String(props.remaining)) : 0n;
              if (cur >= rawAmount) { confirmed = true; break; }
            }
          } catch { /* retry */ }
          setSwapStep(`Waiting for approval confirmation... (${Math.round((Date.now() - pollStart) / 1000)}s)`);
        }
        if (!confirmed) throw new Error('Approval timeout — try swapping again in ~1 min.');
      }

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
    background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: '14px',
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
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Slippage Tolerance</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }} style={{
                    flex: 1, padding: '6px', borderRadius: '14px',
                    background: slippage === s ? 'rgba(247,147,26,.08)' : 'rgba(255,255,255,.04)',
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
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
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
                background: fromVal > 0 && hasPool ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'rgba(30,30,50,.8)',
                border: 'none', borderRadius: '14px',
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
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', borderRadius: '14px',
              color: '#fff', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', fontFamily: 'var(--ff)'
            }}>Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px',
              background: swapResult.type === 'error' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
              border: `1px solid ${swapResult.type === 'error' ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.15)'}`,
              borderRadius: '14px', fontSize: '.72rem' }}>
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

        {/* Mint tokens */}
        <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: '.52rem', color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Mint Testnet Tokens</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(TESTNET_CONTRACTS).map(([sym]) => (
              <button key={sym} onClick={() => mintTokens(sym)} disabled={minting === sym}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: minting === sym ? 'wait' : 'pointer',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff',
                  fontSize: '.68rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", opacity: minting === sym ? .5 : 1,
                }}>
                {minting === sym ? '...' : `1K ${sym}`}
              </button>
            ))}
          </div>
          {mintResult && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, fontSize: '.65rem', wordBreak: 'break-all',
              background: mintResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
              color: mintResult.ok ? '#10b981' : '#ef4444' }}>
              {mintResult.msg}
            </div>
          )}
        </div>

        {/* Pool reserves + LP position compact */}
        <div style={{ marginTop: 10, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem' }}>
            <span style={{ color: '#4a5568' }}>Pool</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 600 }}>
              {reserveA.toLocaleString()} / {reserveB.toLocaleString()}
            </span>
          </div>
          {lpUserMine > 0 && reserveA > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
              <span style={{ color: '#4a5568' }}>Your LP</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#0ea5e9', fontWeight: 700 }}>
                {((lpUserMine / reserveA) * 100).toFixed(2)}%
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.58rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
            <span style={{ color: '#2d3548' }}>{poolReady ? 'Live' : 'Deploying...'}</span>
            <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
              style={{ color: '#4a5568', textDecoration: 'none' }}>OPScan ↗</a>
          </div>
        </div>

        {/* Recent tx — compact */}
        {history.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {history.slice(0, 5).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.65rem' }}>
                <span style={{ color: '#7a8494', fontWeight: 600 }}>
                  {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `+${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                </span>
                <span style={{ color: '#2d3548', fontSize: '.55rem' }}>{formatTimeAgo(tx.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SwapUI;
