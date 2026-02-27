import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes,
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
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{sym: string; ok: boolean; msg: string} | null>(null);
  const [tokenSupplies, setTokenSupplies] = useState<Record<string, bigint>>({});
  const [reserveA, setReserveA] = useState(INIT_RESERVE_A);
  const [reserveB, setReserveB] = useState(INIT_RESERVE_B);
  const [history, setHistory] = useState<TxRecord[]>([]);

  useEffect(() => {
    if (walletAddress) setHistory(getTxHistory(walletAddress).filter(r => r.type === 'swap' || r.type === 'claim'));
  }, [walletAddress, balRefreshKey]);

  const poolReady = !!POOL_ADDRESS;

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
      const rawAmount = BigInt(Math.floor(fromVal * Math.pow(10, from.decimals)));
      const minOut = BigInt(Math.floor(toVal * (1 - slippage / 100) * Math.pow(10, to.decimals)));

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

  /** Claim tokens via VPS faucet (transfers from deployer wallet) */
  const claimTokens = useCallback(async (sym: string) => {
    if (!walletAddress) { openConnectModal(); return; }
    setClaiming(sym);
    setClaimResult(null);
    try {
      const res = await fetch(`${FAUCET_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: sym, address: walletAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      setClaimResult({ sym, ok: true, msg: data.message || `Claimed ${sym}!` });
      addTxRecord({ type: 'claim', txHash: '', tokenA: sym, amountA: sym === 'MINE' ? '100000' : '500000', status: 'confirmed', wallet: walletAddress! });
      setTimeout(() => setBalRefreshKey(k => k + 1), 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Claim failed';
      setClaimResult({ sym, ok: false, msg });
    } finally {
      setClaiming(null);
    }
  }, [walletAddress, openConnectModal]);

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
                  <button onClick={() => claimTokens(sym)} disabled={claiming === sym}
                    style={{
                      padding: '4px 10px', borderRadius: 6, border: 'none', cursor: claiming === sym ? 'wait' : 'pointer',
                      background: 'linear-gradient(135deg, var(--o), var(--o2))', color: '#000',
                      fontSize: '.58rem', fontWeight: 700, fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                    }}>
                    {claiming === sym ? 'Claiming...' : `Get ${sym}`}
                  </button>
                  <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '.54rem', color: 'var(--c2)', whiteSpace: 'nowrap', textDecoration: 'none' }}>OPScan ↗</a>
                </div>
              </div>
            );
          })}
          {claimResult && (
            <div style={{ marginTop: 8, padding: '8px 12px',
              background: claimResult.ok ? 'var(--gG)' : 'rgba(239,68,68,.06)',
              border: `1px solid ${claimResult.ok ? 'var(--gB)' : 'rgba(239,68,68,.2)'}`,
              borderRadius: 'var(--rad)', fontSize: '.7rem',
              color: claimResult.ok ? 'var(--g)' : '#ef4444' }}>
              {claimResult.msg}
            </div>
          )}
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.15)', borderRadius: 'var(--rad)', fontSize: '.62rem', color: 'var(--t3)' }}>
            Click <strong>Get</strong> to receive free tokens from our faucet. 5 min cooldown per token.
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
