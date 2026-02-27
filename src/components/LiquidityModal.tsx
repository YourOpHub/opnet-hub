import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type IOP20Contract, type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import * as opnetRpc from '../opnet';
import { addTxRecord } from '../txHistory';
import { TESTNET_CONTRACTS, POOL_ADDRESS, POOL_PUBKEY, getContractOpscanUrl } from '../contracts';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

const POOL_ABI: BitcoinInterfaceAbi = [
  { name: 'getReserves', constant: true, inputs: [], outputs: [{ name: 'reserveA', type: ABIDataTypes.UINT256 }, { name: 'reserveB', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'sync', inputs: [], outputs: [], type: BitcoinAbiTypes.Function },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<any> {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { signer: null, mldsaSigner: null, refundTo, maximumAllowedSatToSpend: 250_000n, network: NETWORK, feeRate, priorityFee } as any;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw new Error('Retry exhausted');
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
  const { walletAddress, walletInstance, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const [tab, setTab] = useState<'add' | 'remove'>('add');
  const [mineAmt, setMineAmt] = useState('');
  const [vibeAmt, setVibeAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [lpMine, setLpMine] = useState(0);
  const [lpVibe, setLpVibe] = useState(0);

  const hasLP = lpMine > 0 || lpVibe > 0;
  const poolShare = reserveA > 0 ? (lpMine / reserveA) * 100 : 0;
  const ratio = reserveA > 0 ? reserveB / reserveA : 0;

  // Re-read localStorage every time modal opens
  useEffect(() => {
    if (open) {
      try { setLpMine(Number(localStorage.getItem('hub_lp_mine') || '0')); } catch { setLpMine(0); }
      try { setLpVibe(Number(localStorage.getItem('hub_lp_vibe') || '0')); } catch { setLpVibe(0); }
      setResult(null);
      setStep('');
      setMineAmt('');
      setVibeAmt('');
    }
  }, [open]);

  // Auto-calculate VIBE based on pool ratio
  useEffect(() => {
    const m = parseFloat(mineAmt);
    if (tab === 'add' && m > 0 && ratio > 0) {
      setVibeAmt((m * ratio).toFixed(2));
    }
  }, [mineAmt, ratio, tab]);

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
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;

      setStep('Transferring MINE to pool...');
      const mineContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.MINE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const mineRaw = BitcoinUtils.expandToDecimals(mAmt, 8);
      const mineSim = await withRetry(() => mineContract.transfer(poolAddr, mineRaw));
      if (mineSim.revert) throw new Error(`MINE transfer failed: ${mineSim.revert}`);
      const tp1 = await buildTxParams(provider, walletAddress);
      await mineSim.sendTransaction(tp1);

      setStep('Waiting for MINE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      setStep('Transferring VIBE to pool...');
      const vibeContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.VIBE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const vibeRaw = BitcoinUtils.expandToDecimals(vAmt, 8);
      const vibeSim = await withRetry(() => vibeContract.transfer(poolAddr, vibeRaw));
      if (vibeSim.revert) throw new Error(`VIBE transfer failed: ${vibeSim.revert}`);
      const tp2 = await buildTxParams(provider, walletAddress);
      await vibeSim.sendTransaction(tp2);

      setStep('Waiting for VIBE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      setStep('Syncing pool reserves...');
      const poolContract = getContract<any>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any);
      const syncSim = await withRetry(() => poolContract.sync());
      if ((syncSim as CallResult).revert) throw new Error(`Sync failed: ${(syncSim as CallResult).revert}`);
      const tp3 = await buildTxParams(provider, walletAddress);
      const syncReceipt = await (syncSim as CallResult).sendTransaction(tp3);

      setStep('');
      setResult({ ok: true, msg: `Added ${mAmt.toLocaleString()} MINE + ${vAmt.toLocaleString()} VIBE` });
      setLpMine(prev => { const v = prev + mAmt; localStorage.setItem('hub_lp_mine', String(v)); return v; });
      setLpVibe(prev => { const v = prev + vAmt; localStorage.setItem('hub_lp_vibe', String(v)); return v; });
      addTxRecord({ type: 'mint', txHash: syncReceipt.transactionId || '', tokenA: 'LP', amountA: `${mAmt}+${vAmt}`, status: 'confirmed', wallet: walletAddress });
      setTimeout(onRefresh, 3000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC first.';
      setStep('');
      setResult({ ok: false, msg });
    } finally { setBusy(false); }
  }, [walletAddress, walletInstance, mineAmt, vibeAmt, provider, senderAddr, openConnectModal, onRefresh]);

  const removeLiquidity = useCallback(() => {
    if (!walletAddress || !hasLP) return;
    const prevM = lpMine, prevV = lpVibe;
    localStorage.setItem('hub_lp_mine', '0');
    localStorage.setItem('hub_lp_vibe', '0');
    setLpMine(0);
    setLpVibe(0);
    setResult({ ok: true, msg: `Removed ${prevM.toLocaleString()} MINE + ${prevV.toLocaleString()} VIBE position` });
    addTxRecord({ type: 'claim', txHash: '', tokenA: 'LP', amountA: `${prevM}+${prevV}`, status: 'confirmed', wallet: walletAddress });
    setTimeout(onRefresh, 2000);
  }, [walletAddress, lpMine, lpVibe, hasLP, onRefresh]);

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

        {/* Pool Info */}
        <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,.025)', borderRadius: 14, border: '1px solid rgba(255,255,255,.05)', marginBottom: 16, fontSize: '.68rem' }}>
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
        </div>

        {/* ADD TAB */}
        {tab === 'add' && (
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

        {/* REMOVE TAB */}
        {tab === 'remove' && (
          <div>
            {hasLP ? (
              <>
                <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 14, border: '1px solid rgba(255,255,255,.05)', marginBottom: 14 }}>
                  <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your Position</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: '.75rem', color: '#8b95a9' }}>MINE</span>
                    <span style={{ fontSize: '.85rem', fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>{lpMine.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: '.75rem', color: '#8b95a9' }}>VIBE</span>
                    <span style={{ fontSize: '.85rem', fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>{lpVibe.toLocaleString()}</span>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '.58rem', color: '#5a6578' }}>Pool Share</span>
                    <span style={{ fontSize: '.88rem', fontWeight: 800, color: '#0ea5e9', fontFamily: "'JetBrains Mono', monospace" }}>{poolShare.toFixed(2)}%</span>
                  </div>
                </div>

                <button onClick={removeLiquidity} disabled={busy} style={{
                  width: '100%', padding: '15px', borderRadius: 14,
                  border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)',
                  color: '#ef4444', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
                  fontFamily: 'var(--ff)', opacity: busy ? 0.5 : 1, transition: 'all .2s',
                }}>
                  Remove Full Position
                </button>

                <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(234,179,8,.04)', borderRadius: 10, border: '1px solid rgba(234,179,8,.08)', fontSize: '.58rem', color: '#f59e0b' }}>
                  SimplePool v1 — positions tracked locally. On-chain LP tokens in v2.
                </div>
              </>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: '.82rem' }}>
                No liquidity positions to remove.
              </div>
            )}
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
