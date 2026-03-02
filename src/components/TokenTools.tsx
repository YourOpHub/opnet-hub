import React, { useState, useEffect, useCallback } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS } from '../contracts';

/* ═══════════════════════════════════════════════════════════════
   TOOLS — Swiss army knife for OPNet developers & users
   ═══════════════════════════════════════════════════════════════ */

type ToolTab = 'converter' | 'explorer' | 'utxo' | 'tx' | 'block' | 'gas' | 'faucet';

const TOOL_TABS: { id: ToolTab; icon: string; label: string }[] = [
  { id: 'converter', icon: '💱', label: 'Converter' },
  { id: 'explorer', icon: '🔍', label: 'Token Explorer' },
  { id: 'utxo', icon: '📦', label: 'UTXO Viewer' },
  { id: 'tx', icon: '📜', label: 'TX Lookup' },
  { id: 'block', icon: '⛓️', label: 'Block Explorer' },
  { id: 'gas', icon: '⛽', label: 'Gas & Mempool' },
  { id: 'faucet', icon: '🚰', label: 'Faucet' },
];

const monoSm: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace", fontSize: '.68rem', wordBreak: 'break-all' };
const cardS: React.CSSProperties = { background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 16, padding: '16px 18px', marginBottom: 10 };
const rowS: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.72rem' };
const labelS: React.CSSProperties = { color: 'var(--t3)', fontSize: '.68rem' };
const valueS: React.CSSProperties = { ...monoSm, color: '#fff', fontWeight: 600, textAlign: 'right' as const, maxWidth: '60%' };
const btnS: React.CSSProperties = { padding: '8px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #F7931A, #ffab40)', color: '#000', fontWeight: 700, fontSize: '.72rem', transition: '.2s' };
const inputS: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: '#fff', fontSize: '.75rem', fontFamily: "'JetBrains Mono', monospace", outline: 'none', boxSizing: 'border-box' as const };
const copyBtnS: React.CSSProperties = { background: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'var(--t3)', fontSize: '.6rem', padding: '2px 8px', cursor: 'pointer', marginLeft: 6 };

function parseHex(s: string): string {
  if (typeof s !== 'string') return '—';
  if (s.startsWith('0x')) { try { return Number(BigInt(s)).toLocaleString(); } catch { return s; } }
  return s;
}

function formatBigNum(s: string): string {
  try {
    const n = BigInt(s);
    if (n >= BigInt(1e18)) return (Number(n) / 1e18).toFixed(2) + 'e18';
    if (n >= BigInt(1e15)) return (Number(n) / 1e15).toFixed(2) + 'e15';
    if (n >= BigInt(1e12)) return (Number(n) / 1e12).toFixed(2) + 'T';
    if (n >= BigInt(1e9)) return (Number(n) / 1e9).toFixed(2) + 'B';
    if (n >= BigInt(1e6)) return (Number(n) / 1e6).toFixed(2) + 'M';
    if (n >= 1000n) return (Number(n) / 1e3).toFixed(2) + 'K';
    return n.toString();
  } catch { return s; }
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button style={copyBtnS} onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? '✓' : '📋'}
    </button>
  );
}

/* ─── BTC ↔ Sats ↔ USD Converter ─── */
function ConverterTool() {
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
}

/* ─── Known tokens database ─── */
const KNOWN_TOKENS: Record<string, { name: string; symbol: string; decimals: number; type: string }> = {};
for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
  KNOWN_TOKENS[tok.address] = { name: `${sym} Token`, symbol: sym, decimals: tok.decimals, type: 'OP-20 (MintableToken)' };
}

