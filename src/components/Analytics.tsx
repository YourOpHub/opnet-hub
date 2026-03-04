import React, { useState, useEffect, useMemo } from 'react';
import { getProvider } from '../contractCache';
import { NETWORK, RPC_URL } from '../config';
import * as opnetRpc from '../opnet';
import { TESTNET_CONTRACTS, POOL_ADDRESS, getContractOpscanUrl } from '../contracts';
import { getTxHistory, type TxRecord } from '../txHistory';

interface PoolSnapshot {
  ts: number;
  reserveMINE: number;
  reserveVIBE: number;
  rate: number;
}

const SNAPSHOT_KEY = 'hub_pool_snapshots';
const MAX_SNAPSHOTS = 200;

function loadSnapshots(): PoolSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Validate each snapshot
    return arr.filter((s: unknown) => {
      if (!s || typeof s !== 'object') return false;
      const snap = s as Record<string, unknown>;
      return typeof snap.ts === 'number' && !isNaN(snap.ts)
        && typeof snap.reserveMINE === 'number' && !isNaN(snap.reserveMINE)
        && typeof snap.reserveVIBE === 'number' && !isNaN(snap.reserveVIBE)
        && typeof snap.rate === 'number' && !isNaN(snap.rate);
    }) as PoolSnapshot[];
  } catch { return []; }
}

function saveSnapshot(snap: PoolSnapshot) {
  const all = loadSnapshots();
  // Deduplicate: only add if >60s since last
  if (all.length > 0 && snap.ts - all[all.length - 1].ts < 60000) return;
  all.push(snap);
  if (all.length > MAX_SNAPSHOTS) all.splice(0, all.length - MAX_SNAPSHOTS);
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all));
}

