import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address } from '@btc-vision/transaction';
import {
  JSONRpcProvider, getContract, OP_20_ABI, BitcoinUtils,
  type IOP20Contract, type CallResult, type BaseContractProperties,
} from 'opnet';
import { POOL_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { ensureAllowance, buildTxParams, withRetry, formatTxError, waitForNextBlock } from '../txUtils';
import * as opnetRpc from '../opnet';
import { addTxRecord } from '../txHistory';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS, POOL_PUBKEY, NATIVESWAP_ADDRESS, getContractOpscanUrl } from '../contracts';
import { fetchAllTokens, type IndexedToken } from '../tokenApi';
import { useOps } from '../contexts/OpsContext';



/** Typed interface for SimplePool contract */
interface IPoolContract extends BaseContractProperties {
  getReserves(): Promise<CallResult>;
  sync(): Promise<CallResult>;
  addLiquidity(amountA: bigint, amountB: bigint): Promise<CallResult>;
  removeLiquidity(amountA: bigint, amountB: bigint): Promise<CallResult>;
  liquidityOf(account: unknown): Promise<CallResult>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  reserveA: number;
  reserveB: number;
  balances: Record<string, bigint>;
  onRefresh: () => void;
}

type PoolType = 'simplepool' | 'nativeswap' | 'custom';

