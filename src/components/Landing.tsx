import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { POOL_ADDRESS } from '../contracts';

/** Scroll-triggered fade-in hook with blur */
function useReveal(delay = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, style: {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(24px)',
    filter: visible ? 'blur(0)' : 'blur(4px)',
    transition: `opacity .6s cubic-bezier(.22,1,.36,1) ${delay}s, transform .6s cubic-bezier(.22,1,.36,1) ${delay}s, filter .6s cubic-bezier(.22,1,.36,1) ${delay}s`,
  } as React.CSSProperties };
}

/** Animated counter */
function useCounter(target: number, duration = 1200) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target <= 0) return;
    const start = prev.current;
    const diff = target - start;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(start + diff * eased));
      if (p < 1) requestAnimationFrame(tick);
      else prev.current = target;
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

const BASE = import.meta.env.BASE_URL;
const FEATURES = [
  { icon: `${BASE}icons/icon-swap.png`, title: 'Swap', desc: 'Trade OP-20 tokens on a real Bitcoin L1 AMM with 0.3% fees', color: '#F7931A', tab: 'swap' },
  { icon: `${BASE}icons/icon-stake.png`, title: 'Stake', desc: 'Lock MINE tokens and earn block rewards automatically', color: '#a78bfa', tab: 'staking' },
  { icon: `${BASE}icons/icon-build.png`, title: 'Build', desc: 'Deploy smart contracts with WASM — AssemblyScript or Rust', color: '#0ea5e9', tab: 'launch' },
  { icon: `${BASE}icons/icon-mine.png`, title: 'Mine', desc: 'Clicker game that earns real $MINE tokens on Bitcoin L1', color: '#22c55e', tab: 'game' },
  { icon: `${BASE}icons/icon-market.png`, title: 'Market', desc: 'P2P OTC marketplace for trustless OP-20 token trading', color: '#ec4899', tab: 'market' },
  { icon: `${BASE}icons/icon-tools.png`, title: 'Tools', desc: 'Block explorer, UTXO viewer, gas monitor and more', color: '#eab308', tab: 'tools' },
  { icon: `${BASE}icons/icon-multisend.png`, title: 'MultiSend', desc: 'Batch transfer tokens to multiple recipients in one session', color: '#38bdf8', tab: 'multisend' },
  { icon: `${BASE}icons/icon-xchain.png`, title: 'FractalSwap', desc: 'Swap BTC \u2194 Fractal BTC via trustless atomic swaps \u2014 1% fee', color: '#8b5cf6', tab: 'xchain' },
  { icon: `${BASE}icons/icon-news.png`, title: 'News', desc: 'Live on-chain activity feed and ecosystem updates', color: '#34d399', tab: 'news' },
];

const TECH = [
  { label: 'Consensus', value: 'Cryptographic', sub: 'Verifiable execution' },
  { label: 'Contracts', value: 'WASM', sub: 'AssemblyScript / Rust' },
  { label: 'Security', value: 'ML-DSA', sub: 'Post-quantum ready' },
];

const LINKS = [
  { label: 'Documentation', href: 'https://docs.opnet.org' },
  { label: 'OPScan Explorer', href: 'https://testnet.opscan.org' },
  { label: 'Vibecode Challenge', href: 'https://vibecode.finance/challenge' },
  { label: 'Ecosystem', href: 'https://vibecode.finance/ecosystem' },
];