/** Simple SVG line chart */
const MiniChart: React.FC<{ data: number[]; color: string; height?: number; label?: string }> = ({ data, color, height = 120, label }) => {
  if (data.length < 2) return <div style={{ color: 'var(--t4)', fontSize: '.7rem', padding: 20, textAlign: 'center' }}>Collecting data... (refresh periodically)</div>;
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
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const change = prev > 0 ? ((latest - prev) / prev * 100) : 0;

  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: '.75rem', color: 'var(--t2)', fontWeight: 600 }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color, fontFamily: 'var(--fm)' }}>{latest.toFixed(2)}</span>
            <span style={{ fontSize: '.65rem', color: change >= 0 ? 'var(--g)' : '#ef4444', fontWeight: 600 }}>
              {change >= 0 ? '↑' : '↓'}{Math.abs(change).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height }}>
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
          const [lx, ly] = points[points.length - 1].split(',');
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
  const [supplyError, setSupplyError] = useState(false);
  const [chainError, setChainError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
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
              setSnapshots(loadSnapshots());
            }
          }
        }
      } catch { if (!cancelled) setPoolError(true); }

      // Token supplies
      let supplyFail = false;
      for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
        try {
          const supply = await opnetRpc.getTokenTotalSupply(tok.address);
          if (!cancelled) setSupplies(prev => ({ ...prev, [sym]: supply }));
        } catch { supplyFail = true; }
      }
      if (!cancelled) setSupplyError(supplyFail);

      // Block height
      let chainFail = false;
      try {
        const h = await opnetRpc.getBlockHeight();
        if (!cancelled) setBlockHeight(h);
      } catch { chainFail = true; }

      // Gas
      try {
        const gp = await opnetRpc.getGasParameters();
        if (!cancelled && gp) setGasParams({ conservative: Number(gp.bitcoin?.conservative) });
      } catch { chainFail = true; }

      // Mempool
      try {
        const mp = await opnetRpc.getMempoolInfo();
        if (!cancelled && mp) setMempoolInfo(mp);
      } catch { chainFail = true; }
      if (!cancelled) setChainError(chainFail);

      if (!cancelled) setLoading(false);
    };
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
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
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 4 }}>📊 Analytics</h2>
        <p style={{ color: 'var(--t3)', fontSize: '.78rem' }}>Real-time pool metrics, token stats, and on-chain activity</p>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--t4)' }}>Loading analytics...</div>}

      {/* Error banners */}
      {poolError && !loading && (
        <div style={{ padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)', fontSize: '.68rem', color: '#ef4444' }}>
          ⚠️ Pool data unavailable — reserves may be stale
        </div>
      )}
      {chainError && !loading && (
        <div style={{ padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.15)', fontSize: '.68rem', color: 'var(--y)' }}>
          ⚠️ Some chain metrics unavailable — RPC may be slow
        </div>
      )}

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>MINE/VIBE Rate</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--p)', fontFamily: 'var(--fm)' }}>{rate > 0 ? rate.toFixed(2) : '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Pool TVL</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--g)', fontFamily: 'var(--fm)' }}>{tvl > 0 ? `${(tvl / 1e6).toFixed(2)}M` : '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Block Height</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--o)', fontFamily: 'var(--fm)' }}>{blockHeight > 0 ? blockHeight.toLocaleString() : '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Gas (sat/vB)</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--c)', fontFamily: 'var(--fm)' }}>{gasParams?.conservative ?? '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Mempool TXs</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--c2)', fontFamily: 'var(--fm)' }}>{mempoolInfo?.count ?? '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Your Swaps/Mints</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--w)', fontFamily: 'var(--fm)' }}>{swapCount}/{mintCount}</div>
        </div>
      </div>

      {/* Price Chart */}
      <div className="P" style={{ padding: 16, marginBottom: 16 }}>
        <MiniChart data={rateHistory} color="#a78bfa" label="MINE/VIBE Exchange Rate" height={140} />
        {snapshots.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '.55rem', color: 'var(--t4)' }}>
            <span>{new Date(snapshots[0].ts).toLocaleTimeString()}</span>
            <span>{snapshots.length} data points</span>
            <span>{new Date(snapshots[snapshots.length - 1].ts).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {/* Reserve Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="P" style={{ padding: 14 }}>
          <MiniChart data={mineReserveHistory} color="#F7931A" label="MINE Reserve" height={100} />
        </div>
        <div className="P" style={{ padding: 14 }}>
          <MiniChart data={vibeReserveHistory} color="#0ea5e9" label="VIBE Reserve" height={100} />
        </div>
      </div>

      {/* Pool Details */}
      <div className="P" style={{ padding: 16, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>💱 Pool Details — MINE/VIBE SimplePool</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: '14px' }}>
            <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 4 }}>MINE Reserve</div>
            <div style={{ fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)' }}>
              {reserves ? reserves.mine.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
            </div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: '14px' }}>
            <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 4 }}>VIBE Reserve</div>
            <div style={{ fontWeight: 700, color: '#0ea5e9', fontFamily: 'var(--fm)' }}>
              {reserves ? reserves.vibe.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: '.62rem', color: 'var(--t4)', fontFamily: 'var(--fm)', wordBreak: 'break-all' }}>
          Pool: <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>{POOL_ADDRESS}</a>
        </div>
        <div style={{ marginTop: 4, fontSize: '.6rem', color: 'var(--t4)' }}>
          Fee: 0.3% · Constant product AMM (x × y = k)
        </div>
      </div>

      {/* Token Supply Stats */}
      <div className="P" style={{ padding: 16, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>🪙 Token Supply</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
            const supply = supplies[sym];
            const totalMinted = supply ? Number(supply) / Math.pow(10, tok.decimals) : 0;
            const maxSupply = tok.supply;
            const pct = maxSupply > 0 ? (totalMinted / maxSupply) * 100 : 0;
            return (
              <div key={sym} style={{ padding: 12, background: 'var(--bg3)', borderRadius: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: '1.1rem' }}>{tok.icon}</span>
                  <span style={{ fontWeight: 700 }}>${sym}</span>
                  {tok.publicMint && <span style={{ fontSize: '.5rem', background: 'rgba(168,85,247,.12)', color: '#a855f7', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>MINTABLE</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--t3)' }}>Minted</span>
                  <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)' }}>{totalMinted.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--t3)' }}>Max Supply</span>
                  <span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>{maxSupply.toLocaleString()}</span>
                </div>
                {/* Progress bar */}
                <div style={{ background: 'var(--bg2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(pct, 100)}%`,
                    background: `linear-gradient(90deg, ${sym === 'MINE' ? '#F7931A' : '#0ea5e9'}, ${sym === 'MINE' ? '#e8850f' : '#0284c7'})`,
                    borderRadius: 4,
                    transition: 'width .5s',
                  }} />
                </div>
                <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginTop: 3, textAlign: 'right' }}>
                  {pct.toFixed(1)}% minted
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="P" style={{ padding: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>⚡ Recent On-Chain Activity</div>
        {txHistory.length === 0 ? (
          <div style={{ color: 'var(--t4)', fontSize: '.72rem', textAlign: 'center', padding: 20 }}>No activity recorded yet. Try minting or swapping!</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {txHistory.slice(0, 15).map((tx: TxRecord) => (
              <div key={tx.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: '14px', fontSize: '.72rem',
                background: 'rgba(255,255,255,.02)', border: '1px solid var(--bd)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{tx.type === 'swap' ? '🔄' : tx.type === 'mint' ? '🪙' : '🎁'}</span>
                  <span style={{ fontWeight: 600, color: 'var(--w)', textTransform: 'capitalize' }}>{tx.type}</span>
                  <span style={{ color: 'var(--t3)' }}>
                    {tx.type === 'swap'
                      ? `${tx.amountA} ${tx.tokenA} → ${tx.tokenB}`
                      : `${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '.55rem', color: tx.status === 'confirmed' ? 'var(--g)' : 'var(--y)', fontWeight: 600 }}>{tx.status}</span>
                  <span style={{ fontSize: '.55rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
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
