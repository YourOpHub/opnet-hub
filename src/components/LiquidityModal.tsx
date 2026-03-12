import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract, BitcoinUtils,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { POOL_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { ensureAllowance, buildTxParams, withRetry, formatTxError, waitForNextBlock, emitBalanceRefresh } from '../txUtils';
import { addTxRecord } from '../txHistory';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS, POOL_PUBKEY, getContractOpscanUrl, getTxUrl } from '../contracts';
import { fetchAllTokens, type IndexedToken } from '../tokenApi';
import { useOps } from '../contexts/OpsContext';
import { useFocusTrap } from '../hooks/useFocusTrap';



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

const LiquidityModal: React.FC<Props> = ({ open, onClose, reserveA, reserveB, balances, onRefresh }) => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, updateOpStep, completeOp, failOp } = useOps();
  const trapRef = useFocusTrap(open, onClose);

  const [tab, setTab] = useState<'add' | 'remove'>('add');
  const [mineAmt, setMineAmt] = useState('');
  const [vibeAmt, setVibeAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ ok: boolean; msg: string; txHash?: string } | null>(null);
  const [, setAllTokens] = useState<IndexedToken[]>([]);

  const [lpMine, setLpMine] = useState(0);
  const [lpVibe, setLpVibe] = useState(0);

  // Fetch token list from indexer
  useEffect(() => {
    if (!open) return;
    fetchAllTokens().then(tokens => {
      if (tokens.length > 0) setAllTokens(tokens);
    }).catch((e) => { logger.warn('[LiquidityModal] Token list fetch error:', e); });
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
    void (async () => {
      try {
        const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);
        const res = await withRetry(() => poolContract.liquidityOf(senderAddr)) as CallResult;
        if (!res.revert && res.properties != null) {
          const props = res.properties as Record<string, unknown>;
          const a = Number(props.amountA ?? 0n) / 1e8;
          const b = Number(props.amountB ?? 0n) / 1e8;
          setLpMine(a);
          setLpVibe(b);
        }
      } catch (e) { logger.warn('[LiquidityModal] LP position fetch failed:', e); }
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

  // Must be before useCallback hooks that reference them
  const mineBal = balances['MINE'];
  const vibeBal = balances['VIBE'];

  const addLiquidity = useCallback(async () => {
    if (!walletAddress) { openConnectModal(); return; }
    const mAmt = parseFloat(mineAmt);
    const vAmt = parseFloat(vibeAmt);
    if (!mAmt || !vAmt || mAmt <= 0 || vAmt <= 0) { setResult({ ok: false, msg: 'Enter both amounts' }); return; }
    if (!senderAddr) { setResult({ ok: false, msg: 'Wallet key not available' }); return; }
    const mineBalNum = mineBal != null ? Number(mineBal) / 1e8 : 0;
    const vibeBalNum = vibeBal != null ? Number(vibeBal) / 1e8 : 0;
    if (mAmt > mineBalNum) { setResult({ ok: false, msg: `Insufficient MINE balance (have ${mineBalNum.toLocaleString()}, need ${mAmt.toLocaleString()})` }); return; }
    if (vAmt > vibeBalNum) { setResult({ ok: false, msg: `Insufficient VIBE balance (have ${vibeBalNum.toLocaleString()}, need ${vAmt.toLocaleString()})` }); return; }

    setBusy(true);
    setResult(null);
    const aOpId = `lp_add_${Date.now()}`;
    trackOp({ id: aOpId, market: 'liquidity', orderId: 'Add LP', direction: '', role: '', step: 'Approving MINE...', amounts: { mine: mAmt.toString(), vibe: vAmt.toString() } });
    try {
      const mineRaw = BitcoinUtils.expandToDecimals(mAmt, 8);
      const vibeRaw = BitcoinUtils.expandToDecimals(vAmt, 8);

      // Step 1: Ensure MINE allowance (check → approve → wait for block)
      const mineApproved = await ensureAllowance(
        DEPLOYED_CONTRACTS.MINE.address, POOL_PUBKEY, mineRaw,
        provider, senderAddr, walletAddress, (s: string) => { setStep(s); updateOpStep(aOpId, s); }, 'MINE',
      );

      // Step 2: Ensure VIBE allowance (if MINE needed approval, UTXOs changed — wait for block)
      if (mineApproved) await waitForNextBlock(provider, (s: string) => { setStep(s); updateOpStep(aOpId, s); });
      updateOpStep(aOpId, 'Approving VIBE...');
      const vibeApproved = await ensureAllowance(
        DEPLOYED_CONTRACTS.VIBE.address, POOL_PUBKEY, vibeRaw,
        provider, senderAddr, walletAddress, (s: string) => { setStep(s); updateOpStep(aOpId, s); }, 'VIBE',
      );
      if (vibeApproved) await waitForNextBlock(provider, (s: string) => { setStep(s); updateOpStep(aOpId, s); });

      // Step 3: addLiquidity on pool
      updateOpStep(aOpId, `Adding ${mAmt} MINE + ${vAmt} VIBE...`);
      setStep('Adding liquidity to pool...');
      const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);
      const addSim = await withRetry(() => poolContract.addLiquidity(mineRaw, vibeRaw));
      if ((addSim as CallResult).revert) throw new Error(`addLiquidity failed: ${(addSim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      const addReceipt = await (addSim as CallResult).sendTransaction(tp);
      updateOpStep(aOpId, 'Waiting for block confirmation...', { tx: addReceipt.transactionId || '' });
      setStep('Waiting for block confirmation...');
      await waitForNextBlock(provider, (s) => { setStep(s); updateOpStep(aOpId, s); });
      completeOp(aOpId);

      setStep('');
      setResult({ ok: true, msg: `Added ${mAmt.toLocaleString()} MINE + ${vAmt.toLocaleString()} VIBE on-chain!`, txHash: addReceipt.transactionId || '' });
      setLpMine(prev => prev + mAmt);
      setLpVibe(prev => prev + vAmt);
      addTxRecord({ type: 'mint', txHash: addReceipt.transactionId || '', tokenA: 'LP', amountA: `${mAmt}+${vAmt}`, status: 'confirmed', wallet: walletAddress });
      emitBalanceRefresh();
      setTimeout(onRefresh, 3000);
    } catch (e) {
      failOp(aOpId, formatTxError(e));
      setStep('');
      setResult({ ok: false, msg: formatTxError(e) });
    } finally { setBusy(false); }
  }, [walletAddress, mineAmt, vibeAmt, mineBal, vibeBal, provider, senderAddr, openConnectModal, onRefresh, trackOp, updateOpStep, completeOp, failOp]);

  const removeLiquidity = useCallback(async () => {
    logger.info('[LiquidityModal] removeLiquidity called', { walletAddress: !!walletAddress, senderAddr: !!senderAddr, mineAmt, lpMine, lpVibe });
    if (!walletAddress) { openConnectModal(); return; }
    if (!senderAddr) { setResult({ ok: false, msg: 'Wallet key not available' }); return; }
    const m = parseFloat(mineAmt) || lpMine;
    const v = parseFloat(vibeAmt) || lpVibe;
    if (m <= 0 && v <= 0) { setResult({ ok: false, msg: 'Enter the amounts to remove' }); return; }

    setBusy(true);
    setResult(null);
    const rOpId = `lp_rm_${Date.now()}`;
    trackOp({ id: rOpId, market: 'liquidity', orderId: 'Remove LP', direction: '', role: '', step: 'Checking LP position...', amounts: { mine: m.toString(), vibe: v.toString() } });
    try {
      const poolContract = getContract<IPoolContract>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr);

      // Query FRESH liquidityOf right before removal — reserves may have changed since modal opened
      setStep('Checking your LP position...');
      let freshMineRaw: bigint;
      try {
        const freshLp = await withRetry(() => poolContract.liquidityOf(senderAddr)) as CallResult;
        if (!freshLp.revert && freshLp.properties != null) {
          const props = freshLp.properties as Record<string, unknown>;
          freshMineRaw = BigInt(String(props.amountA ?? 0n));
        } else {
          freshMineRaw = BitcoinUtils.expandToDecimals(m, 8);
        }
      } catch {
        freshMineRaw = BitcoinUtils.expandToDecimals(m, 8);
      }

      updateOpStep(rOpId, `Removing ${m} MINE + ${v} VIBE...`);
      setStep('Removing liquidity from pool...');
      // Contract v6: amountA is used to compute shares, actual withdrawal is proportional from shares
      // No rounding margin needed — contract derives both amounts from shares consistently
      const removeSim = await withRetry(() => poolContract.removeLiquidity(freshMineRaw, 0n));
      if ((removeSim as CallResult).revert) throw new Error(`removeLiquidity failed: ${(removeSim as CallResult).revert}`);
      const tp = await buildTxParams(provider, walletAddress);
      const receipt = await (removeSim as CallResult).sendTransaction(tp);
      updateOpStep(rOpId, 'Waiting for block confirmation...', { tx: receipt.transactionId || '' });
      setStep('Waiting for block confirmation...');
      await waitForNextBlock(provider, (s) => { setStep(s); updateOpStep(rOpId, s); });
      completeOp(rOpId);

      setStep('');
      setLpMine(prev => Math.max(0, prev - m));
      setLpVibe(prev => Math.max(0, prev - v));
      setMineAmt('');
      setVibeAmt('');
      setResult({ ok: true, msg: `Removed ${m.toLocaleString()} MINE + ${v.toLocaleString()} VIBE. Tokens returned to your wallet!`, txHash: receipt.transactionId || '' });
      addTxRecord({ type: 'claim', txHash: receipt.transactionId || '', tokenA: 'LP', amountA: `${m}+${v}`, status: 'confirmed', wallet: walletAddress });
      emitBalanceRefresh();
      setTimeout(onRefresh, 3000);
    } catch (e) {
      failOp(rOpId, formatTxError(e));
      setStep('');
      setResult({ ok: false, msg: formatTxError(e) });
    } finally { setBusy(false); }
  }, [walletAddress, mineAmt, vibeAmt, lpMine, lpVibe, provider, senderAddr, openConnectModal, onRefresh, trackOp, updateOpStep, completeOp, failOp]);

  if (!open) return null;

  const connected = !!walletAddress;
  const fmtBal = (b: bigint | undefined): string => b != null ? (Number(b) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

  return (
    <div ref={trapRef} className="liq-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-labelledby="liq-modal-title">
      <div className="liq-card">
        {/* Header */}
        <div className="flex-between mb-18">
          <span id="liq-modal-title" className="fw-800 fs-95 c-w ls-neg02">Liquidity</span>
          <button onClick={onClose} className="liq-close-btn" aria-label="Close liquidity modal">&times;</button>
        </div>

        {/* Tabs */}
        <div className="liq-tab-bar" role="tablist" aria-label="Liquidity operation">
          {(['add', 'remove'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t} aria-label={t === 'add' ? 'Add liquidity' : 'Remove liquidity'} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: tab === t ? (t === 'add' ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' : 'linear-gradient(135deg, #ef4444, #dc2626)') : 'transparent',
              color: tab === t ? '#fff' : '#5a6578', fontWeight: 700, fontSize: '.78rem',
              fontFamily: 'var(--ff)', transition: 'all .2s',
            }}>
              {t === 'add' ? '+ Add' : '− Remove'}
            </button>
          ))}
        </div>

        {/* Pool Info */}
        <div className="liq-pool-info">
          <div className="grid-3col gap-8" style={{ marginBottom: hasLP ? 8 : 0 }}>
            <div className="text-center">
              <div className="liq-label-sm">MINE</div>
              <div className="liq-mono">{reserveA.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="liq-label-sm">VIBE</div>
              <div className="liq-mono">{reserveB.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="liq-label-sm">RATE</div>
              <div className="liq-mono c-o">1:{ratio.toFixed(1)}</div>
            </div>
          </div>
          {hasLP && (
            <div className="flex-between pt-8" style={{ borderTop: '1px solid rgba(255,255,255,.05)' }}>
              <span className="fs-60 c-muted">Your Share</span>
              <span className="liq-mono c-c">{poolShare.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {/* ADD TAB */}
        {tab === 'add' && (
          <div>
            <div className="mb-8">
              <div className="flex-between mb-6">
                <span className="liq-field">MINE</span>
                <span className="liq-bal">Balance: {fmtBal(mineBal)}</span>
              </div>
              <div className="pos-relative">
                <input type="number" value={mineAmt} onChange={e => setMineAmt(e.target.value)}
                  placeholder="0.0" className="liq-input" aria-label="MINE amount to add" style={{ paddingRight: 70 }} />
                {mineBal != null && mineBal > 0n && (
                  <button onClick={() => setMineAmt((Number(mineBal) / 1e8).toString())}
                    className="liq-max-btn" aria-label="Use maximum MINE balance">MAX</button>
                )}
              </div>
            </div>

            <div className="text-center fw-700 fs-85 c-t4" style={{ margin: '4px 0' }}>+</div>

            <div className="mb-14">
              <div className="flex-between mb-6">
                <span className="liq-field">VIBE (auto)</span>
                <span className="liq-bal">Balance: {fmtBal(vibeBal)}</span>
              </div>
              <input type="number" value={vibeAmt} readOnly className="liq-input-ro" aria-label="VIBE amount (auto-calculated)" />
            </div>

            {parseFloat(mineAmt) > 0 && reserveA > 0 && (
              <div className="bg3-rounded mb-12 fs-65 c-t3 p-8-12">
                <div className="flex-between">
                  <span>New pool share</span>
                  <span className="fw-700 text-mono c-c">
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
        {tab === 'remove' && (
          <div>
            {/* Position summary if tracked in localStorage */}
            {hasLP && (
              <div className="liq-detected">
                <div className="liq-label mb-8">Detected Position</div>
                <div className="flex-between mb-4">
                  <span className="fs-72" style={{ color: '#8b95a9' }}>MINE</span>
                  <span className="fs-78 fw-700 c-w text-mono">{lpMine.toLocaleString()}</span>
                </div>
                <div className="flex-between mb-4">
                  <span className="fs-72" style={{ color: '#8b95a9' }}>VIBE</span>
                  <span className="fs-78 fw-700 c-w text-mono">{lpVibe.toLocaleString()}</span>
                </div>
                {poolShare > 0 && (
                  <div className="flex-between pt-6 mt-4" style={{ borderTop: '1px solid rgba(255,255,255,.05)' }}>
                    <span className="liq-field">Pool Share</span>
                    <span className="fs-75 fw-800 text-mono c-c">{poolShare.toFixed(2)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Empty vault illustration when no LP detected */}
            {!hasLP && (
              <div className="text-center mb-12">
                <img src="/icons/empty-the-vault.png" alt="" style={{ width: 80, opacity: 0.65, marginBottom: 8 }} />
                <div className="fs-65 c-muted">No LP position detected</div>
              </div>
            )}

            {/* Manual entry — always shown */}
            <div className="mb-12">
              <div className="liq-field mb-8">
                {hasLP ? 'Or enter amount manually:' : 'Enter your position to remove:'}
              </div>
              <div className="flex-center gap-8 mb-8">
                <div className="flex-1">
                  <div className="liq-label-sm mb-4">MINE amount</div>
                  <input type="number" value={mineAmt} onChange={e => setMineAmt(e.target.value)}
                    placeholder={lpMine > 0 ? String(lpMine) : '0'}
                    className="liq-input-sm" aria-label="MINE amount to remove" />
                </div>
                <div className="flex-1">
                  <div className="liq-label-sm mb-4">VIBE (auto)</div>
                  <input type="number" value={vibeAmt} readOnly
                    placeholder={lpVibe > 0 ? String(lpVibe) : '0'}
                    className="liq-input-sm-ro" aria-label="VIBE amount to remove (auto-calculated)" />
                </div>
              </div>
              {hasLP && (
                <button onClick={() => { setMineAmt(String(lpMine)); setVibeAmt(String(lpVibe)); }}
                  className="liq-use-btn">Use detected amounts</button>
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

            <div className="liq-warn">
              Enter MINE amount — VIBE is auto-calculated from your LP position ratio.
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={`mt-12 fs-72 word-break ${result.ok ? 'cc-result-ok' : 'cc-result-err'}`} role="alert" aria-live="assertive">
            {result.msg}
            {result.txHash && (
              <a href={getTxUrl(result.txHash)} target="_blank" rel="noopener noreferrer"
                className="ml-6 c-c2 no-decoration fw-600">View TX ↗</a>
            )}
          </div>
        )}

        {/* Pool link */}
        <div className="mt-14 text-center">
          <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
            className="fs-56 c-c2 no-decoration">
            View pool on OPScan ↗
          </a>
        </div>
      </div>
    </div>
  );
};

export default LiquidityModal;
