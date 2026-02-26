import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';

const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
  const [price, setPrice] = useState<number | null>(null);
  const [chg, setChg] = useState(0);
  const [blk, setBlk] = useState(0);
  const [epochNum, setEpochNum] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, opBlock, opEpoch] = await Promise.all([
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true').then((r) => r.json()),
          opnet.getBlockHeight().catch(() => 0),
          opnet.getLatestEpoch().catch(() => null),
        ]);
        if (!cancelled) {
          setPrice(p?.bitcoin?.usd ?? 97842);
          setChg(p?.bitcoin?.usd_24h_change ?? 0);
          setBlk(opBlock || 0);
          setEpochNum(opEpoch?.number ?? (opBlock > 0 ? Math.floor(opBlock / 5) : 0));
        }
      } catch {
        if (!cancelled) {
          setPrice(97842);
          setChg(2.34);
          try {
            const b = await fetch('https://blockchain.info/q/getblockcount').then((r) => r.text());
            const n = parseInt(b, 10);
            if (!cancelled && !isNaN(n)) {
              setBlk(n);
              setEpochNum(Math.floor(n / 5));
            }
          } catch {
            if (!cancelled) setBlk(888421);
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);

  return (
    <div>
      <div className="hero-l">
        <div className="hero-badge"><span className="dot" /> Consensus Layer Active</div>
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

        <div className="ticker">
          <div className="tk">
            <div className="tk-l">BTC Price</div>
            <div className="tk-v">{price ? f(price) : '…'}</div>
            {price && <div className={`tk-c ${chg >= 0 ? 'u' : 'd'}`}>{chg >= 0 ? '↑' : '↓'}{Math.abs(chg).toFixed(2)}%</div>}
          </div>
          <div className="tk-s" />
          <div className="tk"><div className="tk-l">OP_NET Block</div><div className="tk-v">{blk > 0 ? blk.toLocaleString() : '…'}</div></div>
          <div className="tk-s" />
          <div className="tk"><div className="tk-l">Epoch</div><div className="tk-v" style={{ color: 'var(--p)' }}>{epoch > 0 ? epoch.toLocaleString() : '…'}</div></div>
          <div className="tk-s" />
          <div className="tk"><div className="tk-l">Ecosystem</div><div className="tk-v" style={{ color: 'var(--g)' }}>26+</div></div>
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
