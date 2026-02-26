import React, { useState, useEffect, useRef } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';

const Dashboard: React.FC = () => {
  const [p, setP] = useState<{ usd: number; usd_24h_change: number; usd_market_cap: number } | null>(null);
  const [blk, setBlk] = useState(0);
  const [epochNum, setEpochNum] = useState<number | null>(null);
  const [blockLog, setBlockLog] = useState<Array<{ height: number; time: Date; epoch: number }>>([]);
  const [gasParams, setGasParams] = useState<{ conservative?: number; recommended?: number } | null>(null);
  const [ld, setLd] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const pulseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const go = async () => {
      // 1. Fetch OP_NET Data
      let block = 0;
      let epochNum = 0;
      try {
        block = await opnet.getBlockHeight();
        const ep = await opnet.getLatestEpoch();
        epochNum = ep?.number ?? Math.floor(block / 5);
      } catch (e) {
        console.warn('OP_NET RPC failed, using fallback', e);
        try {
          const b = await fetch('https://blockchain.info/q/getblockcount').then(r => r.text());
          block = parseInt(b, 10) || 0;
          epochNum = Math.floor(block / 5);
        } catch { }
      }

      // 2. Fetch Price (multi-source with cache)
      const priceInfo = await fetchBtcPrice();

      // 3. Fetch gas
      try {
        const gp = await opnet.getGasParameters();
        if (!cancelled && gp) setGasParams({ conservative: Number(gp.bitcoin?.conservative), recommended: undefined });
      } catch { /* gas optional */ }

      if (!cancelled) {
        setP(priceInfo);
        if (block > 0) {
          setBlk(prev => {
            if (block !== prev && block > 0) {
              setBlockLog(log => [{ height: block, time: new Date(), epoch: Math.floor(block / 5) }, ...log].slice(0, 8));
            }
            return block;
          });
          setEpochNum(epochNum);
        }
        setLd(false);
        setLastUpdate(new Date());
        setPulse(true);
        pulseRef.current = setTimeout(() => setPulse(false), 800);
      }
    };
    go();
    const iv = setInterval(go, 30000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(pulseRef.current); };
  }, []);

  const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fb = (n: number) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : '$' + (n / 1e9).toFixed(1) + 'B';
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);
  const epochBlock = blk % 5;
  const epochPct = (epochBlock / 5) * 100;

  return (
    <div>
      <div className="hero-d">
        <div className="hd-s" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: pulse ? 'var(--g)' : 'var(--t4)', boxShadow: pulse ? '0 0 8px var(--g)' : 'none', transition: 'all .3s', display: 'inline-block' }} />
          Bitcoin Price — OP_NET Consensus Layer
          {lastUpdate && <span style={{ color: 'var(--t4)', fontSize: '.55rem' }}>· {lastUpdate.toLocaleTimeString()}</span>}
        </div>
        {ld ? <div className="hd-v" style={{ opacity: 0.3 }}>Loading…</div> : p && (
          <>
            <div className="hd-v">{f(p.usd)}</div>
            <div><span className={`pill ${p.usd_24h_change >= 0 ? 'pill-u' : 'pill-d'}`}>{p.usd_24h_change >= 0 ? '↑' : '↓'} {Math.abs(p.usd_24h_change).toFixed(2)}%</span></div>
          </>
        )}
      </div>

      <div className="mets">
        <div className="P met"><div className="met-i">⛏️</div><div className="met-v">{blk > 0 ? blk.toLocaleString() : '—'}</div><div className="met-l">OP_NET Block</div></div>
        <div className="P met">
          <div className="met-i">🔄</div>
          <div className="met-v" style={{ color: 'var(--p)' }}>{epoch > 0 ? epoch.toLocaleString() : '—'}</div>
          <div className="met-l">Epoch</div>
          {blk > 0 && (
            <div style={{ width: '100%', marginTop: 6 }}>
              <div style={{ background: 'var(--bg3)', borderRadius: 4, height: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--p),var(--c))', width: `${epochPct}%`, transition: 'width .5s', borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: '.5rem', color: 'var(--t4)', marginTop: 2 }}>{epochBlock}/5 blocks</div>
            </div>
          )}
        </div>
        <div className="P met"><div className="met-i">💰</div><div className="met-v" style={{ color: 'var(--o)' }}>{p ? fb(p.usd_market_cap) : '—'}</div><div className="met-l">Market Cap</div></div>
        <div className="P met">
          <div className="met-i">⛽</div>
          <div className="met-v" style={{ color: 'var(--c)', fontSize: '1rem' }}>
            {gasParams?.conservative ? `${(gasParams.conservative / 1e8).toFixed(6)} BTC` : '—'}
          </div>
          <div className="met-l">Gas (conservative)</div>
        </div>
      </div>

      <div className="mets" style={{ marginTop: 16 }}>
        <div className="P met"><div className="met-i">🔐</div><div className="met-v" style={{ color: 'var(--g)', fontSize: '1rem' }}>ML-DSA</div><div className="met-l">PQ Security</div></div>
        <div className="P met"><div className="met-i">📦</div><div className="met-v" style={{ color: 'var(--g)' }}>26+</div><div className="met-l">dApps Live</div></div>
        <div className="P met"><div className="met-i">🌐</div><div className="met-v" style={{ color: 'var(--c)', fontSize: '1rem' }}>Mainnet</div><div className="met-l">Network</div></div>
        <div className="P met"><div className="met-i">🔗</div>
          <div className="met-v" style={{ fontSize: '1rem' }}>
            <a href="https://opscan.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)', textDecoration: 'none', fontWeight: 700 }}>OPScan ↗</a>
          </div>
          <div className="met-l">Block Explorer</div>
        </div>
      </div>

      {/* Live Block Feed */}
      {blockLog.length > 0 && (
        <div className="P" style={{ marginTop: 16 }}>
          <div className="Lb">⚡ Live Block Feed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {blockLog.map((b, i) => (
              <div key={b.height + '-' + i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '8px 12px', borderRadius: 'var(--rad)', fontSize: '.75rem',
                background: i === 0 ? 'rgba(247,147,26,.04)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${i === 0 ? 'rgba(247,147,26,.12)' : 'var(--bd)'}`,
                animation: i === 0 ? 'pageIn .3s ease' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--fm)', fontWeight: 700, color: i === 0 ? 'var(--o)' : 'var(--t2)' }}>#{b.height.toLocaleString()}</span>
                  <span style={{ fontSize: '.6rem', color: 'var(--t4)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>Epoch {b.epoch}</span>
                  {b.height % 5 === 0 && <span style={{ fontSize: '.5rem', color: 'var(--y)', fontWeight: 700 }}>⚡ EPOCH</span>}
                </div>
                <span style={{ fontSize: '.6rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>{b.time.toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;
