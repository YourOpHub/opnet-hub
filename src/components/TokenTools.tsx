import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, type CallResult, type TransactionParameters } from 'opnet';
import { MINTABLE_ABI } from '../abis';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { DEPLOYED_CONTRACTS } from '../contracts';
import { CURRENT_ENV } from '../config';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { buildTxParams, formatTxError } from '../txUtils';
import { useOps } from '../contexts/OpsContext';
import type { BaseContractProperties } from 'opnet';

// Sub-components (>100 lines each)
import TokenExplorer from './tools/TokenExplorer';
import TXLookup from './tools/TXLookup';
import BlockExplorer from './tools/BlockExplorer';
import UTXOSplitter from './tools/UTXOSplitter';
import GasTool from './tools/GasTool';

// Shared styles & utils
import { cardS, inputS, btnS, rowS, monoSm } from './tools/toolStyles';

/* ═══════════════════════════════════════════════════════════════
   TOOLS — Swiss army knife for OPNet developers & users
   ═══════════════════════════════════════════════════════════════ */

type ToolTab = 'converter' | 'explorer' | 'utxo' | 'splitter' | 'tx' | 'block' | 'gas' | 'faucet';

const TOOL_TABS: { id: ToolTab; icon: string; label: string }[] = [
  { id: 'converter', icon: '💱', label: 'Converter' },
  { id: 'explorer', icon: '🔍', label: 'Token Explorer' },
  { id: 'utxo', icon: '📦', label: 'UTXO Viewer' },
  { id: 'splitter', icon: '✂️', label: 'UTXO Split' },
  { id: 'tx', icon: '📜', label: 'TX Lookup' },
  { id: 'block', icon: '⛓️', label: 'Block Explorer' },
  { id: 'gas', icon: '⛽', label: 'Gas & Mempool' },
  { id: 'faucet', icon: '🚰', label: 'Faucet' },
];

