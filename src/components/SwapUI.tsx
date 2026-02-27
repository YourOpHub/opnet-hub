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
    maximumAllowedSatToSpend: 100_000n,
    network: NETWORK,
    feeRate,
    priorityFee,
  } as any;
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
  const [lpUserMine, setLpUserMine] = useState(0);
  const [lpUserVibe, setLpUserVibe] = useState(0);
  const [lpTab, setLpTab] = useState<'add' | 'info'>('add');

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

      // Fetch real gas parameters from the network
      setSwapStep('Fetching gas parameters...');
      const txParams = await buildTxParams(provider, walletAddress!);

      // STEP 1: Approve pool to spend token-in
      setSwapStep('Approving token spend...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenContract = getContract<IOP20Contract>(
        from.address, OP_20_ABI, provider, NETWORK, senderAddr as any,
      );
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;
      const approveSim = await tokenContract.increaseAllowance(poolAddr, rawAmount);

      if (approveSim.revert) {
        throw new Error(`Approval simulation reverted: ${approveSim.revert}`);
      }

      const approveReceipt = await approveSim.sendTransaction(txParams);
      console.log('[Swap] Approve TX:', approveReceipt.transactionId);

      // Wait for approval to propagate on-chain (needs block confirmation)
      setSwapStep('Waiting for approval confirmation (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // STEP 2: Call swap on pool
      setSwapStep('Executing swap on pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(
        POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any,
      ) as unknown as IPoolContract;
      const tokenInAddr = Address.fromString(from.pubkey);
      const swapSim = await poolContract.swap(tokenInAddr, rawAmount, minOut);

      if ((swapSim as CallResult).revert) {
        throw new Error(`Swap simulation reverted: ${(swapSim as CallResult).revert}`);
      }

      const swapReceipt = await (swapSim as CallResult).sendTransaction(txParams);
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
      if (msg.toLowerCase().includes('no utxo')) {
        msg = 'Your wallet has no BTC UTXOs. Get testnet BTC first: https://faucet.opnet.org';
      }
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
      const sim = await contract.publicMint(rawAmount);
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
      const txParams = await buildTxParams(provider, walletAddress);
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;

      // 1. Transfer MINE to pool
      setLpStep('Transferring MINE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mineContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.MINE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const mineRaw = BitcoinUtils.expandToDecimals(mineAmt, 8);
      const mineSim = await mineContract.transfer(poolAddr, mineRaw);
      if (mineSim.revert) throw new Error(`MINE transfer failed: ${mineSim.revert}`);
      const mineReceipt = await mineSim.sendTransaction(txParams);
      console.log('[LP] MINE transfer TX:', mineReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for MINE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 2. Transfer VIBE to pool
      setLpStep('Transferring VIBE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vibeContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.VIBE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const vibeRaw = BitcoinUtils.expandToDecimals(vibeAmt, 8);
      const vibeSim = await vibeContract.transfer(poolAddr, vibeRaw);
      if (vibeSim.revert) throw new Error(`VIBE transfer failed: ${vibeSim.revert}`);
      const vibeReceipt = await vibeSim.sendTransaction(txParams);
      console.log('[LP] VIBE transfer TX:', vibeReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for VIBE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 3. Call sync() on pool
      setLpStep('Syncing pool reserves...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any);
      const syncSim = await poolContract.sync();
      if ((syncSim as CallResult).revert) throw new Error(`Sync failed: ${(syncSim as CallResult).revert}`);
      const syncReceipt = await (syncSim as CallResult).sendTransaction(txParams);

      setLpStep('');
      setLpResult({ ok: true, msg: `Liquidity added! ${mineAmt} MINE + ${vibeAmt} VIBE. Sync TX: ${syncReceipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: syncReceipt.transactionId || '', tokenA: 'LP', amountA: `${mineAmt}+${vibeAmt}`, status: 'confirmed', wallet: walletAddress });
      setLpUserMine(prev => prev + mineAmt);
      setLpUserVibe(prev => prev + vibeAmt);
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
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🔄 Token Swap</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Swap MINE ↔ VIBE on Bitcoin L1. {connected ? 'Real on-chain OP-20 transfer via your wallet.' : 'Connect wallet for real transactions.'}
        </div>
      </div>

      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="P" style={{ padding: 20, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="Lb" style={{ marginBottom: 0 }}>Swap</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {connected && <span style={{ fontSize: '.55rem', background: 'var(--gG)', color: 'var(--g)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>LIVE</span>}
              <button onClick={() => setShowSettings(!showSettings)} style={{
                background: 'none', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
                color: 'var(--t3)', padding: '4px 10px', fontSize: '.7rem', cursor: 'pointer', fontFamily: 'var(--ff)'
              }}>⚙️ {slippage}%</button>
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

          {/* From */}
          <div style={{ padding: '14px', background: 'rgba(255,255,255,.03)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>From</span>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Balance: {fmtBal(fromBal, from.decimals)}</span>
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
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 2 }}>
            <button onClick={flip} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--o), var(--o2))',
              border: '3px solid var(--bg2)', color: '#000', fontSize: '1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .2s', fontWeight: 700
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div style={{ padding: '14px', background: 'rgba(255,255,255,.03)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>To (estimated)</span>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Balance: {fmtBal(toBal, to.decimals)}</span>
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
        <div className="P" style={{ marginTop: 14, padding: 14, border: '1px solid rgba(247,147,26,.15)', background: 'rgba(247,147,26,.03)' }}>
          <div className="Lb" style={{ marginBottom: 8, color: 'var(--o)' }}>Live Contracts — OPNet Testnet</div>
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
        <div className="P" style={{ marginTop: 14, padding: 16, fontSize: '.75rem', color: 'var(--t3)', lineHeight: 1.5 }}>
          <div className="Lb">Liquidity Pool (SimplePool AMM)</div>
          <p>Constant-product AMM (x·y=k) for MINE/VIBE with 0.3% fee. Swap executes <strong>real on-chain transactions</strong>: approve + swap via the pool contract.</p>
          {poolReady && (
            <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--gG)', border: '1px solid var(--gB)', borderRadius: 8, fontSize: '.62rem' }}>
              <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 2 }}>Pool Contract Live</div>
              <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.52rem' }}>{POOL_ADDRESS}</div>
              <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--c2)', fontSize: '.55rem' }}>View on OPScan ↗</a>
            </div>
          )}
          {!poolReady && (
            <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.2)', borderRadius: 8, fontSize: '.62rem', color: 'var(--y)' }}>
              Pool contract deployment in progress...
            </div>
          )}
          <div style={{ marginTop: 10, padding: '10px', background: 'var(--bg3)', borderRadius: 'var(--rad)', fontSize: '.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>MINE Reserve</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>{reserveA.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>VIBE Reserve</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>{reserveB.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rate</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--o)' }}>1 MINE = {(reserveB / reserveA).toFixed(1)} VIBE</span>
            </div>
          </div>
          {btcPrice > 0 && <div style={{ marginTop: 6, fontSize: '.6rem', color: 'var(--t4)' }}>BTC: ${btcPrice.toLocaleString()}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="https://opscan.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>OPScan Explorer →</a>
            <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>Docs →</a>
          </div>
        </div>

        {/* Add Liquidity */}
        <div className="P" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
          {/* LP Header with tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)' }}>
            <button onClick={() => { setShowLiquidity(true); setLpTab('add'); }}
              style={{
                flex: 1, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: 'var(--ff)',
                background: showLiquidity && lpTab === 'add' ? 'rgba(14,165,233,.08)' : 'transparent',
                color: showLiquidity && lpTab === 'add' ? '#0ea5e9' : 'var(--t3)',
                fontWeight: 700, fontSize: '.78rem', borderBottom: showLiquidity && lpTab === 'add' ? '2px solid #0ea5e9' : '2px solid transparent',
              }}>💧 Add Liquidity</button>
            <button onClick={() => { setShowLiquidity(true); setLpTab('info'); }}
              style={{
                flex: 1, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: 'var(--ff)',
                background: showLiquidity && lpTab === 'info' ? 'rgba(168,85,247,.08)' : 'transparent',
                color: showLiquidity && lpTab === 'info' ? 'var(--p)' : 'var(--t3)',
                fontWeight: 700, fontSize: '.78rem', borderBottom: showLiquidity && lpTab === 'info' ? '2px solid var(--p)' : '2px solid transparent',
              }}>📊 Pool Share</button>
            {showLiquidity && (
              <button onClick={() => setShowLiquidity(false)}
                style={{ padding: '12px 14px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--t4)', fontSize: '.8rem' }}>✕</button>
            )}
          </div>

          {showLiquidity && lpTab === 'add' && (
            <div style={{ padding: 16 }}>
              {/* User balances */}
              {connected && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <div style={{ flex: 1, padding: '10px 12px', background: 'rgba(247,147,26,.05)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginBottom: 2 }}>⛏️ MINE Balance</div>
                    <div style={{ fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)', fontSize: '.85rem' }}>
                      {balLoading ? '...' : fmtBal(balances['MINE'], 8)}
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: '10px 12px', background: 'rgba(14,165,233,.05)', border: '1px solid rgba(14,165,233,.12)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginBottom: 2 }}>⚡ VIBE Balance</div>
                    <div style={{ fontWeight: 700, color: '#0ea5e9', fontFamily: 'var(--fm)', fontSize: '.85rem' }}>
                      {balLoading ? '...' : fmtBal(balances['VIBE'], 8)}
                    </div>
                  </div>
                </div>
              )}

              {/* Pool ratio info */}
              <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, marginBottom: 12, fontSize: '.68rem', color: 'var(--t3)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Current ratio:</span>
                <span style={{ fontWeight: 600, color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                  {reserveA > 0 ? `1 MINE = ${(reserveB / reserveA).toFixed(2)} VIBE` : '...'}
                </span>
              </div>

              {/* MINE input */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>⛏️ MINE Amount</span>
                  {connected && balances['MINE'] != null && balances['MINE'] > 0n && (
                    <button onClick={() => setLpMineAmt((Number(balances['MINE']) / 1e8).toString())}
                      style={{ fontSize: '.55rem', color: 'var(--o)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'var(--ff)' }}>MAX</button>
                  )}
                </div>
                <input type="number" value={lpMineAmt} onChange={e => setLpMineAmt(e.target.value)}
                  placeholder="0.0" style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--bd)',
                    background: 'var(--bg3)', color: 'var(--w)', fontSize: '.9rem', fontFamily: 'var(--fm)',
                    outline: 'none', boxSizing: 'border-box',
                  }} />
              </div>

              {/* Plus icon */}
              <div style={{ textAlign: 'center', margin: '4px 0', color: 'var(--t4)', fontSize: '1rem' }}>+</div>

              {/* VIBE input (auto) */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 4 }}>⚡ VIBE Amount (auto-calculated)</div>
                <input type="number" value={lpVibeAmt} readOnly
                  style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--bd)',
                    background: 'rgba(255,255,255,.02)', color: 'var(--t2)', fontSize: '.9rem', fontFamily: 'var(--fm)',
                    outline: 'none', boxSizing: 'border-box',
                  }} />
              </div>

              {/* Estimated pool share after adding */}
              {parseFloat(lpMineAmt) > 0 && reserveA > 0 && (
                <div style={{ padding: '10px 12px', background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.12)', borderRadius: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', marginBottom: 4 }}>
                    <span style={{ color: 'var(--t3)' }}>Your share of pool</span>
                    <span style={{ fontWeight: 700, color: '#0ea5e9', fontFamily: 'var(--fm)' }}>
                      {((parseFloat(lpMineAmt) / (reserveA + parseFloat(lpMineAmt))) * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.62rem' }}>
                    <span style={{ color: 'var(--t4)' }}>New MINE reserve</span>
                    <span style={{ color: 'var(--t3)', fontFamily: 'var(--fm)' }}>{(reserveA + parseFloat(lpMineAmt)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.62rem' }}>
                    <span style={{ color: 'var(--t4)' }}>New VIBE reserve</span>
                    <span style={{ color: 'var(--t3)', fontFamily: 'var(--fm)' }}>{(reserveB + parseFloat(lpVibeAmt || '0')).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              )}

              {/* Add Liquidity button */}
              {connected ? (
                <button onClick={addLiquidity} disabled={addingLP || !lpMineAmt}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: addingLP ? 'var(--bg4)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                    color: '#fff', fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
                    opacity: addingLP || !lpMineAmt ? 0.6 : 1, transition: 'all .2s',
                    boxShadow: !addingLP && lpMineAmt ? '0 4px 16px rgba(14,165,233,.25)' : 'none',
                  }}>
                  {addingLP ? (lpStep || 'Processing...') : '💧 Add Liquidity'}
                </button>
              ) : (
                <button onClick={openConnectModal} style={{
                  width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff',
                  fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
                }}>Connect Wallet</button>
              )}

              {lpResult && (
                <div style={{
                  marginTop: 10, padding: '10px 12px', borderRadius: 8,
                  background: lpResult.ok ? 'var(--gG)' : 'rgba(239,68,68,.06)',
                  border: `1px solid ${lpResult.ok ? 'var(--gB)' : 'rgba(239,68,68,.2)'}`,
                  fontSize: '.7rem', color: lpResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
                }}>
                  {lpResult.msg}
                </div>
              )}

              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: '.56rem', color: 'var(--t4)', lineHeight: 1.5 }}>
                Adds liquidity via 3 on-chain TXs: MINE transfer → VIBE transfer → sync(). Amounts auto-balanced to pool ratio.
              </div>
            </div>
          )}

          {showLiquidity && lpTab === 'info' && (
            <div style={{ padding: 16 }}>
              <div className="Lb" style={{ marginBottom: 10 }}>Your Pool Position</div>

              {/* User's LP position */}
              {lpUserMine > 0 || lpUserVibe > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <div style={{ padding: 12, background: 'rgba(247,147,26,.05)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginBottom: 2 }}>Your MINE in Pool</div>
                    <div style={{ fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)', fontSize: '.9rem' }}>{lpUserMine.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: 12, background: 'rgba(14,165,233,.05)', border: '1px solid rgba(14,165,233,.12)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginBottom: 2 }}>Your VIBE in Pool</div>
                    <div style={{ fontWeight: 700, color: '#0ea5e9', fontFamily: 'var(--fm)', fontSize: '.9rem' }}>{lpUserVibe.toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--t4)', fontSize: '.72rem', marginBottom: 14 }}>
                  No liquidity added yet. Add MINE + VIBE to earn LP fees.
                </div>
              )}

              {/* Pool share percentage */}
              {lpUserMine > 0 && reserveA > 0 && (
                <div style={{ padding: '14px', background: 'linear-gradient(135deg, rgba(14,165,233,.08), rgba(168,85,247,.08))', border: '1px solid rgba(14,165,233,.15)', borderRadius: 10, textAlign: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: '.6rem', color: 'var(--t3)', marginBottom: 4 }}>Your Pool Share</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0ea5e9', fontFamily: 'var(--fm)' }}>
                    {((lpUserMine / reserveA) * 100).toFixed(2)}%
                  </div>
                  <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginTop: 2 }}>of total MINE/VIBE pool</div>
                </div>
              )}

              {/* Current pool stats */}
              <div style={{ padding: '12px', background: 'var(--bg3)', borderRadius: 8 }}>
                <div style={{ fontSize: '.65rem', fontWeight: 600, color: 'var(--t2)', marginBottom: 8 }}>Current Pool Reserves</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--t3)' }}>⛏️ MINE</span>
                  <span style={{ fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)' }}>{reserveA.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--t3)' }}>⚡ VIBE</span>
                  <span style={{ fontWeight: 700, color: '#0ea5e9', fontFamily: 'var(--fm)' }}>{reserveB.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--t3)' }}>Rate</span>
                  <span style={{ fontWeight: 600, color: 'var(--o)', fontFamily: 'var(--fm)' }}>1 MINE = {reserveA > 0 ? (reserveB / reserveA).toFixed(2) : '—'} VIBE</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem' }}>
                  <span style={{ color: 'var(--t3)' }}>Fee</span>
                  <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>0.3%</span>
                </div>
              </div>

              <button onClick={() => fetchReserves()} style={{
                width: '100%', padding: '10px', marginTop: 10, borderRadius: 8,
                border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)',
                fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--ff)',
              }}>🔄 Refresh Pool Data</button>
            </div>
          )}
        </div>

        {/* Transaction History */}
        {history.length > 0 && (
          <div className="P" style={{ marginTop: 14, padding: 16 }}>
            <div className="Lb">Transaction History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.slice(0, 10).map(tx => (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: '.72rem' }}>
                  <span style={{ fontSize: '.9rem', width: 22, textAlign: 'center' }}>{tx.type === 'swap' ? '🔄' : '🎁'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--w)' }}>
                      {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `Claimed ${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                    </div>
                    <div style={{ fontSize: '.58rem', color: 'var(--t4)' }}>{formatTimeAgo(tx.ts)}</div>
                  </div>
                  {tx.txHash && (
                    <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.56rem', color: 'var(--c2)', textDecoration: 'none', whiteSpace: 'nowrap' }}>TX ↗</a>
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
