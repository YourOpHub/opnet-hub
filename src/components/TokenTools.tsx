import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, ABIDataTypes, BitcoinAbiTypes, type BitcoinInterfaceAbi, type CallResult, type BaseContractProperties, type TransactionParameters } from 'opnet';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, POOL_ADDRESS, POOL_PUBKEY } from '../contracts';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { buildTxParams, formatTxError, waitForNextBlock } from '../txUtils';

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
interface OPScanToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: number;
  maxSupply: number;
  isPool: boolean;
  deployer: string;
  holders?: number;
}

type TokenSortKey = 'symbol' | 'supply' | 'holders';

function TokenExplorer() {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ name: string; symbol: string; decimals: number; supply: string; isContract: boolean; bytecodeLen?: number; type?: string; holders?: number } | null>(null);

  // OPScan token list
  const [allTokens, setAllTokens] = useState<OPScanToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [sortKey, setSortKey] = useState<TokenSortKey>('holders');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterText, setFilterText] = useState('');

  // Fetch all tokens from OPScan
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('https://api.opscan.org/v1/op_testnet/tokens');
        if (!resp.ok) throw new Error('OPScan API error');
        const data = await resp.json();
        const results = data?.results || data || [];
        if (!Array.isArray(results)) return;
        const tokens: OPScanToken[] = [];
        for (const t of results) {
          const meta = t.op20Metadata || {};
          if (!meta.symbol) continue;
          const dec = meta.decimals || 8;
          tokens.push({
            address: String(t.address || '').replace('0x', ''),
            symbol: meta.symbol,
            name: meta.name || meta.symbol,
            decimals: dec,
            totalSupply: Number(meta.totalSupply || 0) / Math.pow(10, dec),
            maxSupply: Number(meta.maximumSupply || 0) / Math.pow(10, dec),
            isPool: !!meta.isPool,
            deployer: t.deployerAddress || '',
            holders: undefined,
          });
        }
        setAllTokens(tokens);
        // Fetch holder counts in parallel (batch of 5)
        const batch = async (items: OPScanToken[], batchSize: number) => {
          for (let i = 0; i < items.length; i += batchSize) {
            const chunk = items.slice(i, i + batchSize);
            const counts = await Promise.all(chunk.map(async (tok) => {
              try {
                const hex = tok.address.startsWith('0x') ? tok.address : '0x' + tok.address;
                const r = await fetch(`https://api.opscan.org/v1/op_testnet/tokens/${hex}/holders`);
                if (!r.ok) return 0;
                const d = await r.json();
                const arr = d?.results || d || [];
                return Array.isArray(arr) ? arr.length : 0;
              } catch { return 0; }
            }));
            setAllTokens(prev => {
              const next = [...prev];
              for (let j = 0; j < chunk.length; j++) {
                const idx = next.findIndex(t => t.address === chunk[j].address);
                if (idx >= 0) next[idx] = { ...next[idx], holders: counts[j] };
              }
              return next;
            });
          }
        };
        batch(tokens, 5);
      } catch (e) { console.warn('[TokenExplorer] OPScan fetch failed:', e); }
      finally { setTokensLoading(false); }
    })();
  }, []);

  // Sort & filter
  const sortedTokens = useMemo(() => {
    let list = allTokens;
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'symbol') {
        const cmp = a.symbol.localeCompare(b.symbol);
        return sortAsc ? cmp : -cmp;
      } else if (sortKey === 'supply') {
        av = a.totalSupply; bv = b.totalSupply;
      } else {
        av = a.holders ?? -1; bv = b.holders ?? -1;
      }
      return sortAsc ? av - bv : bv - av;
    });
  }, [allTokens, sortKey, sortAsc, filterText]);

  const toggleSort = (key: TokenSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Lookup single token
  const lookupAddr = useCallback(async (a: string) => {
    if (!a) return;
    setAddr(a); setErr(''); setResult(null); setLoading(true);
    try {
      const known = KNOWN_TOKENS[a];
      const [code, supply] = await Promise.all([
        opnet.getCode(a, true),
        opnet.getTokenTotalSupply(a).catch(() => 0n),
      ]);
      const isContract = !!code && !!(code as { bytecode?: string }).bytecode;
      const bytecodeLen = isContract && (code as { bytecode?: string }).bytecode ? (code as { bytecode: string }).bytecode.length / 2 : 0;

      // Try to get holder count from OPScan
      let holders: number | undefined;
      const hexAddr = a.startsWith('0x') ? a : (a.startsWith('opt1sq') ? undefined : '0x' + a);
      if (hexAddr) {
        try {
          const hr = await fetch(`https://api.opscan.org/v1/op_testnet/tokens/${hexAddr}/holders`);
          if (hr.ok) {
            const hd = await hr.json();
            const arr = hd?.results || hd || [];
            if (Array.isArray(arr)) holders = arr.length;
          }
        } catch { /* */ }
      }

      if (known) {
        const num = Number(supply) / Math.pow(10, known.decimals);
        const supplyStr = num > 0 ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : (supply > 0n ? formatBigNum(String(supply)) : '0');
        setResult({ name: known.name, symbol: known.symbol, decimals: known.decimals, supply: supplyStr, isContract: true, bytecodeLen, type: known.type, holders });
      } else if (isContract) {
        const info = await opnet.getOP20Info(a);
        if (info && info.name !== 'Unknown' && info.symbol !== '?') {
          const supStr = info.totalSupply !== '0' ? formatBigNum(info.totalSupply) : '0';
          setResult({ name: info.name, symbol: info.symbol, decimals: info.decimals, supply: supStr, isContract, bytecodeLen, type: 'OP-20', holders });
        } else {
          const supplyStr = supply > 0n ? formatBigNum(String(supply)) : '0';
          setResult({ name: 'Unknown Contract', symbol: '\u2014', decimals: 8, supply: supplyStr, isContract, bytecodeLen, type: 'Smart Contract', holders });
          setErr('Contract found. OP-20 metadata not available (may be non-standard).');
        }
      } else {
        setResult({ name: '\u2014', symbol: '\u2014', decimals: 0, supply: '\u2014', isContract: false });
        setErr('No contract found at this address.');
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, []);

  const sortArrow = (key: TokenSortKey) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div>
      {/* Search by address */}
      <div style={cardS}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input style={{ ...inputS, flex: 1 }} value={addr} onChange={e => setAddr(e.target.value)} placeholder="Contract address (opt1sq... or 0x...)" onKeyDown={e => e.key === 'Enter' && lookupAddr(addr.trim())} />
          <button style={btnS} onClick={() => lookupAddr(addr.trim())} disabled={loading}>{loading ? '...' : 'Explore'}</button>
        </div>
        {/* Quick links to known tokens */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => (
            <button key={sym} onClick={() => lookupAddr(tok.address)}
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
              ...(result.holders !== undefined ? [['Holders', String(result.holders), 'var(--c)']] : []),
              ...(result.bytecodeLen ? [['Bytecode Size', `${result.bytecodeLen.toLocaleString()} bytes`, 'var(--t2)']] : []),
            ].map(([k, v, c]) => (
              <div key={k} style={rowS}>
                <span style={labelS}>{k}</span>
                <span style={{ ...valueS, color: c as string }}>{v}</span>
              </div>
            ))}
            {result.isContract && <div style={{ marginTop: 8, textAlign: 'center' }}>
              <a href={`https://testnet.opscan.org/contract/${addr.trim()}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '.65rem', color: 'var(--c)', textDecoration: 'none' }}>View on OPScan \u2192</a>
            </div>}
          </div>
        )}
      </div>

      {/* All tokens from OPScan */}
      <div style={{ ...cardS, marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: '.82rem' }}>All Tokens ({allTokens.length})</div>
          <input style={{ ...inputS, width: 180, fontSize: '.65rem', padding: '6px 10px' }}
            placeholder="Filter by name or symbol..."
            value={filterText} onChange={e => setFilterText(e.target.value)} />
        </div>
        {tokensLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)', fontSize: '.76rem' }}>Loading tokens from OPScan...</div>
        ) : sortedTokens.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)', fontSize: '.76rem' }}>No tokens found</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--t3)', cursor: 'pointer', fontWeight: 600, fontSize: '.66rem' }}
                    onClick={() => toggleSort('symbol')}>Token{sortArrow('symbol')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--t3)', cursor: 'pointer', fontWeight: 600, fontSize: '.66rem' }}
                    onClick={() => toggleSort('supply')}>Total Supply{sortArrow('supply')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--t3)', cursor: 'pointer', fontWeight: 600, fontSize: '.66rem' }}
                    onClick={() => toggleSort('holders')}>Holders{sortArrow('holders')}</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--t3)', fontWeight: 600, fontSize: '.66rem' }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {sortedTokens.map(t => (
                  <tr key={t.address}
                    onClick={() => lookupAddr(t.address)}
                    style={{ borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer', transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--w)' }}>{t.symbol}</div>
                        <div style={{ fontSize: '.62rem', color: 'var(--t4)' }}>{t.name}</div>
                      </div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--fm)', color: 'var(--t2)' }}>
                      {t.totalSupply >= 1e9 ? (t.totalSupply / 1e9).toFixed(2) + 'B' :
                        t.totalSupply >= 1e6 ? (t.totalSupply / 1e6).toFixed(2) + 'M' :
                        t.totalSupply >= 1e3 ? (t.totalSupply / 1e3).toFixed(1) + 'K' :
                        t.totalSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--fm)', color: t.holders !== undefined ? 'var(--c)' : 'var(--t4)' }}>
                      {t.holders !== undefined ? t.holders : '\u2014'}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: '.58rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: t.isPool ? 'rgba(139,92,246,.12)' : 'rgba(34,197,94,.12)',
                        color: t.isPool ? '#8b5cf6' : '#22c55e',
                      }}>
                        {t.isPool ? 'Pool' : 'OP-20'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
        for (let i = h; i > Math.max(0, h - 15); i--) {
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
                <div key={b.num} onClick={() => { setBlockNum(String(b.num)); setBlock(null); setTimeout(() => { setLoading(true); opnet.getBlockByNumber(b.num, true).then(bl => { if (bl) setBlock(bl); }).catch(() => {}).finally(() => setLoading(false)); }, 0); }}
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

/* ─── UTXO Splitter ─── */
function UTXOSplitter() {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

  const [utxos, setUtxos] = useState<Array<{ transactionId: string; outputIndex: number; value: string | number }>>([]);
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [splitCount, setSplitCount] = useState(5);
  const [splitting, setSplitting] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [selectedUtxo, setSelectedUtxo] = useState<number | null>(null); // index into utxos array

  // Fetch UTXOs on mount when wallet connected
  const fetchUTXOs = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const [u, b] = await Promise.all([
        opnet.getUTXOs(walletAddress),
        opnet.getBalance(walletAddress),
      ]);
      setUtxos(u);
      setBalance(b);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to fetch UTXOs'); }
    finally { setLoading(false); }
  }, [walletAddress]);

  useEffect(() => { fetchUTXOs(); }, [fetchUTXOs]);

  const getUtxoValue = (u: { value: string | number }) => {
    const v = typeof u.value === 'string' ? (u.value.startsWith('0x') ? Number(BigInt(u.value)) : Number(u.value)) : u.value;
    return v;
  };

  const totalSats = utxos.reduce((s, u) => s + getUtxoValue(u), 0);

  // If a specific UTXO is selected, split only that one
  const splitSats = selectedUtxo !== null && utxos[selectedUtxo] ? getUtxoValue(utxos[selectedUtxo]) : totalSats;

  // Estimate: 250 vB overhead + 43 vB per output, at 2 sat/vB
  const estimatedFee = (250 + splitCount * 43) * 2;
  const perSplitSats = splitSats > estimatedFee ? Math.floor((splitSats - estimatedFee) / splitCount) : 0;
  const isDust = perSplitSats < 546;

  // We use a dummy contract call with extraOutputs to create a self-transfer
  // The simplest approach: call the pool's getReserves (a view call that won't change state)
  // and attach extraOutputs that split BTC to self
  const handleSplit = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (isDust || perSplitSats <= 0 || splitCount < 2) return;

    setSplitting(true); setErr(''); setStep('Preparing UTXO split...');
    try {
      // Build a dummy view call to SimplePool getReserves
      // This is a read-only call that will succeed, we just need the tx infrastructure
      // to attach extraOutputs for the split
      const dummyABI: BitcoinInterfaceAbi = [{
        name: 'getReserves', type: BitcoinAbiTypes.Function,
        inputs: [], outputs: [
          { name: 'reserveA', type: ABIDataTypes.UINT256 },
          { name: 'reserveB', type: ABIDataTypes.UINT256 },
        ],
      }];

      // Use pool contract if available, otherwise use any known contract
      const targetContract = POOL_ADDRESS || TESTNET_CONTRACTS.MINE.address;
      interface IReservesContract extends BaseContractProperties {
        getReserves(): Promise<CallResult>;
      }
      const contract = getContract<IReservesContract>(targetContract, dummyABI, provider, NETWORK, senderAddr);

      setStep(`Simulating split into ${splitCount} UTXOs...`);
      const sim = await contract.getReserves();
      if ((sim as CallResult).revert) throw new Error(`Simulation failed: ${(sim as CallResult).revert}`);

      // Build extraOutputs: N-1 outputs to self (the change output is the Nth)
      const tp = await buildTxParams(provider, walletAddress);
      const extraOutputs = [];
      for (let i = 0; i < splitCount - 1; i++) {
        extraOutputs.push({
          address: walletAddress,
          value: BigInt(perSplitSats),
        });
      }
      (tp as unknown as Record<string, unknown>).extraOutputs = extraOutputs;
      // Increase max spend to cover the selected UTXO(s)
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = BigInt(splitSats);

      setStep(`Sending split tx (${splitCount} UTXOs of ~${perSplitSats.toLocaleString()} sats)...`);
      await (sim as CallResult).sendTransaction(tp);

      setStep('');
      setErr('');

      // Wait for confirmation then refresh
      setStep('Waiting for block confirmation...');
      await waitForNextBlock(provider, setStep, 90_000);
      setStep('');
      fetchUTXOs();
    } catch (e) {
      setErr(formatTxError(e));
      setStep('');
    } finally { setSplitting(false); }
  }, [walletAddress, senderAddr, splitCount, perSplitSats, isDust, totalSats, provider, openConnectModal, fetchUTXOs]);

  return (
    <div style={cardS}>
      {!walletAddress ? (
        <div style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>✂️</div>
          <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: 6 }}>UTXO Splitter</div>
          <p style={{ fontSize: '.72rem', color: 'var(--t3)', marginBottom: 12, maxWidth: 400, margin: '0 auto 12px' }}>
            Split your BTC into multiple UTXOs for parallel transactions.
            Useful when you need to submit multiple OPNet operations quickly.
          </p>
          <button style={btnS} onClick={openConnectModal}>Connect Wallet</button>
        </div>
      ) : (
        <>
          {/* Current UTXO status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            <div style={{ textAlign: 'center', padding: 10, background: 'rgba(247,147,26,.06)', borderRadius: 12 }}>
              <div style={{ ...monoSm, fontWeight: 700, color: 'var(--o)' }}>{(totalSats / 1e8).toFixed(6)}</div>
              <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>BTC Balance</div>
            </div>
            <div style={{ textAlign: 'center', padding: 10, background: 'rgba(14,165,233,.06)', borderRadius: 12 }}>
              <div style={{ ...monoSm, fontWeight: 700, color: 'var(--c)' }}>{utxos.length}</div>
              <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Current UTXOs</div>
            </div>
            <div style={{ textAlign: 'center', padding: 10, background: 'rgba(167,139,250,.06)', borderRadius: 12 }}>
              <div style={{ ...monoSm, fontWeight: 700, color: 'var(--p)' }}>{totalSats.toLocaleString()}</div>
              <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Total Sats</div>
            </div>
          </div>

          {/* Visual UTXO grid */}
          {utxos.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: '.68rem', fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
                Your UTXOs {selectedUtxo !== null ? `(#${selectedUtxo + 1} selected)` : '(click to select)'}
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {utxos.map((u, i) => {
                  const v = getUtxoValue(u);
                  const maxV = Math.max(...utxos.map(getUtxoValue));
                  const size = Math.max(36, Math.min(80, 36 + (v / maxV) * 44));
                  const isSelected = selectedUtxo === i;
                  return (
                    <div key={`${u.transactionId}:${u.outputIndex}`}
                      onClick={() => setSelectedUtxo(isSelected ? null : i)}
                      style={{
                        width: size, height: size, borderRadius: 8, cursor: 'pointer',
                        background: isSelected ? 'rgba(247,147,26,.2)' : 'rgba(255,255,255,.04)',
                        border: `2px solid ${isSelected ? 'var(--o)' : 'rgba(255,255,255,.08)'}`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        transition: 'all .15s', fontSize: '.52rem', color: isSelected ? 'var(--o)' : 'var(--t3)',
                      }}>
                      <div style={{ fontWeight: 700, fontSize: '.56rem', fontFamily: "'JetBrains Mono', monospace" }}>
                        {v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v}
                      </div>
                      <div style={{ fontSize: '.44rem', color: 'var(--t4)' }}>sats</div>
                    </div>
                  );
                })}
              </div>
              {selectedUtxo !== null && (
                <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 4 }}>
                  Splitting UTXO #{selectedUtxo + 1}: {getUtxoValue(utxos[selectedUtxo]).toLocaleString()} sats
                </div>
              )}
              {selectedUtxo === null && utxos.length > 1 && (
                <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 4 }}>
                  No UTXO selected — will split all ({totalSats.toLocaleString()} sats)
                </div>
              )}
            </div>
          )}

          {/* Split controls */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: '.7rem', fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
              Split into {splitCount} UTXOs
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="range" min="2" max="20" value={splitCount}
                onChange={e => setSplitCount(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: '#F7931A' }} />
              <input type="number" min="2" max="20" value={splitCount}
                onChange={e => setSplitCount(Math.min(20, Math.max(2, parseInt(e.target.value) || 2)))}
                style={{ ...inputS, width: 60, textAlign: 'center', padding: '6px 8px' }} />
            </div>
          </div>

          {/* Preview */}
          <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,.03)', borderRadius: 12, marginBottom: 12, border: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ fontSize: '.72rem', color: 'var(--t2)', marginBottom: 6, fontWeight: 600 }}>Preview</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '.72rem' }}>
              <span style={{ color: 'var(--t3)' }}>Total balance:</span>
              <span style={{ ...monoSm, fontWeight: 700, textAlign: 'right' }}>{totalSats.toLocaleString()} sats</span>
              <span style={{ color: 'var(--t3)' }}>Est. fee:</span>
              <span style={{ ...monoSm, fontWeight: 700, textAlign: 'right', color: 'var(--y)' }}>~{estimatedFee.toLocaleString()} sats</span>
              <span style={{ color: 'var(--t3)' }}>Per UTXO:</span>
              <span style={{ ...monoSm, fontWeight: 700, textAlign: 'right', color: isDust ? 'var(--r)' : 'var(--g)' }}>
                ~{perSplitSats.toLocaleString()} sats
              </span>
            </div>
            {isDust && (
              <div style={{ marginTop: 8, fontSize: '.68rem', color: 'var(--r)', fontWeight: 600 }}>
                Per-UTXO amount below dust limit (546 sats). Reduce split count.
              </div>
            )}
          </div>

          {/* Quick presets */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[2, 3, 5, 8, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setSplitCount(n)}
                style={{
                  padding: '4px 10px', fontSize: '.62rem', borderRadius: 8, cursor: 'pointer',
                  border: splitCount === n ? '1px solid rgba(247,147,26,.4)' : '1px solid rgba(255,255,255,.08)',
                  background: splitCount === n ? 'rgba(247,147,26,.12)' : 'rgba(255,255,255,.03)',
                  color: splitCount === n ? 'var(--o)' : 'var(--t3)', fontWeight: 600,
                }}>
                {n}x
              </button>
            ))}
          </div>

          {step && (
            <div style={{ fontSize: '.72rem', color: 'var(--o)', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
              {step}
            </div>
          )}
          {err && (
            <div style={{ fontSize: '.72rem', color: 'var(--r)', marginBottom: 8 }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...btnS, flex: 1, opacity: splitting || isDust || perSplitSats <= 0 ? 0.5 : 1 }}
              disabled={splitting || isDust || perSplitSats <= 0 || loading}
              onClick={handleSplit}>
              {splitting ? 'Splitting...' : `Split into ${splitCount} UTXOs`}
            </button>
            <button style={{ ...copyBtnS, padding: '8px 12px' }}
              onClick={fetchUTXOs} disabled={loading}>
              {loading ? '...' : 'Refresh'}
            </button>
          </div>

          {/* Info */}
          <div style={{ marginTop: 12, fontSize: '.6rem', color: 'var(--t4)', lineHeight: 1.5 }}>
            Splitting UTXOs helps with parallel transactions. Each OPNet contract interaction
            needs its own UTXO. If you only have 1 UTXO, you must wait for each tx to confirm
            before sending the next one.
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Gas & Mempool ─── */
function GasTool() {
  const [network, setNetwork] = useState<opnet.Network>(opnet.getNetwork());
  const [gas, setGas] = useState<opnet.GasParams | null>(null);
  const [mempool, setMempool] = useState<{ count?: number; opnetCount?: number; sizeBytes?: number } | null>(null);
  const [pendingTxs, setPendingTxs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const prev = opnet.getNetwork();
    opnet.setNetwork(network);
    return () => { opnet.setNetwork(prev); };
  }, [network]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, m, pt] = await Promise.all([
        opnet.getGasParameters(),
        opnet.getMempoolInfo().catch(() => null),
        opnet.getLatestPendingTxs(10).catch(() => []),
      ]);
      setGas(g || null);
      setMempool(m || null);
      if (Array.isArray(pt)) setPendingTxs(pt.slice(0, 10));
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {mempool.count != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{mempool.count}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Pending TXs</div></div>}
                {mempool.opnetCount != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700, color: 'var(--o)' }}>{mempool.opnetCount}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>OPNet TXs</div></div>}
                {mempool.sizeBytes != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{(mempool.sizeBytes / 1024 / 1024).toFixed(1)} MB</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Size</div></div>}
              </div>
            </div>
          )}
          {pendingTxs.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(245,158,11,.04)', borderRadius: 10 }}>
              <div style={{ fontSize: '.65rem', color: 'var(--y)', fontWeight: 700, marginBottom: 6 }}>Pending Transactions ({pendingTxs.length})</div>
              {pendingTxs.map((tx, i) => {
                const hash = String(tx.hash || tx.id || tx.transactionId || `tx-${i}`);
                const from = String(tx.from || tx.sender || '').slice(0, 16);
                const to = String(tx.to || tx.recipient || '').slice(0, 16);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.58rem' }}>
                    <span style={{ ...monoSm, color: 'var(--c)', fontSize: '.55rem' }}>{hash.slice(0, 14)}...</span>
                    <span style={{ color: 'var(--t3)' }}>{from ? `${from}...` : ''} {to ? `→ ${to}...` : ''}</span>
                  </div>
                );
              })}
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
  const FAUCET_URL = import.meta.env.VITE_FAUCET_URL || 'https://faucet.opnet.org';

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
      {activeTab === 'splitter' && <UTXOSplitter />}
      {activeTab === 'tx' && <TXLookup />}
      {activeTab === 'block' && <BlockExplorer />}
      {activeTab === 'gas' && <GasTool />}
      {activeTab === 'faucet' && <FaucetTool />}
    </div>
  );
};

export default TokenTools;
