import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../../logger';
import * as opnet from '../../opnet';
import { DEPLOYED_CONTRACTS, type ContractTokenInfo, OPSCAN_API_BASE, getContractOpscanUrl } from '../../contracts';
import { cardS, inputS, btnS, rowS, labelS, valueS, formatBigNum } from './toolStyles';

/* ─── Known tokens database ─── */
const KNOWN_TOKENS: Record<string, { name: string; symbol: string; decimals: number; type: string }> = {};
for (const [sym, tok] of Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]) {
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
  holders?: number | undefined;
}

/** OPScan API raw token entry */
interface OPScanRawToken {
  address?: string;
  deployerAddress?: string;
  op20Metadata?: {
    symbol?: string;
    name?: string;
    decimals?: number;
    totalSupply?: string | number;
    maximumSupply?: string | number;
    isPool?: boolean;
  };
}

/** OPScan API response wrapper */
interface OPScanResponse {
  results?: OPScanRawToken[];
}

/** OPScan holders API response */
interface OPScanHoldersResponse {
  results?: unknown[];
}

type TokenSortKey = 'symbol' | 'supply' | 'holders';

const TokenExplorer = React.memo(function TokenExplorer() {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ name: string; symbol: string; decimals: number; supply: string; isContract: boolean; bytecodeLen?: number | undefined; type?: string | undefined; holders?: number | undefined } | null>(null);

  // OPScan token list
  const [allTokens, setAllTokens] = useState<OPScanToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [sortKey, setSortKey] = useState<TokenSortKey>('holders');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterText, setFilterText] = useState('');

  // Fetch all tokens from OPScan
  useEffect(() => {
    const ac = new AbortController();
    const go = async (): Promise<void> => {
      try {
        const resp = await fetch(`${OPSCAN_API_BASE}/tokens`, { signal: ac.signal });
        if (!resp.ok) throw new Error('OPScan API error');
        const data = (await resp.json()) as OPScanResponse | OPScanRawToken[];
        const results: OPScanRawToken[] = (Array.isArray(data) ? data : (data as OPScanResponse).results) ?? [];
        if (!Array.isArray(results)) return;
        const tokens: OPScanToken[] = [];
        for (const t of results) {
          const meta = t.op20Metadata ?? {};
          if (meta.symbol == null) continue;
          const dec = meta.decimals ?? 8;
          tokens.push({
            address: String(t.address ?? '').replace('0x', ''),
            symbol: meta.symbol,
            name: meta.name ?? meta.symbol,
            decimals: dec,
            totalSupply: Number(meta.totalSupply ?? 0) / Math.pow(10, dec),
            maxSupply: Number(meta.maximumSupply ?? 0) / Math.pow(10, dec),
            isPool: meta.isPool === true,
            deployer: t.deployerAddress ?? '',
          });
        }
        if (ac.signal.aborted) return;
        setAllTokens(tokens);
        // Fetch holder counts in parallel (batch of 5)
        const batch = async (items: OPScanToken[], batchSize: number): Promise<void> => {
          for (let i = 0; i < items.length; i += batchSize) {
            if (ac.signal.aborted) return;
            const chunk = items.slice(i, i + batchSize);
            const counts = await Promise.all(chunk.map(async (tok) => {
              try {
                const hex = tok.address.startsWith('0x') ? tok.address : '0x' + tok.address;
                const r = await fetch(`${OPSCAN_API_BASE}/tokens/${hex}/holders`, { signal: ac.signal });
                if (!r.ok) return 0;
                const d = (await r.json()) as OPScanHoldersResponse | unknown[];
                const arr: unknown[] = (Array.isArray(d) ? d : (d as OPScanHoldersResponse).results) ?? [];
                return Array.isArray(arr) ? arr.length : 0;
              } catch (e) { if (!ac.signal.aborted) logger.warn('[TokenTools] Failed to fetch holder count from OPScan:', e); return 0; }
            }));
            if (ac.signal.aborted) return;
            setAllTokens(prev => {
              const next = [...prev];
              for (let j = 0; j < chunk.length; j++) {
                const chunkItem = chunk[j];
                if (!chunkItem) continue;
                const idx = next.findIndex(t => t.address === chunkItem.address);
                if (idx >= 0 && next[idx]) { const c = counts[j]; next[idx] = { ...next[idx], ...(c !== undefined ? { holders: c } : {}) }; }
              }
              return next;
            });
          }
        };
        void batch(tokens, 5);
      } catch (e) { if (!ac.signal.aborted) logger.warn('[TokenExplorer] OPScan fetch failed:', e); }
      finally { if (!ac.signal.aborted) setTokensLoading(false); }
    };
    void go();
    return () => { ac.abort(); };
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

  const toggleSort = (key: TokenSortKey): void => {
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
        opnet.getTokenTotalSupply(a).catch((e) => { logger.warn('[TokenExplorer] Token supply fetch error:', e); return 0n; }),
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
            const hd = (await hr.json()) as OPScanHoldersResponse | unknown[];
            const arr: unknown[] = (Array.isArray(hd) ? hd : (hd as OPScanHoldersResponse).results) ?? [];
            if (Array.isArray(arr)) holders = arr.length;
          }
        } catch (e) { logger.warn('[TokenTools] Holder count fetch failed:', e); }
      }

      if (known) {
        const num = Number(supply) / Math.pow(10, known.decimals);
        const supplyStr = num > 0 ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : (supply > 0n ? formatBigNum(String(supply)) : '0');
        setResult({ name: known.name, symbol: known.symbol, decimals: known.decimals, supply: supplyStr, isContract: true, bytecodeLen, type: known.type, ...(holders !== undefined ? { holders } : {}) });
      } else if (isContract) {
        const info = await opnet.getOP20Info(a);
        if (info && info.name !== 'Unknown' && info.symbol !== '?') {
          const supStr = info.totalSupply !== '0' ? formatBigNum(info.totalSupply) : '0';
          setResult({ name: info.name, symbol: info.symbol, decimals: info.decimals, supply: supStr, isContract, bytecodeLen, type: 'OP-20', ...(holders !== undefined ? { holders } : {}) });
        } else {
          const supplyStr = supply > 0n ? formatBigNum(String(supply)) : '0';
          setResult({ name: 'Unknown Contract', symbol: '\u2014', decimals: 8, supply: supplyStr, isContract, bytecodeLen, type: 'Smart Contract', ...(holders !== undefined ? { holders } : {}) });
          setErr('Contract found. OP-20 metadata not available (may be non-standard).');
        }
      } else {
        setResult({ name: '\u2014', symbol: '\u2014', decimals: 0, supply: '\u2014', isContract: false });
        setErr('No contract found at this address.');
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, []);

  const sortArrow = (key: TokenSortKey): string => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div>
      {/* Search by address */}
      <div style={cardS} role="region" aria-label="Token lookup">
        <div className="d-flex gap-8 mb-10">
          <input style={{ ...inputS, flex: 1 }} aria-label="Contract address" value={addr} onChange={e => setAddr(e.target.value)} placeholder="Contract address (opt1sq... or 0x...)" onKeyDown={e => e.key === 'Enter' && lookupAddr(addr.trim())} />
          <button style={btnS} onClick={() => lookupAddr(addr.trim())} disabled={loading}>{loading ? '...' : 'Explore'}</button>
        </div>
        {/* Quick links to known tokens */}
        <div className="d-flex gap-6 mb-10 flex-wrap">
          {(Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]).map(([sym, tok]) => (
            <button key={sym} onClick={() => lookupAddr(tok.address)}
              style={{ padding: '4px 12px', fontSize: '.62rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', background: addr === tok.address ? 'rgba(247,147,26,.1)' : 'rgba(255,255,255,.03)', color: addr === tok.address ? 'var(--o)' : 'var(--t3)', cursor: 'pointer', fontWeight: 600 }}>
              {tok.icon} {sym}
            </button>
          ))}
        </div>
        {err && <div role="alert" className="fs-72 mb-8" style={{ color: err.includes('not available') ? 'var(--y)' : 'var(--r)' }}>{err}</div>}
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
            {result.isContract && <div className="mt-8 text-center">
              <a href={getContractOpscanUrl(addr.trim())} target="_blank" rel="noopener noreferrer"
                className="fs-65 c-c no-underline">View on OPScan \u2192</a>
            </div>}
          </div>
        )}
      </div>

      {/* All tokens from OPScan */}
      <div style={{ ...cardS, marginTop: 12 }}>
        <div className="d-flex jc-between ai-center mb-10">
          <div className="fw-700 fs-82">All Tokens ({allTokens.length})</div>
          <input style={{ ...inputS, width: 180, fontSize: '.65rem', padding: '6px 10px' }}
            aria-label="Filter tokens by name or symbol"
            placeholder="Filter by name or symbol..."
            value={filterText} onChange={e => setFilterText(e.target.value)} />
        </div>
        {tokensLoading ? (
          <div className="text-center p-20 c-t3 fs-76">Loading tokens from OPScan...</div>
        ) : sortedTokens.length === 0 ? (
          <div className="text-center p-20 c-t3 fs-76">No tokens found</div>
        ) : (
          <div className="ov-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }} aria-label="All tokens list">
              <thead>
                <tr className="bb-w8">
                  <th className="p-6-8 c-t3 pointer fw-600 fs-66" style={{ textAlign: 'left' }}
                    onClick={() => toggleSort('symbol')}>Token{sortArrow('symbol')}</th>
                  <th className="p-6-8 c-t3 pointer fw-600 fs-66 text-right"
                    onClick={() => toggleSort('supply')}>Total Supply{sortArrow('supply')}</th>
                  <th className="p-6-8 c-t3 pointer fw-600 fs-66 text-right"
                    onClick={() => toggleSort('holders')}>Holders{sortArrow('holders')}</th>
                  <th className="p-6-8 c-t3 fw-600 fs-66 text-center">Type</th>
                </tr>
              </thead>
              <tbody>
                {sortedTokens.map(t => (
                  <tr key={t.address}
                    onClick={() => lookupAddr(t.address)}
                    className="bd-w4 pointer"
                    style={{ transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="p-8 d-flex ai-center gap-8">
                      <div>
                        <div className="fw-700 c-w">{t.symbol}</div>
                        <div className="fs-62 c-t4">{t.name}</div>
                      </div>
                    </td>
                    <td className="p-8 text-right c-t2" style={{ fontFamily: 'var(--fm)' }}>
                      {t.totalSupply >= 1e9 ? (t.totalSupply / 1e9).toFixed(2) + 'B' :
                        t.totalSupply >= 1e6 ? (t.totalSupply / 1e6).toFixed(2) + 'M' :
                        t.totalSupply >= 1e3 ? (t.totalSupply / 1e3).toFixed(1) + 'K' :
                        t.totalSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-8 text-right" style={{ fontFamily: 'var(--fm)', color: t.holders !== undefined ? 'var(--c)' : 'var(--t4)' }}>
                      {t.holders !== undefined ? t.holders : '\u2014'}
                    </td>
                    <td className="p-8 text-center">
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
