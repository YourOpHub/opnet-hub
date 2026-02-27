import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { POOL_ADDRESS } from '../contracts';

const mono = "'JetBrains Mono', monospace";

const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
  const [btc, setBtc] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [block, setBlock] = useState(0);
  const [poolRate, setPoolRate] = useState(0);

  useEffect(() => {
    let c = false;
    const load = async () => {
      try { const p = await fetchBtcPrice(); if (!c && p) { setBtc(p.usd); setBtcChange(p.usd_24h_change); } } catch {}
      try { const b = await opnet.getBlockHeight(); if (!c && b) setBlock(b); } catch {}
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
      } catch {}
    };
    load();
    const iv = setInterval(load, 45000);
    return () => { c = true; clearInterval(iv); };
  }, []);

  return (
    <div>
      {/* ── HERO ── */}
      <div style={{
        textAlign: 'center', padding: '80px 24px 64px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-40%', left: '50%', transform: 'translateX(-50%)',
          width: 700, height: 500, borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(ellipse, rgba(247,147,26,.05) 0%, transparent 65%)',
          filter: 'blur(60px)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 16px', borderRadius: 100, marginBottom: 28,
            background: 'rgba(247,147,26,.05)', border: '1px solid rgba(247,147,26,.1)',
            fontSize: '.65rem', fontWeight: 600, color: '#F7931A', letterSpacing: '.02em',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
            Bitcoin L1 Smart Contracts
          </div>

          <h1 style={{
            fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 900,
            letterSpacing: '-.04em', lineHeight: 1.08, color: '#fff', marginBottom: 16,
          }}>
            DeFi on<br />
            <span style={{
              background: 'linear-gradient(135deg, #F7931A, #ffab40)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>Pure Bitcoin</span>
          </h1>

          <p style={{ fontSize: '.88rem', color: '#5a6578', maxWidth: 460, margin: '0 auto 32px', lineHeight: 1.7 }}>
            Swap, stake, and earn on Bitcoin Layer 1. Powered by OP_NET consensus — no bridges, no sidechains.
          </p>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onNav('swap')} style={{
              padding: '12px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #F7931A, #ffab40)', color: '#000',
              fontWeight: 700, fontSize: '.82rem', fontFamily: "'Inter', sans-serif",
              boxShadow: '0 4px 20px rgba(247,147,26,.25)', transition: 'all .2s',
            }}>Start Trading</button>
            <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" style={{
              padding: '12px 28px', borderRadius: 12, textDecoration: 'none',
              border: '1px solid rgba(255,255,255,.08)', color: '#c8cdd8',
              fontWeight: 600, fontSize: '.82rem', background: 'rgba(255,255,255,.03)',
              transition: 'all .2s',
            }}>Read Docs</a>
          </div>
        </div>
      </div>

      {/* ── LIVE STATS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 28 }}>
        <div style={{ padding: '18px 14px', borderRadius: 16, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '.5rem', color: '#4a5568', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Bitcoin</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>
            {btc > 0 ? '$' + btc.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '...'}
          </div>
          {btcChange !== 0 && (
            <div style={{ fontSize: '.62rem', fontWeight: 600, color: btcChange >= 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
              {btcChange >= 0 ? '+' : ''}{btcChange.toFixed(2)}%
            </div>
          )}
        </div>
        <div style={{ padding: '18px 14px', borderRadius: 16, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '.5rem', color: '#4a5568', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Block Height</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>
            {block > 0 ? '#' + block.toLocaleString() : '...'}
          </div>
        </div>
        <div style={{ padding: '18px 14px', borderRadius: 16, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }} onClick={() => onNav('swap')}>
          <div style={{ fontSize: '.5rem', color: '#4a5568', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>MINE/VIBE</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: '1.1rem', color: '#F7931A' }}>
            {poolRate > 0 ? `1:${poolRate.toFixed(1)}` : '...'}
          </div>
        </div>
      </div>

      {/* ── WHAT YOU CAN DO ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { icon: '⇄', title: 'Swap', desc: 'Trade OP-20 tokens on Bitcoin L1 AMM', color: '#F7931A', tab: 'swap' },
          { icon: '◈', title: 'Stake', desc: 'Earn block rewards on your MINE tokens', color: '#a78bfa', tab: 'staking' },
          { icon: '⚡', title: 'Build', desc: 'Deploy smart contracts with WASM', color: '#0ea5e9', tab: 'launch' },
        ].map(f => (
          <div key={f.tab} onClick={() => onNav(f.tab)} style={{
            padding: '28px 22px', borderRadius: 18, cursor: 'pointer', transition: 'all .25s',
            background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.05)',
            position: 'relative', overflow: 'hidden',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${f.color}30`; e.currentTarget.style.transform = 'translateY(-3px)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={{ fontSize: '1.6rem', marginBottom: 14, color: f.color }}>{f.icon}</div>
            <div style={{ fontWeight: 700, fontSize: '.88rem', color: '#fff', marginBottom: 6, letterSpacing: '-.01em' }}>{f.title}</div>
            <div style={{ fontSize: '.75rem', color: '#4a5568', lineHeight: 1.5 }}>{f.desc}</div>
            <div style={{
              position: 'absolute', top: 0, right: 0, width: 80, height: 80, borderRadius: '50%',
              background: `radial-gradient(circle, ${f.color}08, transparent 70%)`,
              transform: 'translate(30%, -30%)', pointerEvents: 'none',
            }} />
          </div>
        ))}
      </div>

      {/* ── TECH HIGHLIGHTS ── */}
      <div style={{
        padding: '28px 24px', borderRadius: 18, marginBottom: 28,
        background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)',
      }}>
        <div style={{ fontSize: '.52rem', color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 18 }}>Technology</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { label: 'Consensus', value: 'Cryptographic', sub: 'Verifiable execution' },
            { label: 'Contracts', value: 'WASM', sub: 'AssemblyScript / Rust' },
            { label: 'Security', value: 'ML-DSA', sub: 'Post-quantum ready' },
          ].map(t => (
            <div key={t.label}>
              <div style={{ fontSize: '.5rem', color: '#4a5568', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{t.label}</div>
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: '.92rem', color: '#fff', marginBottom: 2 }}>{t.value}</div>
              <div style={{ fontSize: '.68rem', color: '#4a5568' }}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── LINKS ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Documentation', href: 'https://docs.opnet.org' },
          { label: 'OPScan Explorer', href: 'https://testnet.opscan.org' },
          { label: 'Vibecode Challenge', href: 'https://vibecode.finance/challenge' },
          { label: 'Ecosystem', href: 'https://vibecode.finance/ecosystem' },
        ].map(l => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 18px', borderRadius: 10, textDecoration: 'none',
            background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)',
            color: '#7a8494', fontSize: '.72rem', fontWeight: 500, transition: 'all .2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(247,147,26,.2)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#7a8494'; }}
          >{l.label} ↗</a>
        ))}
      </div>
    </div>
  );
};

export default Landing;
