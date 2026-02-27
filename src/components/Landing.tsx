import React, { useState, useEffect, useRef } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, POOL_ADDRESS } from '../contracts';

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  wrap: { position: 'relative' as const },

  /* Hero */
  hero: {
    position: 'relative' as const, overflow: 'hidden', borderRadius: 28,
    padding: '100px 48px 80px', textAlign: 'center' as const, marginBottom: 32,
    background: 'linear-gradient(170deg, rgba(12,12,20,.95) 0%, rgba(8,8,14,.98) 100%)',
    border: '1px solid rgba(255,255,255,.06)',
  },
  heroGlow: {
    position: 'absolute' as const, top: '-30%', left: '50%', transform: 'translateX(-50%)',
    width: 900, height: 500, borderRadius: '50%', pointerEvents: 'none' as const,
    background: 'radial-gradient(ellipse, rgba(247,147,26,.07) 0%, transparent 70%)',
    filter: 'blur(40px)',
  },
  heroGlow2: {
    position: 'absolute' as const, bottom: '-20%', right: '10%',
    width: 500, height: 400, borderRadius: '50%', pointerEvents: 'none' as const,
    background: 'radial-gradient(ellipse, rgba(14,165,233,.04) 0%, transparent 70%)',
    filter: 'blur(60px)',
  },
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '7px 18px', borderRadius: 100,
    background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)',
    fontSize: '.72rem', fontWeight: 600, color: '#10b981',
    letterSpacing: '.02em', marginBottom: 32, backdropFilter: 'blur(8px)',
  },
  dot: (on: boolean) => ({
    width: 7, height: 7, borderRadius: '50%',
    background: on ? '#10b981' : '#3d4555',
    boxShadow: on ? '0 0 10px #10b981' : 'none',
    transition: 'all .4s',
  }),
  h1: {
    fontSize: 'clamp(2.2rem, 5vw, 4rem)', fontWeight: 900,
    letterSpacing: '-.04em', lineHeight: 1.05, color: '#fff', marginBottom: 20,
  },
  accent: {
    background: 'linear-gradient(135deg, #F7931A 0%, #f59e0b 50%, #ffab40 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  sub: {
    fontSize: 'clamp(.85rem, 1.5vw, 1rem)', color: '#8b95a9', maxWidth: 560,
    margin: '0 auto 36px', lineHeight: 1.7, fontWeight: 400,
  },
  ctas: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' as const },

  /* Stats bar */
  statsBar: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32,
  },
  stat: {
    padding: '20px 16px', borderRadius: 20, textAlign: 'center' as const,
    background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.06)',
    backdropFilter: 'blur(16px)', transition: 'all .3s',
  },
  statLabel: { fontSize: '.6rem', color: '#5a6578', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 6 },
  statVal: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '1.15rem' },

  /* Features */
  features: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 32,
  },
  feat: (accent: string) => ({
    padding: '28px 24px', borderRadius: 22, cursor: 'pointer', transition: 'all .3s',
    background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)',
    backdropFilter: 'blur(16px)', position: 'relative' as const, overflow: 'hidden',
    borderTop: `2px solid ${accent}`,
  }),
  featIcon: { fontSize: '1.6rem', marginBottom: 14, filter: 'drop-shadow(0 0 8px rgba(247,147,26,.15))' },
  featTitle: { fontWeight: 700, fontSize: '.92rem', color: '#fff', marginBottom: 6, letterSpacing: '-.01em' },
  featDesc: { fontSize: '.78rem', color: '#5a6578', lineHeight: 1.55 },
  featArrow: {
    position: 'absolute' as const, top: 24, right: 20, fontSize: '.8rem', color: '#3d4555',
    transition: 'all .3s',
  },

  /* Technology pillars */
  pillars: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 },
  pillar: {
    padding: '32px 24px', borderRadius: 22, textAlign: 'center' as const,
    background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
    backdropFilter: 'blur(12px)', transition: 'all .3s',
  },
  pillarIcon: { fontSize: '2.4rem', marginBottom: 14 },
  pillarTitle: { fontWeight: 700, fontSize: '.88rem', color: '#fff', marginBottom: 8 },
  pillarDesc: { fontSize: '.76rem', color: '#5a6578', lineHeight: 1.55 },

  /* Token cards */
  tokenSection: { marginBottom: 32 },
  tokenGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 },
  tokenCard: {
    padding: '20px', borderRadius: 18, background: 'rgba(10,10,18,.5)',
    border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(12px)',
  },

  /* CTA banners */
  banner: (color: string) => ({
    padding: '36px 32px', borderRadius: 22, marginBottom: 16,
    background: `rgba(10,10,18,.5)`, border: `1px solid ${color}15`,
    backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' as const,
  }),

  /* Section header */
  sectionLabel: {
    fontSize: '.62rem', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '.1em', color: '#5a6578', marginBottom: 16, display: 'flex',
    alignItems: 'center', gap: 10,
  },
  sectionLine: { flex: 1, height: 1, background: 'rgba(255,255,255,.06)' },
} as const;

