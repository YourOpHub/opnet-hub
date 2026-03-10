import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../../logger';
import * as opnet from '../../opnet';
import { DEPLOYED_CONTRACTS, OPSCAN_API_BASE, getContractOpscanUrl } from '../../contracts';
import { cardS, inputS, btnS, rowS, labelS, valueS, formatBigNum } from './toolStyles';

/* ─── Known tokens database ─── */
const KNOWN_TOKENS: Record<string, { name: string; symbol: string; decimals: number; type: string }> = {};
for (const [sym, tok] of Object.entries(DEPLOYED_CONTRACTS)) {
  KNOWN_TOKENS[tok.address] = { name: `${sym} Token`, symbol: sym, decimals: tok.decimals, type: 'OP-20 (MintableToken)' };
}

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

const TokenExplorer = React.memo(function TokenExplorer() {
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
    void (async () => {
      try {
        const resp = await fetch(`${OPSCAN_API_BASE}/tokens`);
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
                const r = await fetch(`${OPSCAN_API_BASE}/tokens/${hex}/holders`);
                if (!r.ok) return 0;
                const d = await r.json();
                const arr = d?.results || d || [];
                return Array.isArray(arr) ? arr.length : 0;
              } catch (e) { logger.warn('[TokenTools] Failed to fetch holder count from OPScan:', e); return 0; }
            }));
            setAllTokens(prev => {
              const next = [...prev];
              for (let j = 0; j < chunk.length; j++) {
                const chunkItem = chunk[j];
                if (!chunkItem) continue;
                const idx = next.findIndex(t => t.address === chunkItem.address);
                if (idx >= 0 && next[idx]) next[idx] = { ...next[idx], holders: counts[j] };
              }
              return next;
            });
          }
        };
        void batch(tokens, 5);
      } catch (e) { logger.warn('[TokenExplorer] OPScan fetch failed:', e); }
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
          const hr = await fetch(`${OPSCAN_API_BASE}/tokens/${hexAddr}/holders`);
          if (hr.ok) {
            const hd = await hr.json();
            const arr = hd?.results || hd || [];
            if (Array.isArray(arr)) holders = arr.length;
          }
        } catch (e) { logger.warn('[TokenTools] Holder count fetch failed:', e); }
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
          {Object.entries(DEPLOYED_CONTRACTS).map(([sym, tok]) => (
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
              <a href={getContractOpscanUrl(addr.trim())} target="_blank" rel="noopener noreferrer"
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
});

export default TokenExplorer;
