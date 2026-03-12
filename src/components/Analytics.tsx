import React, { useState, useEffect, useMemo } from 'react';
import { logger } from '../logger';
import { getProvider } from '../contractCache';
import * as opnetRpc from '../opnet';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS, getContractOpscanUrl, type ContractTokenInfo } from '../contracts';
import { getTxHistory, type TxRecord } from '../txHistory';

interface PoolSnapshot {
  ts: number;
  reserveMINE: number;
  reserveVIBE: number;
  rate: number;
}

const SNAPSHOT_KEY = 'hub_pool_snapshots';
const MAX_SNAPSHOTS = 200;
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function validateSnapshot(s: unknown): s is PoolSnapshot {
  if (s == null || typeof s !== 'object') return false;
  const snap = s as Record<string, unknown>;
  return typeof snap.ts === 'number' && !isNaN(snap.ts)
    && typeof snap.reserveMINE === 'number' && !isNaN(snap.reserveMINE)
    && typeof snap.reserveVIBE === 'number' && !isNaN(snap.reserveVIBE)
    && typeof snap.rate === 'number' && !isNaN(snap.rate);
}

function loadSnapshots(): PoolSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (raw == null) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(validateSnapshot);
  } catch (e) { logger.warn('[Analytics] Failed to load snapshots from localStorage:', e); return []; }
}

function saveSnapshot(snap: PoolSnapshot): void {
  const all = loadSnapshots();
  // Deduplicate: only add if >60s since last
  const lastSnap = all[all.length - 1];
  if (all.length > 0 && lastSnap && snap.ts - lastSnap.ts < 60000) return;
  all.push(snap);
  if (all.length > MAX_SNAPSHOTS) all.splice(0, all.length - MAX_SNAPSHOTS);
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all));
}

/** Merge server snapshots with local cache — dedup by timestamp, sorted ascending */
function mergeSnapshots(server: PoolSnapshot[], local: PoolSnapshot[]): PoolSnapshot[] {
  const map = new Map<number, PoolSnapshot>();
  for (const s of server) map.set(s.ts, s);
  for (const s of local) {
    if (!map.has(s.ts)) map.set(s.ts, s);
  }
  const merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  // Keep last MAX_SNAPSHOTS
  if (merged.length > MAX_SNAPSHOTS) merged.splice(0, merged.length - MAX_SNAPSHOTS);
  return merged;
}

/** Fetch pool snapshot history from server */
interface PoolHistoryResponse {
  snapshots?: unknown[];
}

async function fetchServerSnapshots(pool: string, limit = 500, signal?: AbortSignal): Promise<PoolSnapshot[]> {
  try {
    const resp = await fetch(`${API_BASE}/api/pool/history?pool=${encodeURIComponent(pool)}&limit=${limit}`, {
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as PoolHistoryResponse;
    if (!Array.isArray(data.snapshots)) return [];
    return data.snapshots.filter(validateSnapshot);
  } catch (e) {
    if (signal?.aborted) return [];
    logger.warn('[Analytics] Failed to fetch server snapshots:', e);
    return [];
  }
}

/** Simple SVG line chart */
const MiniChart: React.FC<{ data: number[]; color: string; height?: number; label?: string }> = ({ data, color, height = 120, label }) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 400;
  const pad = 10;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (height - 2 * pad);
    return `${x},${y}`;
  });
  const areaPoints = [...points, `${pad + (w - 2 * pad)},${height - pad}`, `${pad},${height - pad}`];
  const latest = data[data.length - 1] ?? 0;
  const prev = data[data.length - 2] ?? 0;
  const change = prev > 0 ? ((latest - prev) / prev * 100) : 0;

  return (
    <div>
      {label && (
        <div className="d-flex jc-between ai-baseline mb-8">
          <span className="fs-75 c-t2 fw-600">{label}</span>
          <div className="d-flex ai-baseline gap-6">
            <span className="fs-100 fw-700 text-mono" style={{ color }}>{latest.toFixed(2)}</span>
            <span className="fs-65 fw-600" style={{ color: change >= 0 ? 'var(--g)' : '#ef4444' }}>
              {change >= 0 ? '↑' : '↓'}{Math.abs(change).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label || 'Chart'}>
        <defs>
          <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = pad + pct * (height - 2 * pad);
          return <line key={pct} x1={pad} y1={y} x2={w - pad} y2={y} stroke="rgba(255,255,255,.04)" strokeWidth="0.5" />;
        })}
        {/* Area fill */}
        <polygon points={areaPoints.join(' ')} fill={`url(#grad-${color.replace('#','')})`} />
        {/* Line */}
        <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Latest point dot */}
        {points.length > 0 && (() => {
          const lastPoint = points[points.length - 1];
          if (!lastPoint) return null;
          const [lx, ly] = lastPoint.split(',');
          return <circle cx={lx} cy={ly} r="3" fill={color} stroke="var(--bg)" strokeWidth="1.5" />;
        })()}
        {/* Min/Max labels */}
        <text x={w - pad} y={pad + 4} textAnchor="end" fill="var(--t4)" fontSize="8" fontFamily="var(--fm)">{max.toFixed(2)}</text>
        <text x={w - pad} y={height - pad - 2} textAnchor="end" fill="var(--t4)" fontSize="8" fontFamily="var(--fm)">{min.toFixed(2)}</text>
      </svg>
    </div>
  );
};