const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
  const [btc, setBtc] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [block, setBlock] = useState(0);
  const [poolRate, setPoolRate] = useState(0);

  useEffect(() => {
    let c = false;
    const load = async () => {
      try { const p = await fetchBtcPrice(); if (!c && p) { setBtc(p.usd); setBtcChange(p.usd_24h_change); } } catch { /* */ }
      try { const b = await opnet.getBlockHeight(); if (!c && b) setBlock(b); } catch { /* */ }
      try {
        const res = await opnet.callContract(POOL_ADDRESS, '06374bfc');
        if (!c && res) {
          const hex = res.startsWith('0x') ? res.slice(2) : res;
          if (hex.length >= 128) {
            const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
            const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
            if (r0 > 0) setPoolRate(r1 / r0);
          }
        }
      } catch { /* */ }
    };
    load();
    const iv = setInterval(load, 45000);
    return () => { c = true; clearInterval(iv); };
  }, []);

  const animBtc = useCounter(btc);
  const animBlock = useCounter(block, 800);

  const rev1 = useReveal(0);
  const rev2 = useReveal(0.1);
  const rev3 = useReveal(0);
  const rev4 = useReveal(0.1);

  const nav = useCallback((t: string) => onNav(t), [onNav]);

  return (
    <div>
      {/* ═══ HERO ═══ */}
      <div className="hero-l" style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px' }}>
          <div className="hero-badge">
            <span className="dot" />
            Bitcoin L1 Smart Contracts
          </div>

          <h1 className="hero-h1">
            DeFi on<br />
            <span className="hero-ac">Pure Bitcoin</span>
          </h1>

          <p className="hero-p">
            Swap, stake, and earn on Bitcoin Layer 1. Powered by OP_NET
            consensus — no bridges, no sidechains, no compromises.
          </p>

          <div className="hero-ctas">
            <button className="btn-p" onClick={() => nav('swap')}>Start Trading</button>
            <button className="btn-s" onClick={() => nav('game')}>Play &amp; Earn</button>
            <a className="btn-s" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer">
              Read Docs
            </a>
          </div>
        </div>
        <div style={{ flex: '0 1 360px', display: 'flex', justifyContent: 'center' }}>
          <img src={`${BASE}icons/hero-illustration.png`} alt="Bitcoin DeFi"
            style={{ maxWidth: '100%', height: 'auto', filter: 'drop-shadow(0 0 40px rgba(247,147,26,.25))', animation: 'heroFloat 4s ease-in-out infinite' }} />
        </div>
      </div>

      {/* ═══ LIVE TICKER ═══ */}
      <div className="ticker" ref={rev1.ref} style={rev1.style}>
        <div className="tk">
          <div className="tk-l">Bitcoin</div>
          <div className="tk-v">{animBtc > 0 ? '$' + animBtc.toLocaleString() : '...'}</div>
          {btcChange !== 0 && (
            <div className={`tk-c ${btcChange >= 0 ? 'u' : 'd'}`}>
              {btcChange >= 0 ? '+' : ''}{btcChange.toFixed(2)}%
            </div>
          )}
        </div>
        <div className="tk-s" />
        <div className="tk">
          <div className="tk-l">OP_NET Block</div>
          <div className="tk-v">{animBlock > 0 ? '#' + animBlock.toLocaleString() : '...'}</div>
        </div>
        <div className="tk-s" />
        <div className="tk" style={{ cursor: 'pointer' }} onClick={() => nav('swap')}>
          <div className="tk-l">MINE / VIBE</div>
          <div className="tk-v" style={{ color: '#F7931A' }}>
            {poolRate > 0 ? `1 : ${poolRate.toFixed(2)}` : '...'}
          </div>
        </div>
        <div className="tk-s" />
        <div className="tk" style={{ cursor: 'pointer' }} onClick={() => nav('analytics')}>
          <div className="tk-l">Network</div>
          <div className="tk-v" style={{ color: '#10b981' }}>Testnet</div>
        </div>
      </div>

      {/* ═══ FEATURES ═══ */}
      <div className="label-premium" style={{ marginBottom: 16 }}>What you can do</div>
      <div className="fgrid" ref={rev2.ref} style={rev2.style}>
        {FEATURES.map((f, i) => (
          <div key={f.tab} className="Pg fc" onClick={() => nav(f.tab)}
            style={{ animation: rev2.style.opacity === 1 ? `cardRevealIn .5s cubic-bezier(.22,1,.36,1) ${i * 0.05}s both` : 'none' }}>
            <img src={f.icon} alt={f.title} className="fc-i" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            <div className="fc-t">{f.title}</div>
            <div className="fc-d">{f.desc}</div>
          </div>
        ))}
      </div>

      {/* ═══ TECH ═══ */}
      <div className="label-premium" style={{ marginTop: 16 }}>The stack</div>
      <div className="pillars" ref={rev3.ref} style={rev3.style}>
        {TECH.map(t => (
          <div key={t.label} className="pillar">
            <div className="pillar-t">{t.value}</div>
            <div className="pillar-d">{t.sub}</div>
            <div style={{ fontSize: '.5rem', color: 'var(--t4)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ CTA BANNER ═══ */}
      <div className="eco-bn" ref={rev4.ref} style={rev4.style}>
        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--w)', letterSpacing: '-.02em', marginBottom: 4 }}>
            Ready to build on Bitcoin?
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--t2)', lineHeight: 1.6 }}>
            Deploy OP-20 tokens, create AMM pools, launch on the first Bitcoin L1 smart contract platform.
          </div>
        </div>
        <button className="btn-p" onClick={() => nav('launch')}>Launch a Token</button>
      </div>

      {/* ═══ LINKS ═══ */}
      <div className="divider" />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {LINKS.map(l => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="btn-s"
            style={{ fontSize: '.72rem', padding: '10px 20px', borderRadius: 14 }}
          >{l.label} ↗</a>
        ))}
      </div>
    </div>
  );
};

export default Landing;