const LiquidityModal: React.FC<Props> = ({ open, onClose, reserveA, reserveB, balances, onRefresh }) => {
  const { walletAddress, walletInstance, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp, failOp } = useOps();

  const [poolType, setPoolType] = useState<PoolType>('simplepool');
  const [tab, setTab] = useState<'add' | 'remove'>('add');
  const [mineAmt, setMineAmt] = useState('');
  const [vibeAmt, setVibeAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [allTokens, setAllTokens] = useState<IndexedToken[]>([]);

  const [lpMine, setLpMine] = useState(0);
  const [lpVibe, setLpVibe] = useState(0);

  // Fetch token list from indexer
  useEffect(() => {
    if (!open) return;
    fetchAllTokens().then(tokens => {
      if (tokens.length > 0) setAllTokens(tokens);
    }).catch(() => {});
  }, [open]);

  const hasLP = lpMine > 0 || lpVibe > 0;
  const poolShare = reserveA > 0 ? (lpMine / reserveA) * 100 : 0;
  const ratio = reserveA > 0 ? reserveB / reserveA : 0;

  // Query on-chain LP position when modal opens
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setStep('');
    setMineAmt('');
    setVibeAmt('');
    if (!senderAddr) return;
    (async () => {
      try {
        const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);
        const res = await withRetry(() => poolContract.liquidityOf(senderAddr)) as CallResult;
        if (!res.revert && res.properties) {
          const props = res.properties as Record<string, unknown>;
          const a = Number(props.amountA ?? 0n) / 1e8;
          const b = Number(props.amountB ?? 0n) / 1e8;
          setLpMine(a);
          setLpVibe(b);
        }
      } catch (e) { console.warn('[LiquidityModal] LP position fetch failed:', e); }
    })();
  }, [open, senderAddr, provider]);

  // Auto-calculate VIBE based on pool ratio (add) or LP position ratio (remove)
  useEffect(() => {
    const m = parseFloat(mineAmt);
    if (tab === 'add' && m > 0 && ratio > 0) {
      setVibeAmt((m * ratio).toFixed(2));
    } else if (tab === 'remove' && m > 0 && lpMine > 0 && lpVibe > 0) {
      setVibeAmt(((m / lpMine) * lpVibe).toFixed(2));
    }
  }, [mineAmt, ratio, tab, lpMine, lpVibe]);

  // Reset on tab change
  useEffect(() => {
    setResult(null);
    setStep('');
    if (tab === 'add') { setMineAmt(''); setVibeAmt(''); }
  }, [tab]);

  const addLiquidity = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const mAmt = parseFloat(mineAmt);
    const vAmt = parseFloat(vibeAmt);
    if (!mAmt || !vAmt || mAmt <= 0 || vAmt <= 0) { setResult({ ok: false, msg: 'Enter both amounts' }); return; }
    if (!senderAddr) { setResult({ ok: false, msg: 'Wallet key not available' }); return; }

    setBusy(true);
    setResult(null);
    try {
      const mineRaw = BitcoinUtils.expandToDecimals(mAmt, 8);
      const vibeRaw = BitcoinUtils.expandToDecimals(vAmt, 8);

      // Step 1: Ensure MINE allowance (check → approve → wait for block)
      const mineApproved = await ensureAllowance(
        DEPLOYED_CONTRACTS.MINE.address, POOL_PUBKEY, mineRaw,
        provider, senderAddr!, walletAddress!, setStep, 'MINE',
      );

      // Step 2: Ensure VIBE allowance (if MINE needed approval, UTXOs changed — wait for block)
      if (mineApproved) await waitForNextBlock(provider, setStep);
      const vibeApproved = await ensureAllowance(
        DEPLOYED_CONTRACTS.VIBE.address, POOL_PUBKEY, vibeRaw,
        provider, senderAddr!, walletAddress!, setStep, 'VIBE',
      );
      if (vibeApproved) await waitForNextBlock(provider, setStep);

      // Step 3: addLiquidity on pool
      setStep('Adding liquidity to pool...');
      const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);
      const addSim = await withRetry(() => poolContract.addLiquidity(mineRaw, vibeRaw));
      if ((addSim as CallResult).revert) throw new Error(`addLiquidity failed: ${(addSim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress!);
      const aOpId = `lp_add_${Date.now()}`;
      trackOp({ id: aOpId, market: 'liquidity', orderId: 'Add LP', direction: '', role: '', step: `Adding ${mAmt} MINE + ${vAmt} VIBE...` });
      const addReceipt = await (addSim as CallResult).sendTransaction(tp);
      completeOp(aOpId);

      setStep('');
      setResult({ ok: true, msg: `Added ${mAmt.toLocaleString()} MINE + ${vAmt.toLocaleString()} VIBE on-chain!` });
      setLpMine(prev => prev + mAmt);
      setLpVibe(prev => prev + vAmt);
      addTxRecord({ type: 'mint', txHash: addReceipt.transactionId || '', tokenA: 'LP', amountA: `${mAmt}+${vAmt}`, status: 'confirmed', wallet: walletAddress });
      setTimeout(onRefresh, 3000);
    } catch (e) {
      setStep('');
      setResult({ ok: false, msg: formatTxError(e) });
    } finally { setBusy(false); }
  }, [walletAddress, walletInstance, mineAmt, vibeAmt, provider, senderAddr, openConnectModal, onRefresh]);

  const removeLiquidity = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!senderAddr) { setResult({ ok: false, msg: 'Wallet key not available' }); return; }
    const m = parseFloat(mineAmt) || lpMine;
    const v = parseFloat(vibeAmt) || lpVibe;
    if (m <= 0 && v <= 0) { setResult({ ok: false, msg: 'Enter the amounts to remove' }); return; }

    setBusy(true);
    setResult(null);
    try {
      const mineRaw = BitcoinUtils.expandToDecimals(m, 8);
      const vibeRaw = BitcoinUtils.expandToDecimals(v, 8);
      const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);

      setStep('Removing liquidity from pool...');
      const removeSim = await withRetry(() => poolContract.removeLiquidity(mineRaw, vibeRaw));
      if ((removeSim as CallResult).revert) throw new Error(`removeLiquidity failed: ${(removeSim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      const rOpId = `lp_rm_${Date.now()}`;
      trackOp({ id: rOpId, market: 'liquidity', orderId: 'Remove LP', direction: '', role: '', step: `Removing ${m} MINE + ${v} VIBE...` });
      const receipt = await (removeSim as CallResult).sendTransaction(tp);
      completeOp(rOpId);

      setStep('');
      setLpMine(prev => Math.max(0, prev - m));
      setLpVibe(prev => Math.max(0, prev - v));
      setMineAmt('');
      setVibeAmt('');
      setResult({ ok: true, msg: `Removed ${m.toLocaleString()} MINE + ${v.toLocaleString()} VIBE. Tokens returned to your wallet!` });
      addTxRecord({ type: 'claim', txHash: receipt.transactionId || '', tokenA: 'LP', amountA: `${m}+${v}`, status: 'confirmed', wallet: walletAddress });
      setTimeout(onRefresh, 3000);
    } catch (e) {
      setStep('');
      setResult({ ok: false, msg: formatTxError(e) });
    } finally { setBusy(false); }
  }, [walletAddress, walletInstance, mineAmt, vibeAmt, lpMine, lpVibe, provider, senderAddr, openConnectModal, onRefresh]);

  if (!open) return null;

  const connected = !!walletAddress;
  const mineBal = balances['MINE'];
  const vibeBal = balances['VIBE'];
  const fmtBal = (b: bigint | undefined) => b != null ? (Number(b) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(6px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: '100%', maxWidth: 420, maxHeight: '90vh', overflow: 'auto',
        background: 'rgba(10,10,18,.95)', border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 22, padding: '24px 22px',
        boxShadow: '0 24px 64px rgba(0,0,0,.6)', backdropFilter: 'blur(24px)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontWeight: 800, fontSize: '.95rem', color: '#fff', letterSpacing: '-.02em' }}>Liquidity</span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, color: '#5a6578', fontSize: '.9rem',
            cursor: 'pointer', padding: '4px 10px', lineHeight: 1, transition: 'all .2s',
          }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: 'rgba(255,255,255,.03)', borderRadius: 12, padding: 3 }}>
          {(['add', 'remove'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: tab === t ? (t === 'add' ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' : 'linear-gradient(135deg, #ef4444, #dc2626)') : 'transparent',
              color: tab === t ? '#fff' : '#5a6578', fontWeight: 700, fontSize: '.78rem',
              fontFamily: 'var(--ff)', transition: 'all .2s',
            }}>
              {t === 'add' ? '+ Add' : '− Remove'}
            </button>
          ))}
        </div>

        {/* Pool Selector */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '.52rem', color: '#5a6578', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Pool</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setPoolType('simplepool')} style={{
              flex: 1, padding: '8px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: poolType === 'simplepool' ? 'rgba(14,165,233,.12)' : 'rgba(255,255,255,.03)',
              color: poolType === 'simplepool' ? '#0ea5e9' : '#5a6578', fontWeight: 700, fontSize: '.65rem',
              fontFamily: 'var(--ff)', transition: 'all .2s',
              outline: poolType === 'simplepool' ? '1px solid rgba(14,165,233,.3)' : 'none',
            }}>
              MINE/VIBE
            </button>
            <button onClick={() => setPoolType('nativeswap')} style={{
              flex: 1, padding: '8px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: poolType === 'nativeswap' ? 'rgba(247,147,26,.12)' : 'rgba(255,255,255,.03)',
              color: poolType === 'nativeswap' ? '#F7931A' : '#5a6578', fontWeight: 700, fontSize: '.65rem',
              fontFamily: 'var(--ff)', transition: 'all .2s',
              outline: poolType === 'nativeswap' ? '1px solid rgba(247,147,26,.3)' : 'none',
            }}>
              BTC/Token
            </button>
          </div>
        </div>

        {/* NativeSwap info — uses existing deployed NativeSwap contract */}
        {poolType === 'nativeswap' && (
          <div style={{
            padding: '14px', background: 'rgba(247,147,26,.04)', borderRadius: 14,
            border: '1px solid rgba(247,147,26,.1)', marginBottom: 16,
          }}>
            {NATIVESWAP_ADDRESS ? (<>
              <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#F7931A', marginBottom: 8 }}>NativeSwap BTC/Token Pool</div>
              <div style={{ fontSize: '.62rem', color: '#8b95a9', lineHeight: 1.6, marginBottom: 10 }}>
                This pool uses the deployed NativeSwap v5 contract for BTC/Token swaps.
                Use the <strong style={{ color: '#0ea5e9' }}>Swap</strong> tab to trade BTC for tokens.
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '.5rem', color: '#5a6578', wordBreak: 'break-all', marginBottom: 10 }}>
                {NATIVESWAP_ADDRESS}
              </div>
              <a href={getContractOpscanUrl(NATIVESWAP_ADDRESS)} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '.6rem', color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}>
                View on OPScan ↗
              </a>
            </>) : (
              <div style={{ fontSize: '.65rem', color: '#f59e0b' }}>
                NativeSwap contract not yet deployed.
              </div>
            )}
          </div>
        )}

        {/* Pool Info (SimplePool) */}
        {poolType === 'simplepool' && <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,.025)', borderRadius: 14, border: '1px solid rgba(255,255,255,.05)', marginBottom: 16, fontSize: '.68rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: hasLP ? 8 : 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '.48rem', color: '#5a6578', marginBottom: 3, fontWeight: 600 }}>MINE</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 700, fontSize: '.72rem' }}>{reserveA.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '.48rem', color: '#5a6578', marginBottom: 3, fontWeight: 600 }}>VIBE</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 700, fontSize: '.72rem' }}>{reserveB.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '.48rem', color: '#5a6578', marginBottom: 3, fontWeight: 600 }}>RATE</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: '#F7931A', fontWeight: 700, fontSize: '.72rem' }}>1:{ratio.toFixed(1)}</div>
            </div>
          </div>
          {hasLP && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              <span style={{ color: '#5a6578', fontSize: '.6rem' }}>Your Share</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#0ea5e9', fontWeight: 700, fontSize: '.72rem' }}>{poolShare.toFixed(2)}%</span>
            </div>
          )}
        </div>}

        {/* ADD TAB (SimplePool only for now) */}
        {poolType === 'simplepool' && tab === 'add' && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '.58rem', color: '#5a6578', fontWeight: 500 }}>MINE</span>
                <span style={{ fontSize: '.55rem', color: '#3d4555' }}>Balance: {fmtBal(mineBal)}</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input type="number" value={mineAmt} onChange={e => setMineAmt(e.target.value)}
                  placeholder="0.0" style={{
                    width: '100%', padding: '14px 70px 14px 14px', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: '#fff',
                    fontSize: '.9rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none', boxSizing: 'border-box',
                  }} />
                {mineBal != null && mineBal > 0n && (
                  <button onClick={() => setMineAmt((Number(mineBal) / 1e8).toString())} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(247,147,26,.2)',
                    background: 'rgba(247,147,26,.08)', color: '#F7931A', cursor: 'pointer',
                    fontSize: '.6rem', fontWeight: 700, fontFamily: 'var(--ff)',
                  }}>MAX</button>
                )}
              </div>
            </div>

            <div style={{ textAlign: 'center', color: '#3d4555', fontSize: '.85rem', margin: '4px 0', fontWeight: 700 }}>+</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '.58rem', color: '#5a6578', fontWeight: 500 }}>VIBE (auto)</span>
                <span style={{ fontSize: '.55rem', color: '#3d4555' }}>Balance: {fmtBal(vibeBal)}</span>
              </div>
              <input type="number" value={vibeAmt} readOnly style={{
                width: '100%', padding: '14px', borderRadius: 14,
                border: '1px solid rgba(255,255,255,.04)', background: 'rgba(255,255,255,.015)', color: '#8b95a9',
                fontSize: '.9rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>

            {parseFloat(mineAmt) > 0 && reserveA > 0 && (
              <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, marginBottom: 12, fontSize: '.65rem', color: 'var(--t3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>New pool share</span>
                  <span style={{ color: '#0ea5e9', fontWeight: 700, fontFamily: 'var(--fm)' }}>
                    {((parseFloat(mineAmt) + lpMine) / (reserveA + parseFloat(mineAmt)) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {connected ? (
              <button onClick={addLiquidity} disabled={busy || !mineAmt} style={{
                width: '100%', padding: '15px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: busy ? 'rgba(30,30,50,.8)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                color: '#fff', fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--ff)',
                opacity: busy || !mineAmt ? 0.5 : 1, transition: 'all .2s',
                boxShadow: !busy && mineAmt ? '0 4px 16px rgba(14,165,233,.2)' : 'none',
              }}>
                {busy ? (step || 'Processing...') : 'Add Liquidity'}
              </button>
            ) : (
              <button onClick={openConnectModal} style={{
                width: '100%', padding: '15px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff',
                fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--ff)',
                boxShadow: '0 4px 16px rgba(14,165,233,.2)',
              }}>Connect Wallet</button>
            )}
          </div>
        )}

        {/* REMOVE TAB (SimplePool only for now) */}
        {poolType === 'simplepool' && tab === 'remove' && (
          <div>
            {/* Position summary if tracked in localStorage */}
            {hasLP && (
              <div style={{ padding: '12px 14px', background: 'rgba(14,165,233,.04)', borderRadius: 14, border: '1px solid rgba(14,165,233,.1)', marginBottom: 12 }}>
                <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Detected Position</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '.72rem', color: '#8b95a9' }}>MINE</span>
                  <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>{lpMine.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '.72rem', color: '#8b95a9' }}>VIBE</span>
                  <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>{lpVibe.toLocaleString()}</span>
                </div>
                {poolShare > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 6, marginTop: 4 }}>
                    <span style={{ fontSize: '.58rem', color: '#5a6578' }}>Pool Share</span>
                    <span style={{ fontSize: '.75rem', fontWeight: 800, color: '#0ea5e9', fontFamily: "'JetBrains Mono', monospace" }}>{poolShare.toFixed(2)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Manual entry — always shown */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '.58rem', color: '#5a6578', marginBottom: 8, fontWeight: 600 }}>
                {hasLP ? 'Or enter amount manually:' : 'Enter your position to remove:'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 4 }}>MINE amount</div>
                  <input type="number" value={mineAmt} onChange={e => setMineAmt(e.target.value)}
                    placeholder={lpMine > 0 ? String(lpMine) : '0'}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
                      border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: '#fff',
                      fontSize: '.8rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none',
                    }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 4 }}>VIBE (auto)</div>
                  <input type="number" value={vibeAmt} readOnly
                    placeholder={lpVibe > 0 ? String(lpVibe) : '0'}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
                      border: '1px solid rgba(255,255,255,.04)', background: 'rgba(255,255,255,.015)', color: '#8b95a9',
                      fontSize: '.8rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none',
                    }} />
                </div>
              </div>
              {hasLP && (
                <button onClick={() => { setMineAmt(String(lpMine)); setVibeAmt(String(lpVibe)); }} style={{
                  padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(14,165,233,.2)',
                  background: 'rgba(14,165,233,.06)', color: '#0ea5e9', cursor: 'pointer',
                  fontSize: '.6rem', fontWeight: 700, fontFamily: 'var(--ff)',
                }}>Use detected amounts</button>
              )}
            </div>

            <button onClick={removeLiquidity} disabled={busy} style={{
              width: '100%', padding: '15px', borderRadius: 14,
              border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)',
              color: '#ef4444', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
              fontFamily: 'var(--ff)', opacity: busy ? 0.5 : 1, transition: 'all .2s',
            }}>
              Remove Position
            </button>

            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(234,179,8,.04)', borderRadius: 10, border: '1px solid rgba(234,179,8,.08)', fontSize: '.58rem', color: '#f59e0b' }}>
              Enter MINE amount — VIBE is auto-calculated from your LP position ratio.
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: '.72rem',
            background: result.ok ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)',
            border: `1px solid ${result.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
            color: result.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
          }}>
            {result.msg}
          </div>
        )}

        {/* Pool link */}
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '.56rem', color: '#38bdf8', textDecoration: 'none' }}>
            View pool on OPScan ↗
          </a>
        </div>
      </div>
    </div>
  );
};

export default LiquidityModal;