const FEATURE_ACCENTS = ['#F7931A', '#0ea5e9', '#a78bfa', '#10b981', '#f59e0b', '#ef4444'];

const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
  const [p, setP] = useState<{ usd: number; usd_24h_change: number; usd_market_cap: number } | null>(null);
  const [blk, setBlk] = useState(0);
  const [epochNum, setEpochNum] = useState<number | null>(null);
  const [gasParams, setGasParams] = useState<{ conservative?: number } | null>(null);
  const [poolRate, setPoolRate] = useState<number | null>(null);
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
      } catch {}
      try {
        const res = await opnet.callContract(POOL_ADDRESS, '06374bfc');
        if (!cancelled && res) {
          const hex = res.startsWith('0x') ? res.slice(2) : res;
          if (hex.length >= 128) {
            const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
            const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
            if (r0 > 0 && r1 > 0) setPoolRate(r1 / r0);
          }
        }
      } catch {}
      if (!cancelled) {
        setP(priceInfo);
        if (block > 0) { setBlk(block); setEpochNum(ep); }
        setLd(false);
        setPulse(true);
        pulseRef.current = setTimeout(() => setPulse(false), 800);
      }
    };
    go();
    const iv = setInterval(go, 30000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(pulseRef.current); };
  }, []);

  const fUsd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fCap = (n: number) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M';
  const epoch = epochNum ?? (blk > 0 ? Math.floor(blk / 5) : 0);

  const features = [
    { icon: '🔄', title: 'Swap', desc: 'Trade MINE ↔ VIBE on a constant-product AMM — real on-chain transactions.', tab: 'swap' },
    { icon: '🏦', title: 'Staking', desc: 'Stake MINE tokens and earn rewards every block with dynamic APR.', tab: 'staking' },
    { icon: '🤖', title: 'Bob AI', desc: 'OP_NET expert copilot — ask about consensus, contracts, DeFi strategy.', tab: 'bob' },
    { icon: '🚀', title: 'Token Launcher', desc: 'Deploy OP-20 contracts directly on Bitcoin L1 in one click.', tab: 'launch' },
    { icon: '🛠', title: 'Developer Tools', desc: 'Token explorer, converter, gas analytics and mempool tools.', tab: 'tools' },
    { icon: '⛏', title: 'Epoch Miner', desc: 'Learn OP_NET consensus through interactive mining gameplay.', tab: 'game' },
  ];

  return (
    <div style={S.wrap}>
      {/* ── HERO ──────────────────────────────────────────────── */}
      <div style={S.hero}>
        <div style={S.heroGlow} />
        <div style={S.heroGlow2} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={S.badge}>
            <span style={S.dot(pulse)} />
            Consensus Layer Active
          </div>
          <h1 style={S.h1}>
            Bitcoin Just Became<br />
            <span style={S.accent}>Programmable</span>
          </h1>
          <p style={S.sub}>
            OP_NET is the first consensus layer on Bitcoin — Turing-complete smart contracts,
            post-quantum security, and deterministic execution. No bridges. No sidechains. Pure Bitcoin L1.
          </p>
          <div style={S.ctas}>
            <button className="btn-p" onClick={() => onNav('swap')}>Start Trading</button>
            <button className="btn-s" onClick={() => onNav('launch')}>Deploy Token</button>
            <a className="btn-s" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Documentation</a>
          </div>
        </div>
      </div>

      {/* ── LIVE STATS ────────────────────────────────────────── */}
      <div style={S.statsBar}>
        <div style={S.stat}>
          <div style={S.statLabel}>BTC Price</div>
          <div style={{ ...S.statVal, color: '#fff' }}>{ld ? '…' : p && p.usd > 0 ? fUsd(p.usd) : '—'}</div>
          {p && p.usd > 0 && (
            <div style={{ fontSize: '.7rem', fontWeight: 600, color: p.usd_24h_change >= 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
              {p.usd_24h_change >= 0 ? '↑' : '↓'} {Math.abs(p.usd_24h_change).toFixed(2)}%
            </div>
          )}
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>OP_NET Block</div>
          <div style={{ ...S.statVal, color: '#fff' }}>{blk > 0 ? `#${blk.toLocaleString()}` : '…'}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Epoch</div>
          <div style={{ ...S.statVal, color: '#a78bfa' }}>{epoch > 0 ? epoch.toLocaleString() : '…'}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Pool Rate</div>
          <div style={{ ...S.statVal, color: '#F7931A', cursor: 'pointer' }} onClick={() => onNav('swap')}>
            {poolRate ? `1:${poolRate.toFixed(1)}` : '—'}
          </div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Gas</div>
          <div style={{ ...S.statVal, color: '#0ea5e9' }}>
            {gasParams?.conservative ? `${gasParams.conservative}` : '—'}
            <span style={{ fontSize: '.6rem', color: '#5a6578', marginLeft: 3 }}>sat/vB</span>
          </div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Market Cap</div>
          <div style={{ ...S.statVal, color: '#F7931A' }}>{p && p.usd_market_cap > 0 ? fCap(p.usd_market_cap) : '…'}</div>
        </div>
      </div>

      {/* ── FEATURES ──────────────────────────────────────────── */}
      <div style={S.sectionLabel}>
        <span>Platform</span>
        <div style={S.sectionLine} />
      </div>
      <div style={S.features}>
        {features.map((f, i) => (
          <div key={f.tab} style={S.feat(FEATURE_ACCENTS[i % FEATURE_ACCENTS.length])}
            onClick={() => onNav(f.tab)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 16px 48px rgba(0,0,0,.3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
          >
            <div style={S.featIcon}>{f.icon}</div>
            <div style={S.featTitle}>{f.title}</div>
            <div style={S.featDesc}>{f.desc}</div>
            <span style={S.featArrow}>→</span>
          </div>
        ))}
      </div>

      {/* ── TECHNOLOGY ────────────────────────────────────────── */}
      <div style={S.sectionLabel}>
        <span>Technology</span>
        <div style={S.sectionLine} />
      </div>
      <div style={S.pillars}>
        {[
          { icon: '🔐', title: 'Cryptographic Consensus', desc: 'Mathematical proof of correct execution on every node. Not indexer trust — verifiable truth.' },
          { icon: '⚡', title: 'WASM Smart Contracts', desc: 'Full Turing-complete execution via WebAssembly. Write in AssemblyScript, Rust, or C++.' },
          { icon: '🛡', title: 'Post-Quantum Security', desc: 'ML-DSA (NIST FIPS 204) signatures protect all interactions against quantum threats.' },
        ].map(p => (
          <div key={p.title} style={S.pillar}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,.12)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,.06)'; }}
          >
            <div style={S.pillarIcon}>{p.icon}</div>
            <div style={S.pillarTitle}>{p.title}</div>
            <div style={S.pillarDesc}>{p.desc}</div>
          </div>
        ))}
      </div>

      {/* ── LIVE TOKENS ───────────────────────────────────────── */}
      <div style={S.sectionLabel}>
        <span>Live Tokens</span>
        <span style={{ fontSize: '.5rem', padding: '2px 8px', borderRadius: 100, background: 'rgba(16,185,129,.08)', color: '#10b981', fontWeight: 700, border: '1px solid rgba(16,185,129,.15)' }}>ON-CHAIN</span>
        <div style={S.sectionLine} />
      </div>
      <div style={{ ...S.tokenGrid, marginBottom: 32 }}>
        {Object.values(TESTNET_CONTRACTS).map(tok => (
          <div key={tok.symbol} style={S.tokenCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(247,147,26,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>{tok.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '.88rem' }}>${tok.symbol}</div>
                <div style={{ fontSize: '.62rem', color: '#5a6578' }}>{tok.name}</div>
              </div>
              <span style={{ fontSize: '.5rem', padding: '3px 8px', borderRadius: 6, background: 'rgba(16,185,129,.08)', color: '#10b981', fontWeight: 700 }}>LIVE</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '.5rem', color: '#3d4555', wordBreak: 'break-all', marginBottom: 8, padding: '6px 8px', background: 'rgba(255,255,255,.02)', borderRadius: 8 }}>{tok.address}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '.68rem', color: '#5a6578' }}>Supply: {tok.supply.toLocaleString()}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {tok.publicMint && (
                  <button onClick={() => onNav('swap')} style={{
                    padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff',
                    fontSize: '.6rem', fontWeight: 700, fontFamily: "'Inter', sans-serif",
                  }}>Mint</button>
                )}
                <a href={`https://testnet.opnet.org/tx/${tok.deployTxid}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '.6rem', color: '#38bdf8', textDecoration: 'none', padding: '5px 8px', display: 'flex', alignItems: 'center' }}>TX ↗</a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── CHALLENGE BANNER ──────────────────────────────────── */}
      <div style={S.banner('rgba(247,147,26')}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em', color: '#fff' }}>
            Vibecoding Challenge <span style={{ color: '#F7931A' }}>— Win Motocats + $PILL</span>
          </div>
          <div style={{ color: '#5a6578', fontSize: '.82rem', marginTop: 6, lineHeight: 1.55 }}>
            Build Bitcoin L1 apps with Bob AI. Three themed weeks, real prizes.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://vibecode.finance/challenge" target="_blank" rel="noopener noreferrer" className="btn-p" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '10px 22px' }}>Enter Challenge</a>
          <a href="https://ai.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '10px 22px' }}>Bob AI</a>
        </div>
      </div>

      {/* ── ECOSYSTEM BANNER ──────────────────────────────────── */}
      <div style={S.banner('rgba(14,165,233')}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em', color: '#fff' }}>
            The <span style={{ color: '#0ea5e9' }}>Programmable Bitcoin</span> Ecosystem
          </div>
          <div style={{ color: '#5a6578', fontSize: '.82rem', marginTop: 6, lineHeight: 1.55 }}>
            26+ apps built on OP_NET consensus. Explore and contribute.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://vibecode.finance/ecosystem" target="_blank" rel="noopener noreferrer" className="btn-p" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '10px 22px' }}>Explore</a>
          <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '10px 22px' }}>Docs</a>
        </div>
      </div>
    </div>
  );
};

export default Landing;