/* ─── Token Explorer ─── */
function TokenExplorer() {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ name: string; symbol: string; decimals: number; supply: string; isContract: boolean; bytecodeLen?: number; type?: string } | null>(null);

  const lookup = useCallback(async () => {
    const a = addr.trim();
    if (!a) return;
    setErr(''); setResult(null); setLoading(true);
    try {
      // Check known tokens first
      const known = KNOWN_TOKENS[a];

      const [code, supply] = await Promise.all([
        opnet.getCode(a, true),
        opnet.getTokenTotalSupply(a).catch(() => 0n),
      ]);
      const isContract = !!code && !!(code as { bytecode?: string }).bytecode;
      const bytecodeLen = isContract && (code as { bytecode?: string }).bytecode ? (code as { bytecode: string }).bytecode.length / 2 : 0;

      if (known) {
        // Known token — use our local database + on-chain supply
        const supplyStr = supply > 0n ? formatBigNum(String(Number(supply) / Math.pow(10, known.decimals))) : '—';
        setResult({ name: known.name, symbol: known.symbol, decimals: known.decimals, supply: supplyStr, isContract: true, bytecodeLen, type: known.type });
      } else if (isContract) {
        // Unknown contract — try OP-20 info from storage
        const info = await opnet.getOP20Info(a);
        if (info && info.name !== 'Unknown' && info.symbol !== '?') {
          setResult({ name: info.name, symbol: info.symbol, decimals: info.decimals, supply: info.totalSupply !== '0' ? formatBigNum(info.totalSupply) : '—', isContract, bytecodeLen, type: 'OP-20' });
        } else {
          const supplyStr = supply > 0n ? formatBigNum(String(supply)) : '—';
          setResult({ name: 'Unknown Contract', symbol: '—', decimals: 8, supply: supplyStr, isContract, bytecodeLen, type: 'Smart Contract' });
          setErr('Contract found. OP-20 metadata not available (may be non-standard).');
        }
      } else {
        setResult({ name: '—', symbol: '—', decimals: 0, supply: '—', isContract: false });
        setErr('No contract found at this address.');
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, [addr]);

  // Auto-lookup when addr changes from button click
  const setAndLookup = useCallback((address: string) => {
    setAddr(address);
    // lookup after state settles
    setTimeout(() => {
      setErr(''); setResult(null); setLoading(true);
      const known = KNOWN_TOKENS[address];
      Promise.all([
        opnet.getCode(address, true),
        opnet.getTokenTotalSupply(address).catch(() => 0n),
      ]).then(([code, supply]) => {
        const isContract = !!code && !!(code as { bytecode?: string }).bytecode;
        const bytecodeLen = isContract && (code as { bytecode?: string }).bytecode ? (code as { bytecode: string }).bytecode.length / 2 : 0;
        if (known) {
          const supplyStr = supply > 0n ? formatBigNum(String(Number(supply) / Math.pow(10, known.decimals))) : '—';
          setResult({ name: known.name, symbol: known.symbol, decimals: known.decimals, supply: supplyStr, isContract: true, bytecodeLen, type: known.type });
        } else if (isContract) {
          setResult({ name: 'Unknown', symbol: '—', decimals: 8, supply: supply > 0n ? formatBigNum(String(supply)) : '—', isContract, bytecodeLen, type: 'Smart Contract' });
        } else {
          setResult({ name: '—', symbol: '—', decimals: 0, supply: '—', isContract: false });
          setErr('No contract at this address.');
        }
      }).catch(e => setErr(e instanceof Error ? e.message : 'Failed'))
        .finally(() => setLoading(false));
    }, 100);
  }, []);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...inputS, flex: 1 }} value={addr} onChange={e => setAddr(e.target.value)} placeholder="Contract address (opt1sq...)" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Explore'}</button>
      </div>
      {/* Quick links to known tokens */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => (
          <button key={sym} onClick={() => setAndLookup(tok.address)}
            style={{ padding: '4px 12px', fontSize: '.62rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', background: addr === tok.address ? 'rgba(247,147,26,.1)' : 'rgba(255,255,255,.03)', color: addr === tok.address ? 'var(--o)' : 'var(--t3)', cursor: 'pointer', fontWeight: 600 }}>
            {tok.icon} {sym}
          </button>
        ))}
      </div>
      {err && <div style={{ fontSize: '.72rem', color: err.includes('not available') ? 'var(--y)' : 'var(--r)', marginBottom: 8 }}>{err}</div>}
      {result && (
        <div>
          {[
            ['Name', result.name, 'var(--o)'],
            ['Symbol', result.symbol, 'var(--c)'],
            ['Type', result.type || (result.isContract ? 'Smart Contract' : 'Not a contract'), result.isContract ? 'var(--g)' : 'var(--r)'],
            ['Decimals', String(result.decimals), '#fff'],
            ['Total Supply', result.supply, '#fff'],
            ...(result.bytecodeLen ? [['Bytecode Size', `${result.bytecodeLen.toLocaleString()} bytes`, 'var(--t2)']] : []),
          ].map(([k, v, c]) => (
            <div key={k} style={rowS}>
              <span style={labelS}>{k}</span>
              <span style={{ ...valueS, color: c as string }}>{v}</span>
            </div>
          ))}
          {result.isContract && <div style={{ marginTop: 8, textAlign: 'center' }}>
            <a href={`https://testnet.opscan.org/contract/${addr.trim()}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '.65rem', color: 'var(--c)', textDecoration: 'none' }}>View on OPScan →</a>
          </div>}
        </div>
      )}
    </div>
  );
}

/* ─── UTXO Viewer ─── */
function UTXOViewer() {
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
}

/* ─── Transaction Lookup ─── */
function TXLookup() {
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<Record<string, unknown> | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);

  // Load recent pending txs on mount
  useEffect(() => {
    opnet.getLatestPendingTxs(5).then(r => setPending(r)).catch(() => {});
  }, []);

  const lookup = useCallback(async () => {
    const h = txHash.trim();
    if (!h) return;
    setErr(''); setTx(null); setReceipt(null); setLoading(true);
    try {
      // Try OPNet RPC first
      const [t, r] = await Promise.all([
        opnet.getTransaction(h),
        opnet.getTransactionReceipt(h),
      ]);
      if (t || r) {
        setTx(t);
        setReceipt(r);
      } else {
        // Not found in OPNet — might be a plain Bitcoin TX
        setErr(`Transaction not found in OPNet. This may be a regular Bitcoin TX. Check on a Bitcoin explorer.`);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, [txHash]);

  const renderObj = (obj: Record<string, unknown>, depth = 0) => {
    if (depth > 3) return <span style={{ ...monoSm, color: 'var(--t4)' }}>[nested]</span>;
    return Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => (
      <div key={k} style={{ ...rowS, paddingLeft: depth * 12 }}>
        <span style={labelS}>{k}</span>
        {typeof v === 'object' && !Array.isArray(v) ? (
          <div style={{ width: '60%' }}>{renderObj(v as Record<string, unknown>, depth + 1)}</div>
        ) : Array.isArray(v) ? (
          <span style={{ ...valueS, fontSize: '.6rem' }}>[{v.length} items]</span>
        ) : (
          <span style={valueS}>
            {String(v).length > 40 ? String(v).slice(0, 20) + '...' + String(v).slice(-16) : String(v)}
            {String(v).length > 10 && <CopyBtn text={String(v)} />}
          </span>
        )}
      </div>
    ));
  };

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...inputS, flex: 1 }} value={txHash} onChange={e => setTxHash(e.target.value)} placeholder="OPNet transaction hash" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Lookup'}</button>
      </div>
      {err && (
        <div style={{ fontSize: '.72rem', marginBottom: 8, padding: '8px 12px', borderRadius: 10 , background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.12)', color: 'var(--y)' }}>
          {err}
          {txHash.trim().length === 64 && (
            <a href={`https://mempool.space/signet/tx/${txHash.trim()}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', marginTop: 4, color: 'var(--c)', fontSize: '.65rem' }}>
              Check on Mempool.space (Signet) ↗
            </a>
          )}
        </div>
      )}
      {tx && (
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--o)', fontWeight: 700, marginBottom: 6 }}>Transaction</div>
          {renderObj(tx)}
        </div>
      )}
      {receipt && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--g)', fontWeight: 700, marginBottom: 6 }}>Receipt</div>
          {renderObj(receipt)}
        </div>
      )}
      {/* Recent pending TXs from mempool */}
      {!tx && !receipt && !err && pending.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--c)', fontWeight: 700, marginBottom: 6 }}>Recent Pending TXs (Mempool)</div>
          {pending.map((p, i) => {
            const hash = String(p.hash || p.id || p.transactionId || '');
            return (
              <div key={i} style={{ ...rowS, cursor: 'pointer' }} onClick={() => { setTxHash(hash); }}>
                <span style={{ ...monoSm, color: 'var(--c)', flex: 1 }}>{hash.slice(0, 20)}...{hash.slice(-8)}</span>
                <span style={{ ...monoSm, color: 'var(--t4)', fontSize: '.55rem' }}>{p.from ? String(p.from).slice(0, 10) + '...' : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Block Explorer with visual chain ─── */
function BlockExplorer() {
  const [blockNum, setBlockNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [block, setBlock] = useState<Record<string, unknown> | null>(null);
  const [latestHeight, setLatestHeight] = useState(0);
  const [recentBlocks, setRecentBlocks] = useState<Array<{ num: number; txCount: number; hash: string }>>([]);
  const [err, setErr] = useState('');
  const [mempool, setMempool] = useState<{ count?: number; opnetCount?: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const h = await opnet.getBlockHeight().catch(() => 0);
      if (h > 0) {
        setLatestHeight(h);
        setBlockNum(String(h));
        // Load last 8 blocks for visual chain
        const blocks: Array<{ num: number; txCount: number; hash: string }> = [];
        for (let i = h; i > Math.max(0, h - 8); i--) {
          const b = await opnet.getBlockByNumber(i, false).catch(() => null);
          if (b) {
            const txs = Array.isArray(b.transactions) ? (b.transactions as unknown[]).length : 0;
            blocks.push({ num: i, txCount: txs, hash: String(b.hash || b.blockHash || '') });
          }
        }
        setRecentBlocks(blocks);
      }
      const mp = await opnet.getMempoolInfo().catch(() => null);
      if (mp) setMempool(mp);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  const lookup = useCallback(async () => {
    if (!blockNum.trim()) return;
    setErr(''); setBlock(null); setLoading(true);
    try {
      const num = parseInt(blockNum.trim());
      if (isNaN(num) || num < 0) { setErr('Invalid block number'); return; }
      const b = await opnet.getBlockByNumber(num, true);
      if (!b) { setErr('Block not found'); return; }
      setBlock(b);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, [blockNum]);

  const renderVal = (k: string, v: unknown): React.ReactNode => {
    if (v === null || v === undefined) return null;
    const sv = String(v);
    return (
      <div key={k} style={rowS}>
        <span style={labelS}>{k}</span>
        <span style={valueS}>
          {sv.length > 50 ? sv.slice(0, 20) + '...' + sv.slice(-16) : sv.startsWith('0x') && sv.length > 10 ? parseHex(sv) + ` (${sv.slice(0, 10)}...)` : sv}
          {sv.length > 10 && <CopyBtn text={sv} />}
        </span>
      </div>
    );
  };

  return (
    <div style={cardS}>
      {/* Visual block chain */}
      {recentBlocks.length > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 0' }}>
          <div style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Block Chain</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
            {/* Mempool (next block) */}
            {mempool && (
              <>
                <div style={{
                  minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center',
                  background: 'rgba(245,158,11,.08)', border: '1px dashed rgba(245,158,11,.3)',
                  cursor: 'default', transition: '.2s',
                }}>
                  <div style={{ fontSize: '.5rem', color: 'var(--y)', fontWeight: 600, marginBottom: 2 }}>PENDING</div>
                  <div style={{ ...monoSm, fontWeight: 700, color: 'var(--y)', fontSize: '.7rem' }}>{mempool.opnetCount ?? mempool.count ?? '?'}</div>
                  <div style={{ fontSize: '.45rem', color: 'var(--t4)' }}>txs</div>
                </div>
                <div style={{ color: 'var(--t4)', fontSize: '.8rem', padding: '0 2px' }}>...</div>
              </>
            )}
            {recentBlocks.map((b, i) => {
              const isLatest = i === 0;
              const selected = blockNum === String(b.num);
              const barH = Math.max(20, Math.min(60, b.txCount * 8 + 20));
              return (
                <div key={b.num} onClick={() => { setBlockNum(String(b.num)); setBlock(null); }}
                  style={{
                    minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                    background: selected ? 'rgba(247,147,26,.12)' : isLatest ? 'rgba(16,185,129,.06)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${selected ? 'rgba(247,147,26,.3)' : isLatest ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)'}`,
                    transition: '.2s',
                  }}>
                  <div style={{ fontSize: '.5rem', color: isLatest ? 'var(--g)' : 'var(--t4)', fontWeight: 600, marginBottom: 2 }}>
                    {isLatest ? 'LATEST' : `#${b.num.toLocaleString()}`}
                  </div>
                  <div style={{
                    width: '100%', height: barH, borderRadius: 4, marginBottom: 4,
                    background: `linear-gradient(180deg, ${isLatest ? 'rgba(16,185,129,.3)' : 'rgba(14,165,233,.2)'}, transparent)`,
                  }} />
                  <div style={{ ...monoSm, fontWeight: 700, color: '#fff', fontSize: '.7rem' }}>
                    {isLatest ? `#${b.num.toLocaleString()}` : `${b.txCount}`}
                  </div>
                  <div style={{ fontSize: '.45rem', color: 'var(--t4)' }}>{b.txCount} txs</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button onClick={() => { const n = Math.max(0, parseInt(blockNum) - 1); setBlockNum(String(n)); setBlock(null); }} style={{ ...copyBtnS, fontSize: '.75rem', padding: '6px 10px' }}>&lt;</button>
        <input style={{ ...inputS, flex: 1, textAlign: 'center' }} type="number" value={blockNum} onChange={e => setBlockNum(e.target.value)} placeholder="Block number" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button onClick={() => { const n = parseInt(blockNum) + 1; if (n <= latestHeight) { setBlockNum(String(n)); setBlock(null); } }} style={{ ...copyBtnS, fontSize: '.75rem', padding: '6px 10px' }}>&gt;</button>
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Fetch'}</button>
      </div>
      {latestHeight > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => { setBlockNum(String(latestHeight)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>Latest (#{latestHeight.toLocaleString()})</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 10)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>-10</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 100)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>-100</button>
        </div>
      )}
      {err && <div style={{ fontSize: '.72rem', color: 'var(--r)', marginBottom: 8 }}>{err}</div>}
      {block && (
        <div>
          {Object.entries(block).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => (
            <React.Fragment key={k}>{renderVal(k, v)}</React.Fragment>
          ))}
          {Array.isArray(block.transactions) && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '.68rem', color: 'var(--c)', fontWeight: 700, marginBottom: 4 }}>Transactions ({(block.transactions as Array<unknown>).length})</div>
              {(block.transactions as Array<Record<string, string>>).slice(0, 20).map((tx, i) => {
                const txHash = String(tx.hash ?? tx.id ?? i);
                const txFrom = tx.from ? String(tx.from) : '';
                return (
                  <div key={i} style={{ ...rowS, fontSize: '.6rem' }}>
                    <span style={{ ...monoSm, color: 'var(--c)', fontSize: '.58rem' }}>{txHash.slice(0, 16)}...</span>
                    {txFrom && <span style={{ ...monoSm, color: 'var(--t3)', fontSize: '.55rem' }}>from: {txFrom.slice(0, 10)}...</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Gas & Mempool ─── */
function GasTool() {
  const [network, setNetwork] = useState<opnet.Network>(opnet.getNetwork());
  const [gas, setGas] = useState<opnet.GasParams | null>(null);
  const [mempool, setMempool] = useState<{ count?: number; opnetCount?: number; sizeBytes?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { opnet.setNetwork(network); }, [network]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, m] = await Promise.all([opnet.getGasParameters(), opnet.getMempoolInfo().catch(() => null)]);
      setGas(g || null);
      setMempool(m || null);
    } catch { setGas(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 15000); return () => clearInterval(iv); }, [network, refresh]);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['regtest', 'testnet', 'mainnet'] as const).map(n => (
            <button key={n} className={`fbn ${network === n ? 'on' : ''}`} style={{ padding: '4px 12px', fontSize: '.65rem' }} onClick={() => setNetwork(n)}>{n}</button>
          ))}
        </div>
        <button onClick={refresh} style={{ ...copyBtnS, padding: '4px 10px' }}>{loading ? '⏳' : '🔄'}</button>
      </div>
      {gas ? (
        <div>
          {[
            ['Block Height', gas.blockNumber ? parseHex(gas.blockNumber) : '—', 'var(--o)'],
            ['Base Gas', gas.baseGas ? parseHex(gas.baseGas) : '—', 'var(--c)'],
            ['Gas/Sat', gas.gasPerSat ? parseHex(gas.gasPerSat) : '—', 'var(--p)'],
            ['Conservative Fee', `${gas.bitcoin?.conservative ?? '—'} sat/vB`, '#fff'],
          ].map(([k, v, c]) => (
            <div key={k} style={rowS}><span style={labelS}>{k}</span><span style={{ ...valueS, color: c as string }}>{v}</span></div>
          ))}
          {gas.bitcoin?.recommended && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              {[
                ['Low', gas.bitcoin.recommended.low, 'var(--g)'],
                ['Medium', gas.bitcoin.recommended.medium, 'var(--o)'],
                ['High', gas.bitcoin.recommended.high, 'var(--r)'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: 'center', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 10 }}>
                  <div style={{ ...monoSm, fontWeight: 700, color: c as string }}>{v}</div>
                  <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>{l} sat/vB</div>
                </div>
              ))}
            </div>
          )}
          {mempool && (
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(14,165,233,.04)', borderRadius: 10 }}>
              <div style={{ fontSize: '.65rem', color: 'var(--c)', fontWeight: 700, marginBottom: 4 }}>Mempool</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {mempool.count != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{mempool.count}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Pending TXs</div></div>}
                {mempool.opnetCount != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700, color: 'var(--o)' }}>{mempool.opnetCount}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>OPNet TXs</div></div>}
                {mempool.sizeBytes != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{(mempool.sizeBytes / 1024 / 1024).toFixed(1)} MB</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Size</div></div>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)' }}>{loading ? '⏳ Loading…' : 'Failed to load gas parameters'}</div>
      )}
    </div>
  );
}

/* ─── Faucet ─── */
function FaucetTool() {
  const [addr, setAddr] = useState('');
  const [token, setToken] = useState<'MINE' | 'VIBE'>('MINE');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const FAUCET_URL = 'http://188.137.250.160:3456';

  const claim = useCallback(async () => {
    if (!addr.trim()) return;
    setStatus('loading'); setMsg('');
    try {
      const res = await fetch(`${FAUCET_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.toLowerCase(), address: addr.trim() }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (data.error) { setMsg(data.error); setStatus('error'); }
      else { setMsg(`Claimed ${token === 'MINE' ? '100K MINE' : '500K VIBE'}! TX should confirm in ~30s.`); setStatus('done'); }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Faucet error');
      setStatus('error');
    }
  }, [addr, token]);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: '.75rem', color: 'var(--t2)' }}>Get testnet tokens:</span>
        {(['MINE', 'VIBE'] as const).map(t => (
          <button key={t} className={`fbn ${token === t ? 'on' : ''}`} style={{ padding: '5px 14px', fontSize: '.7rem' }} onClick={() => setToken(t)}>
            {t === 'MINE' ? '⛏️' : '🌊'} {t}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...inputS, flex: 1 }} value={addr} onChange={e => setAddr(e.target.value)} placeholder="Your OPNet address (opt1sq...)" onKeyDown={e => e.key === 'Enter' && claim()} />
        <button style={{ ...btnS, opacity: status === 'loading' ? .6 : 1 }} onClick={claim} disabled={status === 'loading'}>
          {status === 'loading' ? '⏳' : '🚰 Claim'}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: '.72rem', color: status === 'done' ? 'var(--g)' : 'var(--r)', padding: '8px 12px', background: status === 'done' ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)', borderRadius: 10, marginTop: 4 }}>
          {msg}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div style={{ padding: 10, background: 'rgba(234,179,8,.05)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '.85rem' }}>⛏️</div>
          <div style={{ ...monoSm, fontWeight: 700, color: 'var(--y)' }}>100K MINE</div>
          <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>per claim · 5min cooldown</div>
        </div>
        <div style={{ padding: 10, background: 'rgba(14,165,233,.05)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '.85rem' }}>🌊</div>
          <div style={{ ...monoSm, fontWeight: 700, color: 'var(--c)' }}>500K VIBE</div>
          <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>per claim · 5min cooldown</div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: '.55rem', color: 'var(--t4)', textAlign: 'center' }}>
        Faucet runs on VPS · Tokens minted via OP-20 publicMint on Bitcoin L1
      </div>
    </div>
  );
}

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
      {activeTab === 'tx' && <TXLookup />}
      {activeTab === 'block' && <BlockExplorer />}
      {activeTab === 'gas' && <GasTool />}
      {activeTab === 'faucet' && <FaucetTool />}
    </div>
  );
};

export default TokenTools;
