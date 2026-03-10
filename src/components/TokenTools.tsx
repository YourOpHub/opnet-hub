import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../logger';
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
    fetchBtcPrice().then(p => { if (p.usd > 0) setBp(p.usd); }).catch((e) => { logger.warn('[TokenTools] BTC price fetch error:', e); });
  }, []);

  const bn = mode === 'btc' ? (parseFloat(ba) || 0) : (parseFloat(satsInput) || 0) / 1e8;
  const sv = bn * 1e8;
  const uv = bn * bp;

  return (
    <div style={cardS}>
      <div className="flex-center gap-6 mb-12" role="radiogroup" aria-label="Input mode">
        <button className={`fbn fs-65 ${mode === 'btc' ? 'on' : ''}`} role="radio" aria-checked={mode === 'btc'} style={{ padding: '4px 12px' }} onClick={() => setMode('btc')}>BTC input</button>
        <button className={`fbn fs-65 ${mode === 'sats' ? 'on' : ''}`} role="radio" aria-checked={mode === 'sats'} style={{ padding: '4px 12px' }} onClick={() => setMode('sats')}>Sats input</button>
        <span className="fs-xs c-t4 ml-auto">BTC/USD: ${bp.toLocaleString()}</span>
      </div>
      {mode === 'btc' ? (
        <div className="flex-center gap-8 mb-12">
          <input style={inputS} type="number" step="any" aria-label="BTC amount" value={ba} onChange={e => setBa(e.target.value)} placeholder="BTC amount" />
          <span className="c-o fw-700 fs-80 ws-nowrap">BTC</span>
        </div>
      ) : (
        <div className="flex-center gap-8 mb-12">
          <input style={inputS} type="number" step="1" aria-label="Satoshis amount" value={satsInput} onChange={e => setSatsInput(e.target.value)} placeholder="Satoshis" />
          <span className="c-o fw-700 fs-80 ws-nowrap">sats</span>
        </div>
      )}
      <div className="d-grid gap-8" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div className="text-center p-10 br-12" style={{ background: 'rgba(247,147,26,.06)' }}>
          <div className="text-mono fw-700 c-o fs-85">{bn >= 1 ? bn.toFixed(4) : bn.toFixed(8)}</div>
          <div className="mt-2 c-t4 fs-55">BTC</div>
        </div>
        <div className="text-center p-10 br-12" style={{ background: 'rgba(14,165,233,.06)' }}>
          <div className="text-mono fw-700 c-c fs-85">{sv >= 1e6 ? (sv / 1e6).toFixed(2) + 'M' : sv.toLocaleString()}</div>
          <div className="mt-2 c-t4 fs-55">Satoshis</div>
        </div>
        <div className="text-center p-10 br-12" style={{ background: 'rgba(34,197,94,.06)' }}>
          <div className="text-mono fw-700 c-g fs-85">${uv >= 1e6 ? (uv / 1e6).toFixed(2) + 'M' : uv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div className="mt-2 c-t4 fs-55">USD</div>
        </div>
      </div>
      {/* Quick presets */}
      <div className="flex-center gap-6 mt-10 flex-wrap">
        {[0.001, 0.01, 0.1, 1, 10].map(v => (
          <button key={v} onClick={() => { setMode('btc'); setBa(String(v)); }}
            className="fs-58 br-8 c-t3 pointer" style={{ padding: '3px 10px', border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)' }}>
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
      <div className="flex-center gap-8 mb-10">
        <input className="flex-1" style={{ ...inputS }} aria-label="Bitcoin or OPNet address" value={addr} onChange={e => setAddr(e.target.value)} placeholder="Bitcoin / OPNet address" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '⏳' : 'Check'}</button>
      </div>
      {err && <div className="fs-72 c-r mb-8" role="alert">{err}</div>}
      {balance !== null && (
        <div className="d-grid gap-8 mb-12" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="text-center p-10 br-12" style={{ background: 'rgba(247,147,26,.06)' }}>
            <div className="text-mono fw-700 c-o">{(Number(balance) / 1e8).toFixed(6)}</div>
            <div className="c-t4 fs-50">BTC Balance</div>
          </div>
          <div className="text-center p-10 br-12" style={{ background: 'rgba(14,165,233,.06)' }}>
            <div className="text-mono fw-700 c-c">{Number(balance).toLocaleString()}</div>
            <div className="c-t4 fs-50">Satoshis</div>
          </div>
          <div className="text-center p-10 br-12" style={{ background: 'rgba(167,139,250,.06)' }}>
            <div className="text-mono fw-700 c-p">{utxos.length}</div>
            <div className="c-t4 fs-50">UTXOs</div>
          </div>
        </div>
      )}
      {utxos.length > 0 && (
        <div>
          <div className="fs-66 c-t3 mb-6 fw-600">UTXOs ({utxos.length}) · Total: {totalSats.toLocaleString()} sats</div>
          <div className="ov-y-auto" style={{ maxHeight: 300 }}>
            {utxos.map((u, i) => {
              const val = typeof u.value === 'string' ? (u.value.startsWith('0x') ? Number(BigInt(u.value)) : Number(u.value)) : u.value;
              return (
                <div key={i} className="gap-8" style={{ ...rowS }}>
                  <span className="c-c flex-1 ov-hidden text-ellipsis ws-nowrap" style={{ ...monoSm }}>{u.transactionId.slice(0, 12)}…:{u.outputIndex}</span>
                  <span className="c-o fw-700 ws-nowrap" style={{ ...monoSm }}>{val.toLocaleString()} sats</span>
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
  }, [walletAddress, senderAddr, info, mintAmount, completeOp, failOp, openConnectModal, provider, trackOp]);

  return (
    <div style={cardS}>
      <div className="flex-center gap-8 mb-12">
        <span className="fs-82 c-t2">Mint {CURRENT_ENV} tokens (publicMint):</span>
        {(['MINE', 'VIBE'] as const).map(t => (
          <button key={t} className={`fbn fs-72 ${token === t ? 'on' : ''}`} style={{ padding: '5px 14px' }} onClick={() => setToken(t)}>
            {t === 'MINE' ? '⛏️' : '⚡'} {t}
          </button>
        ))}
      </div>
      {!walletAddress && (
        <div className="c-t3 mb-10 text-center fs-75">
          Connect wallet to mint tokens
        </div>
      )}
      <button className="w-full" style={{ ...btnS, opacity: status === 'loading' ? .6 : 1 }} onClick={mint} disabled={status === 'loading'}>
        {status === 'loading' ? '⏳ ' + msg : walletAddress ? `Mint ${info.maxMintPerTx.toLocaleString()} ${info.symbol}` : 'Connect Wallet'}
      </button>
      {msg && status !== 'loading' && (
        <div className="fs-75 br-10 mt-8" role="alert" style={{ color: status === 'done' ? 'var(--g)' : 'var(--r)', padding: '8px 12px', background: status === 'done' ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)' }}>
          {msg}
        </div>
      )}
      <div className="d-grid gap-8 mt-10" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="text-center p-10 br-10" style={{ background: 'rgba(234,179,8,.05)' }}>
          <div className="fs-85">⛏️</div>
          <div className="text-mono fw-700 c-y">1M MINE</div>
          <div className="fs-xs c-t3">per mint tx</div>
        </div>
        <div className="text-center p-10 br-10" style={{ background: 'rgba(168,85,247,.05)' }}>
          <div className="fs-85">⚡</div>
          <div className="text-mono fw-700 c-p">5M VIBE</div>
          <div className="fs-xs c-t3">per mint tx</div>
        </div>
      </div>
      <div className="mt-10 c-t3 text-center fs-65">
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
    <div className="m-auto" style={{ maxWidth: 800, padding: '0 12px' }}>
      {/* Header */}
      <div className="text-center" style={{ padding: '20px 0 14px' }}>
        <div className="fs-140 fw-800" style={{ background: 'linear-gradient(135deg, #F7931A, #ffab40)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🛠️ OPNet Developer Tools
        </div>
        <div className="fs-72 c-t3 mt-4">
          Swiss army knife for Bitcoin L1 smart contracts
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-center gap-4 mb-14" role="tablist" aria-label="Developer tools" style={{ overflowX: 'auto', padding: '0 0 12px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        {TOOL_TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
            className="br-12 pointer ws-nowrap fs-70" style={{ padding: '8px 14px', border: 'none', background: activeTab === t.id ? 'linear-gradient(135deg, rgba(247,147,26,.15), rgba(255,171,64,.1))' : 'rgba(255,255,255,.03)', color: activeTab === t.id ? 'var(--o)' : 'var(--t3)', fontWeight: activeTab === t.id ? 700 : 500, transition: '.2s', borderColor: activeTab === t.id ? 'rgba(247,147,26,.2)' : 'transparent' }}>
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
