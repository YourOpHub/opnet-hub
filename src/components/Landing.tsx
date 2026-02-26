import React, { useState, useEffect, useRef } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS } from '../contracts';

const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
  const [p, setP] = useState<{ usd: number; usd_24h_change: number; usd_market_cap: number } | null>(null);
  const [blk, setBlk] = useState(0);
  const [epochNum, setEpochNum] = useState<number | null>(null);
  const [blockLog, setBlockLog] = useState<Array<{ height: number; time: Date; epoch: number }>>([]);
  const [gasParams, setGasParams] = useState<{ conservative?: number } | null>(null);
  const [ld, setLd] = useState(true);
  const [pulse, setPulse] = useState(false);
  const pulseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const go = async () => {
      let block = 0;
      let ep = 0;
      try {
        block = await opnet.getBlockHeight();
        const epData = await opnet.getLatestEpoch();
        ep = epData?.number ?? Math.floor(block / 5);
      } catch { /* opnet unavailable */ }

      const priceInfo = await fetchBtcPrice();

      try {
        const gp = await opnet.getGasParameters();
        if (!cancelled && gp) setGasParams({ conservative: Number(gp.bitcoin?.conservative) });
      } catch { /* gas optional */ }

      if (!cancelled) {
        setP(priceInfo);
        if (block > 0) {
          setBlk(prev => {
            if (block !== prev && block > 0) {
              setBlockLog(log => [{ height: block, time: new Date(), epoch: Math.floor(block / 5) }, ...log].slice(0, 6));
            }
            return block;
          });
          setEpochNum(ep);
        }
        setLd(false);
        setPulse(true);
        pulseRef.current = setTimeout(() => setPulse(false), 800);
      }
    };
    go();
    const iv = setInterval(go, 30000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(pulseRef.current); };
  }, []);

  const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fb = (n: number) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M';
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);
  const epochBlock = blk % 5;
  const epochPct = (epochBlock / 5) * 100;

  return (
    <div>
      <div className="hero-l">
        <div className="hero-badge">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: pulse ? 'var(--g)' : 'var(--t4)', boxShadow: pulse ? '0 0 8px var(--g)' : 'none', transition: 'all .3s', display: 'inline-block' }} />
          {' '}Consensus Layer Active
        </div>
        <h1 className="hero-h1">
          Bitcoin Just Became<br />
          <span className="hero-ac">Programmable</span>
        </h1>
        <p className="hero-p">
          OP_NET is the first consensus layer on Bitcoin — Turing-complete smart contracts,
          post-quantum security, and deterministic execution. No bridges. No sidechains.
          Pure Bitcoin L1.
        </p>
        <div className="hero-ctas">
          <button className="btn-p" onClick={() => onNav('bob')}>Ask Bob AI</button>
          <button className="btn-s" onClick={() => onNav('launch')}>Deploy a Token</button>
          <a className="btn-s" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Read Docs</a>
        </div>

        {/* Live Stats Ticker */}
        <div className="ticker">
          <div className="tk">
            <div className="tk-l">BTC Price</div>
            <div className="tk-v">{ld ? '…' : p && p.usd > 0 ? f(p.usd) : '—'}</div>
            {p && p.usd > 0 && <div className={`tk-c ${p.usd_24h_change >= 0 ? 'u' : 'd'}`}>{p.usd_24h_change >= 0 ? '↑' : '↓'}{Math.abs(p.usd_24h_change).toFixed(2)}%</div>}
          </div>
          <div className="tk-s" />
          <div className="tk"><div className="tk-l">OP_NET Block</div><div className="tk-v">{blk > 0 ? blk.toLocaleString() : '…'}</div></div>
          <div className="tk-s" />
          <div className="tk">
            <div className="tk-l">Epoch</div>
            <div className="tk-v" style={{ color: 'var(--p)' }}>{epoch > 0 ? epoch.toLocaleString() : '…'}</div>
            {blk > 0 && (
              <div style={{ width: '100%', marginTop: 4 }}>
                <div style={{ background: 'var(--bg3)', borderRadius: 4, height: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--p),var(--c))', width: `${epochPct}%`, transition: 'width .5s', borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: '.5rem', color: 'var(--t4)', marginTop: 2 }}>{epochBlock}/5 blocks</div>
              </div>
            )}
          </div>
          <div className="tk-s" />
          <div className="tk"><div className="tk-l">Market Cap</div><div className="tk-v" style={{ color: 'var(--o)' }}>{p && p.usd_market_cap > 0 ? fb(p.usd_market_cap) : '…'}</div></div>
        </div>
      </div>

      {/* Dashboard Metrics */}
      <div className="mets">
        <div className="P met"><div className="met-i">🔐</div><div className="met-v" style={{ color: 'var(--g)', fontSize: '1rem' }}>ML-DSA</div><div className="met-l">PQ Security</div></div>
        <div className="P met">
          <div className="met-i">⛽</div>
          <div className="met-v" style={{ color: 'var(--c)', fontSize: '1rem' }}>
            {gasParams?.conservative ? `${(gasParams.conservative / 1e8).toFixed(6)} BTC` : '—'}
          </div>
          <div className="met-l">Gas (conservative)</div>
        </div>
        <div className="P met"><div className="met-i">📦</div><div className="met-v" style={{ color: 'var(--g)' }}>26+</div><div className="met-l">dApps Live</div></div>
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

      {/* Pillars */}
      <div className="pillars">
        <div className="pillar">
          <div className="pillar-i">🔐</div>
          <div className="pillar-t">Cryptographic Consensus</div>
          <div className="pillar-d">Not indexer hope. Mathematical proof of correct execution on every node.</div>
        </div>
        <div className="pillar">
          <div className="pillar-i">⚡</div>
          <div className="pillar-t">WASM Smart Contracts</div>
          <div className="pillar-d">Full Turing-complete execution via WebAssembly. AssemblyScript, Rust, C++.</div>
        </div>
        <div className="pillar">
          <div className="pillar-i">🛡️</div>
          <div className="pillar-t">Post-Quantum Security</div>
          <div className="pillar-d">ML-DSA (NIST) signatures protect all contract interactions against quantum threats.</div>
        </div>
      </div>

      <div className="fgrid">
        {[
          { i: '🤖', t: 'Bob AI Agent', d: 'OP_NET knowledge copilot — consensus, tokens, DeFi strategy.', tab: 'bob' },
          { i: '🚀', t: 'Token Launcher', d: 'Deploy OP-20 contracts directly on Bitcoin L1.', tab: 'launch' },
          { i: '💼', t: 'Portfolio', d: 'Consensus-verified OP-20 holdings with live data.', tab: 'portfolio' },
          { i: '🛠️', t: 'Tools', d: 'Token explorer, converter, gas & mempool analytics.', tab: 'tools' },
          { i: '⛏️', t: 'Epoch Miner', d: 'Learn OP_NET epochs through interactive gameplay.', tab: 'game' },
          { i: '📰', t: 'News & Updates', d: 'Latest OP_NET protocol news and ecosystem developments.', tab: 'news' },
        ].map((c) => (
          <div key={c.tab} className="P fc" onClick={() => onNav(c.tab)}>
            <div className="fc-i">{c.i}</div>
            <div className="fc-t">{c.t}</div>
            <div className="fc-d">{c.d}</div>
          </div>
        ))}
      </div>

      {/* Live On-Chain Tokens */}
      <div className="P" style={{ marginBottom: 16, padding: 18, border: '1px solid rgba(34,197,94,.15)', background: 'rgba(34,197,94,.03)' }}>
        <div className="Lb" style={{ marginBottom: 10, color: 'var(--g)' }}>✅ Live OP-20 Tokens — Deployed on OPNet Testnet</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {Object.values(TESTNET_CONTRACTS).map(tok => (
            <div key={tok.symbol} style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '1.2rem' }}>{tok.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--w)', fontSize: '.9rem' }}>${tok.symbol}</div>
                  <div style={{ fontSize: '.6rem', color: 'var(--t4)' }}>{tok.description}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '.5rem', background: 'var(--gG)', color: 'var(--g)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>LIVE</span>
              </div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', wordBreak: 'break-all', marginBottom: 4 }}>{tok.address}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '.62rem', color: 'var(--t3)' }}>Supply: {tok.supply.toLocaleString()}</span>
                <a href={`https://testnet.opnet.org/contract/${tok.address}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '.6rem', color: 'var(--c2)', textDecoration: 'none' }}>View ↗</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Vibecode Challenge Banner */}
      <div className="eco-bn" style={{ marginBottom: 16, borderColor: 'rgba(247,147,26,.15)', background: 'rgba(247,147,26,.03)' }}>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em' }}>
            🏆 <span style={{ color: 'var(--o)' }}>Vibecoding Challenge</span> — Win Motocats + $PILL
          </div>
          <div style={{ color: 'var(--t3)', fontSize: '.82rem', marginTop: 4, lineHeight: 1.5 }}>
            Build Bitcoin L1 apps with Bob AI. Three themed weeks, real prizes. No coding experience needed.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://vibecode.finance/challenge" target="_blank" rel="noopener noreferrer" className="btn-p" style={{ textDecoration: 'none', fontSize: '.78rem', padding: '10px 22px' }}>Enter Challenge →</a>
          <a href="https://ai.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.78rem', padding: '10px 22px' }}>Get Bob AI →</a>
        </div>
      </div>

      {/* Ecosystem Banner */}
      <div className="eco-bn">
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em' }}>
            The <span style={{ color: 'var(--o)' }}>Programmable Bitcoin</span> Ecosystem
          </div>
          <div style={{ color: 'var(--t3)', fontSize: '.82rem', marginTop: 4, lineHeight: 1.5 }}>
            26+ apps built on OP_NET consensus. Submit yours at vibecode.finance
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://vibecode.finance/ecosystem" target="_blank" rel="noopener noreferrer" className="btn-p" style={{ textDecoration: 'none', fontSize: '.78rem', padding: '10px 22px' }}>Explore →</a>
          <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.78rem', padding: '10px 22px' }}>Docs →</a>
        </div>
      </div>
    </div>
  );
};
export default Landing;
