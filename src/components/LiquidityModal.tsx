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

  const [lpMine, setLpMine] = useState(() => { try { return Number(localStorage.getItem('hub_lp_mine') || '0'); } catch { return 0; } });
  const [lpVibe, setLpVibe] = useState(() => { try { return Number(localStorage.getItem('hub_lp_vibe') || '0'); } catch { return 0; } });

  const hasLP = lpMine > 0 || lpVibe > 0;
  const poolShare = reserveA > 0 ? (lpMine / reserveA) * 100 : 0;
  const ratio = reserveA > 0 ? reserveB / reserveA : 0;

  // Auto-calculate VIBE based on pool ratio
  useEffect(() => {
    const m = parseFloat(mineAmt);
    if (tab === 'add' && m > 0 && ratio > 0) {
      setVibeAmt((m * ratio).toFixed(2));
    }
  }, [mineAmt, ratio, tab]);

  // Reset on open/tab change
  useEffect(() => {
    setResult(null);
    setStep('');
    if (tab === 'add') { setMineAmt(''); setVibeAmt(''); }
  }, [tab, open]);

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
        background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16,
        padding: '20px 22px', boxShadow: '0 24px 48px rgba(0,0,0,.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>💧 Liquidity</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--t3)', fontSize: '1.2rem',
            cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
          }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg3)', borderRadius: 10, padding: 3 }}>
          {(['add', 'remove'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: tab === t ? (t === 'add' ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' : 'linear-gradient(135deg, #ef4444, #dc2626)') : 'transparent',
              color: tab === t ? '#fff' : 'var(--t3)', fontWeight: 700, fontSize: '.8rem',
              fontFamily: 'var(--ff)', transition: 'all .2s',
            }}>
              {t === 'add' ? '+ Add' : '− Remove'}
            </button>
          ))}
        </div>

        {/* Pool Info */}
        <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 10, marginBottom: 14, fontSize: '.7rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>Pool</span>
            <span style={{ color: 'var(--w)', fontWeight: 700 }}>⛏️ MINE / ⚡ VIBE</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>Reserves</span>
            <span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>{reserveA.toLocaleString()} / {reserveB.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>Rate</span>
            <span style={{ fontFamily: 'var(--fm)', color: 'var(--o)' }}>1 MINE = {ratio.toFixed(2)} VIBE</span>
          </div>
          {hasLP && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: 4, marginTop: 4 }}>
              <span style={{ color: 'var(--t3)' }}>Your Share</span>
              <span style={{ fontFamily: 'var(--fm)', color: '#0ea5e9', fontWeight: 700 }}>{poolShare.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {/* ADD TAB */}
        {tab === 'add' && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>⛏️ MINE</span>
                <span style={{ fontSize: '.6rem', color: 'var(--t4)' }}>Balance: {fmtBal(mineBal)}</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input type="number" value={mineAmt} onChange={e => setMineAmt(e.target.value)}
                  placeholder="0.0" style={{
                    width: '100%', padding: '12px 70px 12px 12px', borderRadius: 10,
                    border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--w)',
                    fontSize: '.9rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
                  }} />
                {mineBal != null && mineBal > 0n && (
                  <button onClick={() => setMineAmt((Number(mineBal) / 1e8).toString())} style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--o)',
                    background: 'rgba(247,147,26,.1)', color: 'var(--o)', cursor: 'pointer',
                    fontSize: '.65rem', fontWeight: 700, fontFamily: 'var(--ff)',
                  }}>MAX</button>
                )}
              </div>
            </div>

            <div style={{ textAlign: 'center', color: 'var(--t4)', fontSize: '1rem', margin: '6px 0' }}>+</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>⚡ VIBE (auto)</span>
                <span style={{ fontSize: '.6rem', color: 'var(--t4)' }}>Balance: {fmtBal(vibeBal)}</span>
              </div>
              <input type="number" value={vibeAmt} readOnly style={{
                width: '100%', padding: '12px', borderRadius: 10,
                border: '1px solid var(--bd)', background: 'rgba(255,255,255,.02)', color: 'var(--t2)',
                fontSize: '.9rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
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
                width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: busy ? 'var(--bg4)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                color: '#fff', fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
                opacity: busy || !mineAmt ? 0.5 : 1, transition: 'all .2s',
              }}>
                {busy ? (step || 'Processing...') : '💧 Add Liquidity'}
              </button>
            ) : (
              <button onClick={openConnectModal} style={{
                width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff',
                fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
              }}>Connect Wallet</button>
            )}
          </div>
        )}

        {/* REMOVE TAB */}
        {tab === 'remove' && (
          <div>
            {hasLP ? (
              <>
                <div style={{ padding: '14px', background: 'var(--bg3)', borderRadius: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: '.65rem', color: 'var(--t4)', marginBottom: 8 }}>Your Position</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '.8rem', color: 'var(--t2)' }}>⛏️ MINE</span>
                    <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--w)', fontFamily: 'var(--fm)' }}>{lpMine.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '.8rem', color: 'var(--t2)' }}>⚡ VIBE</span>
                    <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--w)', fontFamily: 'var(--fm)' }}>{lpVibe.toLocaleString()}</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Pool Share</span>
                    <span style={{ fontSize: '.85rem', fontWeight: 800, color: '#0ea5e9', fontFamily: 'var(--fm)' }}>{poolShare.toFixed(2)}%</span>
                  </div>
                </div>

                <button onClick={removeLiquidity} disabled={busy} style={{
                  width: '100%', padding: '14px', borderRadius: 10,
                  border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)',
                  color: '#ef4444', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer',
                  fontFamily: 'var(--ff)', opacity: busy ? 0.5 : 1, transition: 'all .2s',
                }}>
                  Remove Full Position
                </button>

                <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(234,179,8,.06)', borderRadius: 8, fontSize: '.6rem', color: 'var(--y)' }}>
                  SimplePool v1 — positions tracked locally. On-chain LP tokens with proportional withdrawal in v2.
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
            style={{ fontSize: '.6rem', color: 'var(--c2)', textDecoration: 'none' }}>
            View pool contract on OPScan ↗
          </a>
        </div>
      </div>
    </div>
  );
};

export default LiquidityModal;