/* ─── BTC ↔ Sats ↔ USD Converter (~57 lines, stays inline) ─── */
const ConverterTool = React.memo(function ConverterTool() {
  const [ba, setBa] = useState('1');
  const [bp, setBp] = useState(97842);
  const [satsInput, setSatsInput] = useState('');
  const [mode, setMode] = useState<'btc' | 'sats'>('btc');

  useEffect(() => {
    fetchBtcPrice().then(p => { if (p.usd > 0) setBp(p.usd); }).catch(() => {});
  }, []);

  const bn = mode === 'btc' ? (parseFloat(ba) || 0) : (parseFloat(satsInput) || 0) / 1e8;
  const sv = bn * 1e8;
  const uv = bn * bp;

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className={`fbn ${mode === 'btc' ? 'on' : ''}`} style={{ padding: '4px 12px', fontSize: '.65rem' }} onClick={() => setMode('btc')}>BTC input</button>
        <button className={`fbn ${mode === 'sats' ? 'on' : ''}`} style={{ padding: '4px 12px', fontSize: '.65rem' }} onClick={() => setMode('sats')}>Sats input</button>
        <span style={{ marginLeft: 'auto', fontSize: '.6rem', color: 'var(--t4)' }}>BTC/USD: ${bp.toLocaleString()}</span>
      </div>
      {mode === 'btc' ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input style={inputS} type="number" step="any" value={ba} onChange={e => setBa(e.target.value)} placeholder="BTC amount" />
          <span style={{ color: 'var(--o)', fontWeight: 700, fontSize: '.8rem', whiteSpace: 'nowrap' }}>BTC</span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input style={inputS} type="number" step="1" value={satsInput} onChange={e => setSatsInput(e.target.value)} placeholder="Satoshis" />
          <span style={{ color: 'var(--o)', fontWeight: 700, fontSize: '.8rem', whiteSpace: 'nowrap' }}>sats</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div style={{ textAlign: 'center', padding: 10, background: 'rgba(247,147,26,.06)', borderRadius: 12 }}>
          <div style={{ ...monoSm, color: 'var(--o)', fontWeight: 700, fontSize: '.85rem' }}>{bn >= 1 ? bn.toFixed(4) : bn.toFixed(8)}</div>
          <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginTop: 2 }}>BTC</div>
        </div>
        <div style={{ textAlign: 'center', padding: 10, background: 'rgba(14,165,233,.06)', borderRadius: 12 }}>
          <div style={{ ...monoSm, color: 'var(--c)', fontWeight: 700, fontSize: '.85rem' }}>{sv >= 1e6 ? (sv / 1e6).toFixed(2) + 'M' : sv.toLocaleString()}</div>
          <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginTop: 2 }}>Satoshis</div>
        </div>
        <div style={{ textAlign: 'center', padding: 10, background: 'rgba(34,197,94,.06)', borderRadius: 12 }}>
          <div style={{ ...monoSm, color: 'var(--g)', fontWeight: 700, fontSize: '.85rem' }}>${uv >= 1e6 ? (uv / 1e6).toFixed(2) + 'M' : uv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginTop: 2 }}>USD</div>
        </div>
      </div>
      {/* Quick presets */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {[0.001, 0.01, 0.1, 1, 10].map(v => (
          <button key={v} onClick={() => { setMode('btc'); setBa(String(v)); }}
            style={{ padding: '3px 10px', fontSize: '.58rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', color: 'var(--t3)', cursor: 'pointer' }}>
            {v} BTC
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── UTXO Viewer (~64 lines, stays inline) ─── */
const UTXOViewer = React.memo(function UTXOViewer() {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [utxos, setUtxos] = useState<Array<{ transactionId: string; outputIndex: number; value: string | number }>>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [err, setErr] = useState('');

  const lookup = useCallback(async () => {
    if (!addr.trim()) return;
    setErr(''); setUtxos([]); setBalance(null); setLoading(true);
    try {
      const [u, b] = await Promise.all([opnet.getUTXOs(addr.trim()), opnet.getBalance(addr.trim())]);
      setUtxos(u);
      setBalance(b);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to fetch UTXOs'); }
    finally { setLoading(false); }
  }, [addr]);

  const totalSats = utxos.reduce((s, u) => {
    const v = typeof u.value === 'string' ? (u.value.startsWith('0x') ? Number(BigInt(u.value)) : Number(u.value)) : u.value;
    return s + v;
  }, 0);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...inputS, flex: 1 }} value={addr} onChange={e => setAddr(e.target.value)} placeholder="Bitcoin / OPNet address" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '⏳' : 'Check'}</button>
      </div>
      {err && <div style={{ fontSize: '.72rem', color: 'var(--r)', marginBottom: 8 }}>{err}</div>}
      {balance !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ textAlign: 'center', padding: 10, background: 'rgba(247,147,26,.06)', borderRadius: 12 }}>
            <div style={{ ...monoSm, fontWeight: 700, color: 'var(--o)' }}>{(Number(balance) / 1e8).toFixed(6)}</div>
            <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>BTC Balance</div>
          </div>
          <div style={{ textAlign: 'center', padding: 10, background: 'rgba(14,165,233,.06)', borderRadius: 12 }}>
            <div style={{ ...monoSm, fontWeight: 700, color: 'var(--c)' }}>{Number(balance).toLocaleString()}</div>
            <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Satoshis</div>
          </div>
          <div style={{ textAlign: 'center', padding: 10, background: 'rgba(167,139,250,.06)', borderRadius: 12 }}>
            <div style={{ ...monoSm, fontWeight: 700, color: 'var(--p)' }}>{utxos.length}</div>
            <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>UTXOs</div>
          </div>
        </div>
      )}
      {utxos.length > 0 && (
        <div>
          <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>UTXOs ({utxos.length}) · Total: {totalSats.toLocaleString()} sats</div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {utxos.map((u, i) => {
              const val = typeof u.value === 'string' ? (u.value.startsWith('0x') ? Number(BigInt(u.value)) : Number(u.value)) : u.value;
              return (
                <div key={i} style={{ ...rowS, gap: 8 }}>
                  <span style={{ ...monoSm, color: 'var(--c)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.transactionId.slice(0, 12)}…:{u.outputIndex}</span>
                  <span style={{ ...monoSm, color: 'var(--o)', fontWeight: 700, whiteSpace: 'nowrap' }}>{val.toLocaleString()} sats</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

/* ─── Faucet (~73 lines, stays inline) ─── */
interface IMintable extends BaseContractProperties { publicMint(amount: bigint): Promise<CallResult>; }

const FaucetTool = React.memo(function FaucetTool() {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp, failOp } = useOps();
  const [token, setToken] = useState<'MINE' | 'VIBE'>('MINE');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const info = token === 'MINE' ? DEPLOYED_CONTRACTS.MINE : DEPLOYED_CONTRACTS.VIBE;
  const mintAmount = BigInt(info.maxMintPerTx) * 100_000_000n; // to raw units (8 decimals)

  const mint = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    setStatus('loading'); setMsg('Simulating publicMint...');
    const opId = `mint_${info.symbol}_${Date.now()}`;
    try {
      const contract = getContract<IMintable>(info.address, MINTABLE_ABI, provider, NETWORK, senderAddr);
      const sim = await contract.publicMint(mintAmount);
      if ((sim as CallResult).revert) throw new Error(`Reverted: ${(sim as CallResult).revert}`);
      setMsg('Sign transaction in wallet...');
      const tp = await buildTxParams(provider, walletAddress);
      trackOp({ id: opId, market: 'mint', orderId: info.symbol, direction: '', role: '', step: `Minting ${info.maxMintPerTx.toLocaleString()} ${info.symbol}...` });
      await (sim as CallResult).sendTransaction(tp as TransactionParameters);
      completeOp(opId);
      setMsg(`Minted ${info.maxMintPerTx.toLocaleString()} ${info.symbol}! TX sent — confirm in ~5 min.`);
      setStatus('done');
    } catch (e) {
      failOp(opId, formatTxError(e));
      setMsg(formatTxError(e));
      setStatus('error');
    }
  }, [walletAddress, senderAddr, token, info, mintAmount]);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: '.78rem', color: 'var(--t2)' }}>Mint {CURRENT_ENV} tokens (publicMint):</span>
        {(['MINE', 'VIBE'] as const).map(t => (
          <button key={t} className={`fbn ${token === t ? 'on' : ''}`} style={{ padding: '5px 14px', fontSize: '.72rem' }} onClick={() => setToken(t)}>
            {t === 'MINE' ? '⛏️' : '⚡'} {t}
          </button>
        ))}
      </div>
      {!walletAddress && (
        <div style={{ fontSize: '.75rem', color: 'var(--t3)', marginBottom: 10, textAlign: 'center' }}>
          Connect wallet to mint tokens
        </div>
      )}
      <button style={{ ...btnS, width: '100%', opacity: status === 'loading' ? .6 : 1 }} onClick={mint} disabled={status === 'loading'}>
        {status === 'loading' ? '⏳ ' + msg : walletAddress ? `Mint ${info.maxMintPerTx.toLocaleString()} ${info.symbol}` : 'Connect Wallet'}
      </button>
      {msg && status !== 'loading' && (
        <div style={{ fontSize: '.75rem', color: status === 'done' ? 'var(--g)' : 'var(--r)', padding: '8px 12px', background: status === 'done' ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)', borderRadius: 10, marginTop: 8 }}>
          {msg}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div style={{ padding: 10, background: 'rgba(234,179,8,.05)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '.85rem' }}>⛏️</div>
          <div style={{ ...monoSm, fontWeight: 700, color: 'var(--y)' }}>1M MINE</div>
          <div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>per mint tx</div>
        </div>
        <div style={{ padding: 10, background: 'rgba(168,85,247,.05)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '.85rem' }}>⚡</div>
          <div style={{ ...monoSm, fontWeight: 700, color: 'var(--p)' }}>5M VIBE</div>
          <div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>per mint tx</div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: '.65rem', color: 'var(--t3)', textAlign: 'center' }}>
        Calls publicMint on OP-20 contract · Requires ~330 sats gas
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════
   MAIN TOOLS PAGE
   ═══════════════════════════════════════════════════════════════ */
const TokenTools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ToolTab>('converter');

  useEffect(() => { localStorage.setItem('hub_tools_used', '1'); }, []);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 12px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', padding: '20px 0 14px' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, background: 'linear-gradient(135deg, #F7931A, #ffab40)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🛠️ OPNet Developer Tools
        </div>
        <div style={{ fontSize: '.72rem', color: 'var(--t3)', marginTop: 4 }}>
          Swiss army knife for Bitcoin L1 smart contracts
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: '0 0 12px', borderBottom: '1px solid rgba(255,255,255,.06)', marginBottom: 14 }}>
        {TOOL_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 14px', borderRadius: 12, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: activeTab === t.id ? 'linear-gradient(135deg, rgba(247,147,26,.15), rgba(255,171,64,.1))' : 'rgba(255,255,255,.03)',
              color: activeTab === t.id ? 'var(--o)' : 'var(--t3)',
              fontWeight: activeTab === t.id ? 700 : 500,
              fontSize: '.7rem', transition: '.2s',
              borderColor: activeTab === t.id ? 'rgba(247,147,26,.2)' : 'transparent',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tool content */}
      {activeTab === 'converter' && <ConverterTool />}
      {activeTab === 'explorer' && <TokenExplorer />}
      {activeTab === 'utxo' && <UTXOViewer />}
      {activeTab === 'splitter' && <UTXOSplitter />}
      {activeTab === 'tx' && <TXLookup />}
      {activeTab === 'block' && <BlockExplorer />}
      {activeTab === 'gas' && <GasTool />}
      {activeTab === 'faucet' && <FaucetTool />}
    </div>
  );
};

export default TokenTools;
