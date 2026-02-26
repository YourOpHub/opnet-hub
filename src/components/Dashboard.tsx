import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';

const Dashboard: React.FC = () => {
  const [p, setP] = useState<{ usd: number; usd_24h_change: number; usd_market_cap: number } | null>(null);
  const [blk, setBlk] = useState(0);
  const [epochNum, setEpochNum] = useState<number | null>(null);
  const [ld, setLd] = useState(true);

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

      // 2. Fetch Price
      let priceInfo = { usd: 97842, usd_24h_change: 2.34, usd_market_cap: 1.93e12 };
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
        const data = await res.json();
        if (data?.bitcoin) priceInfo = data.bitcoin;
      } catch (e) {
        console.warn('Price fetch failed', e);
      }

      if (!cancelled) {
        setP(priceInfo);
        if (block > 0) {
          setBlk(block);
          setEpochNum(epochNum);
        }
        setLd(false);
      }
    };
    go();
    const iv = setInterval(go, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fb = (n: number) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : '$' + (n / 1e9).toFixed(1) + 'B';
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);

  return (
    <div>
      <div className="hero-d">
        <div className="hd-s">⚡ Bitcoin Price — OP_NET Consensus Layer</div>
        {ld ? <div className="hd-v" style={{ opacity: 0.3 }}>Loading…</div> : p && (
          <>
            <div className="hd-v">{f(p.usd)}</div>
            <div><span className={`pill ${p.usd_24h_change >= 0 ? 'pill-u' : 'pill-d'}`}>{p.usd_24h_change >= 0 ? '↑' : '↓'} {Math.abs(p.usd_24h_change).toFixed(2)}%</span></div>
          </>
        )}
      </div>
      <div className="mets">
        <div className="P met"><div className="met-i">⛏️</div><div className="met-v">{blk > 0 ? blk.toLocaleString() : '—'}</div><div className="met-l">OP_NET Block</div></div>
        <div className="P met"><div className="met-i">🔄</div><div className="met-v" style={{ color: 'var(--p)' }}>{epoch > 0 ? epoch.toLocaleString() : '—'}</div><div className="met-l">Epoch</div></div>
        <div className="P met"><div className="met-i">💰</div><div className="met-v" style={{ color: 'var(--o)' }}>{p ? fb(p.usd_market_cap) : '—'}</div><div className="met-l">Market Cap</div></div>
        <div className="P met"><div className="met-i">📦</div><div className="met-v" style={{ color: 'var(--g)' }}>26+</div><div className="met-l">dApps</div></div>
      </div>
    </div>
  );
};
export default Dashboard;