const Analytics: React.FC = () => {
  const provider = useMemo(() => getProvider(), []);
  const [snapshots, setSnapshots] = useState<PoolSnapshot[]>(loadSnapshots());
  const [reserves, setReserves] = useState<{ mine: number; vibe: number } | null>(null);
  const [supplies, setSupplies] = useState<Record<string, bigint>>({});
  const [blockHeight, setBlockHeight] = useState(0);
  const [gasParams, setGasParams] = useState<{ conservative?: number } | null>(null);
  const [mempoolInfo, setMempoolInfo] = useState<{ count?: number; opnetCount?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolError, setPoolError] = useState(false);
  const [, setSupplyError] = useState(false);
  const [chainError, setChainError] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(false);

  // Load server snapshots on mount — one-time fetch
  useEffect(() => {
    const ac = new AbortController();
    const go = async (): Promise<void> => {
      try {
        const serverSnaps = await fetchServerSnapshots(POOL_ADDRESS, 500, ac.signal);
        if (ac.signal.aborted) return;
        if (serverSnaps.length > 0) {
          const local = loadSnapshots();
          const merged = mergeSnapshots(serverSnaps, local);
          localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(merged));
          setSnapshots(merged);
        }
        setServerLoaded(true);
      } catch (e) {
        if (!ac.signal.aborted) logger.warn('[Analytics] Server snapshot load failed:', e);
      }
    };
    void go();
    return () => { ac.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async (): Promise<void> => {
      // Pool reserves
      try {
        const res = await opnetRpc.callContract(POOL_ADDRESS, '06374bfc');
        if (res && !cancelled) {
          const hex = res.startsWith('0x') ? res.slice(2) : res;
          if (hex.length >= 128) {
            const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
            const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
            if (r0 > 0 && r1 > 0) {
              setReserves({ mine: r0, vibe: r1 });
              setPoolError(false);
              const snap: PoolSnapshot = { ts: Date.now(), reserveMINE: r0, reserveVIBE: r1, rate: r1 / r0 };
              saveSnapshot(snap);
              // Reload from localStorage (which now includes server data)
              setSnapshots(loadSnapshots());
            }
          }
        }
      } catch (e) { logger.warn('[Analytics] Pool reserves fetch failed:', e); if (!cancelled) setPoolError(true); }

      // Token supplies
      let supplyFail = false;
      for (const [sym, tok] of Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]) {
        try {
          const supply = await opnetRpc.getTokenTotalSupply(tok.address);
          if (!cancelled) setSupplies(prev => ({ ...prev, [sym]: supply }));
        } catch (e) { logger.warn(`[Analytics] ${sym} supply fetch failed:`, e); supplyFail = true; }
      }
      if (!cancelled) setSupplyError(supplyFail);

      // Block height
      let chainFail = false;
      try {
        const h = await opnetRpc.getBlockHeight();
        if (!cancelled) setBlockHeight(h);
      } catch (e) { logger.warn('[Analytics] Block height fetch failed:', e); chainFail = true; }

      // Gas
      try {
        const gp = await opnetRpc.getGasParameters();
        if (!cancelled && gp) setGasParams({ conservative: Number(gp.bitcoin?.conservative) });
      } catch (e) { logger.warn('[Analytics] Gas params fetch failed:', e); chainFail = true; }

      // Mempool
      try {
        const mp = await opnetRpc.getMempoolInfo();
        if (!cancelled && mp) setMempoolInfo(mp);
      } catch (e) { logger.warn('[Analytics] Mempool info fetch failed:', e); chainFail = true; }
      if (!cancelled) setChainError(chainFail);

      if (!cancelled) setLoading(false);
    };
    void fetchAll();
    const iv = setInterval(() => void fetchAll(), 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [provider]);

  const txHistory = getTxHistory();
  const swapCount = txHistory.filter(t => t.type === 'swap').length;
  const mintCount = txHistory.filter(t => t.type === 'mint').length;
  const rate = reserves ? reserves.vibe / reserves.mine : 0;
  const tvl = reserves ? reserves.mine + reserves.vibe : 0;

  const rateHistory = snapshots.map(s => s.rate);
  const mineReserveHistory = snapshots.map(s => s.reserveMINE);
  const vibeReserveHistory = snapshots.map(s => s.reserveVIBE);

  return (
    <div role="region" aria-label="Analytics dashboard">
      <div className="mb-16">
        <h2 className="fs-120 fw-800 mb-4">📊 Analytics</h2>
        <p className="c-t3 fs-78">Real-time pool metrics, token stats, and on-chain activity</p>
      </div>

      {loading && <div className="text-center c-t4 p-30" aria-busy="true" aria-live="polite">Loading analytics...</div>}

      {/* Error banners */}
      {poolError && !loading && (
        <div className="mb-10 br-8 fs-68 c-red p-8-12" role="alert" style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)' }}>
          ⚠️ Pool data unavailable — reserves may be stale
        </div>
      )}
      {chainError && !loading && (
        <div className="mb-10 br-8 fs-68 c-y p-8-12" role="alert" style={{ background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.15)' }}>
          ⚠️ Some chain metrics unavailable — RPC may be slow
        </div>
      )}

      {/* Key Metrics */}
      <div className="d-grid gap-10 mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">MINE/VIBE Rate</div>
          <div className="fs-110 fw-700 c-p text-mono">{rate > 0 ? rate.toFixed(2) : '—'}</div>
        </div>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">Pool TVL</div>
          <div className="fs-110 fw-700 c-g text-mono">{tvl > 0 ? `${(tvl / 1e6).toFixed(2)}M` : '—'}</div>
        </div>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">Block Height</div>
          <div className="fs-110 fw-700 c-o text-mono">{blockHeight > 0 ? blockHeight.toLocaleString() : '—'}</div>
        </div>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">Gas (sat/vB)</div>
          <div className="fs-110 fw-700 c-c text-mono">{gasParams?.conservative ?? '—'}</div>
        </div>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">Mempool TXs</div>
          <div className="fs-110 fw-700 c-c2 text-mono">{mempoolInfo?.count ?? '—'}</div>
        </div>
        <div className="P p-14-center text-center">
          <div className="lbl-xs mb-4">Your Swaps/Mints</div>
          <div className="fs-110 fw-700 c-w text-mono">{swapCount}/{mintCount}</div>
        </div>
      </div>

      {/* Price Chart — only show with enough data */}
      {rateHistory.length >= 2 && (
        <div className="P p-16 mb-16">
          <MiniChart data={rateHistory} color="#a78bfa" label="MINE/VIBE Exchange Rate" height={140} />
          <div className="flex-between mt-6 fs-2xs c-t4">
            <span>{snapshots[0] ? `${new Date(snapshots[0].ts).toLocaleDateString()} ${new Date(snapshots[0].ts).toLocaleTimeString()}` : ''}</span>
            <span>{snapshots.length} pts{serverLoaded && API_BASE !== '' ? ' (server+local)' : ' (local)'}</span>
            <span>{(() => { const last = snapshots[snapshots.length - 1]; return last ? new Date(last.ts).toLocaleTimeString() : ''; })()}</span>
          </div>
        </div>
      )}

      {/* Reserve Charts — only show with enough data */}
      {mineReserveHistory.length >= 2 && (
        <div className="d-grid gap-12 mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div className="P p-14">
            <MiniChart data={mineReserveHistory} color="#F7931A" label="MINE Reserve" height={100} />
          </div>
          <div className="P p-14">
            <MiniChart data={vibeReserveHistory} color="#0ea5e9" label="VIBE Reserve" height={100} />
          </div>
        </div>
      )}

      {/* Pool Details */}
      <div className="P p-16 mb-16">
        <div className="Lb mb-10">💱 Pool Details — MINE/VIBE SimplePool</div>
        <div className="d-grid gap-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="bg3-rounded">
            <div className="fs-62 c-t4 mb-4">MINE Reserve</div>
            <div className="fw-700 text-mono" style={{ color: '#F7931A' }}>
              {reserves ? reserves.mine.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
            </div>
          </div>
          <div className="bg3-rounded">
            <div className="fs-62 c-t4 mb-4">VIBE Reserve</div>
            <div className="fw-700 text-mono c-sky">
              {reserves ? reserves.vibe.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
            </div>
          </div>
        </div>
        <div className="mt-10 fs-62 c-t4 text-mono word-break">
          Pool: <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer" className="c-c2">{POOL_ADDRESS}</a>
        </div>
        <div className="mt-4 fs-xs c-t4">
          Fee: 0.3% · Constant product AMM (x × y = k)
        </div>
      </div>

      {/* Token Supply Stats */}
      <div className="P p-16 mb-16">
        <div className="Lb mb-10">🪙 Token Supply</div>
        <div className="d-grid gap-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {Object.entries(DEPLOYED_CONTRACTS).map(([sym, tok]: [string, ContractTokenInfo]) => {
            const supply = supplies[sym];
            const totalMinted = supply ? Number(supply) / Math.pow(10, tok.decimals) : 0;
            const maxSupply = tok.supply;
            const pct = maxSupply > 0 ? (totalMinted / maxSupply) * 100 : 0;
            return (
              <div key={sym} className="bg3-rounded">
                <div className="flex-center gap-6 mb-8">
                  <span className="fs-110">{tok.icon}</span>
                  <span className="fw-700">${sym}</span>
                  {tok.publicMint && <span className="fs-50 c-purple br-4 fw-700 p-2-6" style={{ background: 'rgba(168,85,247,.12)' }}>MINTABLE</span>}
                </div>
                <div className="flex-between fs-sm mb-4">
                  <span className="c-t3">Minted</span>
                  <span className="text-mono c-w">{totalMinted.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex-between fs-sm mb-6">
                  <span className="c-t3">Max Supply</span>
                  <span className="text-mono c-t2">{maxSupply.toLocaleString()}</span>
                </div>
                {/* Progress bar */}
                <div className="br-4 h-6 ov-hidden" style={{ background: 'var(--bg2)' }}>
                  <div className="br-4" style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: `linear-gradient(90deg, ${sym === 'MINE' ? '#F7931A' : '#0ea5e9'}, ${sym === 'MINE' ? '#e8850f' : '#0284c7'})`, transition: 'width .5s' }} />
                </div>
                <div className="fs-2xs c-t4 mt-4 text-right">
                  {pct.toFixed(1)}% minted
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="P p-16">
        <div className="Lb mb-10">⚡ Recent On-Chain Activity</div>
        {txHistory.length === 0 ? (
          <div className="c-t4 fs-72 text-center p-20">No activity recorded yet. Try minting or swapping!</div>
        ) : (
          <div className="flex-col-gap4">
            {txHistory.slice(0, 15).map((tx: TxRecord) => (
              <div key={tx.id} className="flex-between fs-72 br-14 p-8-12" style={{ background: 'rgba(255,255,255,.02)', border: '1px solid var(--bd)' }}>
                <div className="flex-center gap-8">
                  <span>{tx.type === 'swap' ? '🔄' : tx.type === 'mint' ? '🪙' : '🎁'}</span>
                  <span className="fw-600 c-w" style={{ textTransform: 'capitalize' }}>{tx.type}</span>
                  <span className="c-t3">
                    {tx.type === 'swap'
                      ? `${tx.amountA} ${tx.tokenA} → ${tx.tokenB}`
                      : `${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                  </span>
                </div>
                <div className="flex-center gap-8">
                  <span className="fs-2xs fw-600" style={{ color: tx.status === 'confirmed' ? 'var(--g)' : 'var(--y)' }}>{tx.status}</span>
                  <span className="fs-2xs c-t4 text-mono">
                    {new Date(tx.ts).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;
