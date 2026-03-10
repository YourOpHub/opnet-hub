import React, { useState, useEffect, useRef } from 'react';
import { logger } from '../logger';
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
        logger.warn('OP_NET RPC failed, using fallback', e);
        try {
          const b = await fetch('https://blockchain.info/q/getblockcount').then(r => r.text());
          block = parseInt(b, 10) || 0;
          epochNum = Math.floor(block / 5);
        } catch (e) { logger.warn('[Dashboard] Fallback block height fetch failed:', e); }
      }

      // 2. Fetch Price (multi-source with cache)
      const priceInfo = await fetchBtcPrice();

      // 3. Fetch gas
      try {
        const gp = await opnet.getGasParameters();
        if (!cancelled && gp) setGasParams({ conservative: Number(gp.bitcoin?.conservative), recommended: undefined });
      } catch (e) { logger.warn('[Dashboard] Gas parameters fetch failed:', e); }

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
    void go();
    const iv = setInterval(() => void go(), 30000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(pulseRef.current); };
  }, []);

  const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fb = (n: number) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : '$' + (n / 1e9).toFixed(1) + 'B';
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);
  const epochBlock = blk % 5;
  const epochPct = (epochBlock / 5) * 100;

  return (
    <div>
      <div className="hero-d" role="region" aria-label="Bitcoin price overview" aria-live="polite">
        <div className="hd-s dash-pulse">
          <span className={`dot-live ${pulse ? 'dot-green' : 'dot-t4'}`} />
          Bitcoin Price — OP_NET Consensus Layer
          {lastUpdate && <span className="c-t4 fs-55">· {lastUpdate.toLocaleTimeString()}</span>}
        </div>
        {ld ? <div className="hd-v" style={{ opacity: .3 }}>Loading…</div> : p && (
          <>
            <div className="hd-v">{f(p.usd)}</div>
            <div><span className={`pill ${p.usd_24h_change >= 0 ? 'pill-u' : 'pill-d'}`}>{p.usd_24h_change >= 0 ? '↑' : '↓'} {Math.abs(p.usd_24h_change).toFixed(2)}%</span></div>
          </>
        )}
      </div>

      <div className="mets" role="region" aria-label="Network metrics">
        <div className="P met"><div className="met-i" aria-hidden="true">⛏️</div><div className="met-v">{blk > 0 ? blk.toLocaleString() : '—'}</div><div className="met-l">OP_NET Block</div></div>
        <div className="P met">
          <div className="met-i">🔄</div>
          <div className="met-v c-p">{epoch > 0 ? epoch.toLocaleString() : '—'}</div>
          <div className="met-l">Epoch</div>
          {blk > 0 && (
            <div className="w-full mt-6">
              <div className="epoch-bar" role="progressbar" aria-valuenow={epochBlock} aria-valuemin={0} aria-valuemax={5} aria-label="Epoch progress">
                <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--p),var(--c))', width: `${epochPct}%`, transition: 'width .5s', borderRadius: 4 }} />
              </div>
              <div className="fs-50 c-t4 mt-2">{epochBlock}/5 blocks</div>
            </div>
          )}
        </div>
        <div className="P met"><div className="met-i">💰</div><div className="met-v c-o">{p ? fb(p.usd_market_cap) : '—'}</div><div className="met-l">Market Cap</div></div>
        <div className="P met">
          <div className="met-i">⛽</div>
          <div className="met-v c-c fs-100">
            {gasParams?.conservative ? `${(gasParams.conservative / 1e8).toFixed(6)} BTC` : '—'}
          </div>
          <div className="met-l">Gas (conservative)</div>
        </div>
      </div>

      <div className="mets mt-16" role="region" aria-label="Network information">
        <div className="P met"><div className="met-i" aria-hidden="true">🔐</div><div className="met-v c-g fs-100">ML-DSA</div><div className="met-l">PQ Security</div></div>
        <div className="P met"><div className="met-i">📦</div><div className="met-v c-g">26+</div><div className="met-l">dApps Live</div></div>
        <div className="P met"><div className="met-i">🌐</div><div className="met-v c-c fs-100">Mainnet</div><div className="met-l">Network</div></div>
        <div className="P met"><div className="met-i">🔗</div>
          <div className="met-v fs-100">
            <a href="https://opscan.org" target="_blank" rel="noopener noreferrer" className="c-c2 fw-700" style={{ textDecoration: 'none' }}>OPScan ↗</a>
          </div>
          <div className="met-l">Block Explorer</div>
        </div>
      </div>

      {/* Live Block Feed */}
      {blockLog.length > 0 && (
        <div className="P mt-16" role="log" aria-label="Live block feed" aria-live="polite">
          <div className="Lb">⚡ Live Block Feed</div>
          <div className="flex-col gap-4" role="list">
            {blockLog.map((b, i) => (
              <div key={b.height + '-' + i} role="listitem" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '8px 12px', borderRadius: '14px', fontSize: '.75rem',
                background: i === 0 ? 'rgba(247,147,26,.04)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${i === 0 ? 'rgba(247,147,26,.12)' : 'var(--bd)'}`,
                animation: i === 0 ? 'pageIn .3s ease' : 'none'
              }}>
                <div className="flex-center gap-8">
                  <span className="text-mono fw-700" style={{ color: i === 0 ? 'var(--o)' : 'var(--t2)' }}>#{b.height.toLocaleString()}</span>
                  <span className="fs-60 c-t4 br-4" style={{ background: 'var(--bg3)', padding: '1px 6px' }}>Epoch {b.epoch}</span>
                  {b.height % 5 === 0 && <span className="fs-50 c-y fw-700">⚡ EPOCH</span>}
                </div>
                <span className="fs-60 c-t4 text-mono">{b.time.toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default React.memo(Dashboard);
