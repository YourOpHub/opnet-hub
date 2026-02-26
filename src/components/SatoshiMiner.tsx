import React, { useState, useCallback, useEffect, useRef } from 'react';

/* ─── Types ─── */
interface Up { id: string; name: string; icon: string; desc: string; flavor: string; base: number; g: number; pc?: number; ps?: number; lv: number; cat: 'c' | 'a' | 's' }
interface FX { id: number; x: number; y: number; v: number; gold?: boolean }
interface Spark { id: number; x: number; y: number; vx: number; vy: number; life: number; color: string }

/* ─── Upgrades ─── */
const UPS: Up[] = [
    { id: 'wasm', name: 'WASM Compiler', icon: '⚙️', desc: '+1/click', flavor: 'Compile AssemblyScript to bytecode', base: 15, g: 1.15, pc: 1, lv: 0, cat: 'c' },
    { id: 'node', name: 'Consensus Node', icon: '🖥️', desc: '+3/click', flavor: 'Run your own OP_NET validator', base: 100, g: 1.2, pc: 3, lv: 0, cat: 'c' },
    { id: 'vm', name: 'OP_VM Instance', icon: '🔧', desc: '+8/click', flavor: 'WebAssembly execution engine', base: 800, g: 1.25, pc: 8, lv: 0, cat: 'c' },
    { id: 'mldsa', name: 'ML-DSA Signer', icon: '🔐', desc: '+25/click', flavor: 'Post-quantum signature module', base: 8000, g: 1.3, pc: 25, lv: 0, cat: 'c' },
    { id: 'miner', name: 'Epoch Miner', icon: '⛏️', desc: '+1/sec', flavor: 'SHA-1 near-collision finder', base: 50, g: 1.15, ps: 1, lv: 0, cat: 'a' },
    { id: 'rack', name: 'Node Cluster', icon: '🗄️', desc: '+5/sec', flavor: 'Synchronized validator array', base: 500, g: 1.2, ps: 5, lv: 0, cat: 'a' },
    { id: 'farm', name: 'Mining Farm', icon: '🏭', desc: '+20/sec', flavor: 'Industrial epoch mining', base: 3000, g: 1.25, ps: 20, lv: 0, cat: 'a' },
    { id: 'state', name: 'State Layer', icon: '📦', desc: '+80/sec', flavor: 'Merkle state management', base: 20000, g: 1.3, ps: 80, lv: 0, cat: 'a' },
    { id: 'merkle', name: 'Merkle Tree', icon: '🌳', desc: '+250/sec', flavor: 'Cryptographic proof tree', base: 100000, g: 1.35, ps: 250, lv: 0, cat: 'a' },
    { id: 'quantum', name: 'Quantum Shield', icon: '🛡️', desc: '+1K/sec', flavor: 'Post-quantum consensus armor', base: 500000, g: 1.4, ps: 1000, lv: 0, cat: 'a' },
    { id: 'luck', name: 'Lucky Nonce', icon: '🍀', desc: '2× golden', flavor: 'Better golden block chance', base: 5000, g: 1.5, lv: 0, cat: 's' },
    { id: 'turbo', name: 'Overclock', icon: '🚀', desc: '2× output', flavor: 'Double all production', base: 50000, g: 2, lv: 0, cat: 's' },
];
const ACHS = [
    { id: 'a1', l: '⛏️ First Block', c: (t: number) => t >= 1 },
    { id: 'a2', l: '💯 Century', c: (t: number) => t >= 100 },
    { id: 'a3', l: '📦 1K', c: (t: number) => t >= 1e3 },
    { id: 'a4', l: '🔥 10K', c: (t: number) => t >= 1e4 },
    { id: 'a5', l: '💎 100K', c: (t: number) => t >= 1e5 },
    { id: 'a6', l: '🏆 1M', c: (t: number) => t >= 1e6 },
    { id: 'a7', l: '₿ 1 BTC', c: (t: number) => t >= 1e8 },
];
const EP = 5;
const fs = (n: number): string => { if (n >= 1e8) return (n / 1e8).toFixed(4) + ' BTC'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return Math.floor(n).toString() };
const co = (u: Up) => Math.floor(u.base * Math.pow(u.g, u.lv));
const ld = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } };

/* ─── 6 evolution stages ─── */
const STAGES = [
    { name: 'Genesis Node', color: '#F7931A', ring: 'rgba(247,147,26,.15)', bg: 'radial-gradient(circle, #1a1200 0%, #0a0a1a 70%)', sprite: '/miner-idle.png', spriteHit: '/miner-hit.png' },
    { name: 'WASM Core', color: '#0ea5e9', ring: 'rgba(14,165,233,.2)', bg: 'radial-gradient(circle, #001520 0%, #0a0a1a 70%)', sprite: '/miner-idle.png', spriteHit: '/miner-hit.png' },
    { name: 'Consensus Hub', color: '#a78bfa', ring: 'rgba(167,139,250,.2)', bg: 'radial-gradient(circle, #120020 0%, #0a0a1a 70%)', sprite: '/mining-rig.png', spriteHit: '/mining-rig.png' },
    { name: 'Quantum Forge', color: '#22c55e', ring: 'rgba(34,197,94,.2)', bg: 'radial-gradient(circle, #002010 0%, #0a0a1a 70%)', sprite: '/mining-rig.png', spriteHit: '/mining-rig.png' },
    { name: 'Epoch Array', color: '#eab308', ring: 'rgba(234,179,8,.2)', bg: 'radial-gradient(circle, #1a1500 0%, #0a0a1a 70%)', sprite: '/mining-farm.png', spriteHit: '/mining-farm.png' },
    { name: 'Merkle Matrix', color: '#ec4899', ring: 'rgba(236,72,153,.2)', bg: 'radial-gradient(circle, #1a0015 0%, #0a0a1a 70%)', sprite: '/mining-farm.png', spriteHit: '/mining-farm.png' },
];

const SatoshiMiner: React.FC = () => {
    const [sats, setSats] = useState<number>(() => ld('sm_s', 0));
    const [tot, setTot] = useState<number>(() => ld('sm_t', 0));
    const [ups, setUps] = useState<Up[]>(() => ld('sm_u', UPS));
    const [blk, setBlk] = useState<number>(() => ld('sm_b', 0));
    const [hlv, setHlv] = useState<number>(() => ld('sm_h', 0));
    const [fx, setFx] = useState<FX[]>([]);
    const [hitting, setHitting] = useState(false);
    const [flash, setFlash] = useState(false);
    const [upgFlash, setUpgFlash] = useState('');
    const [shockwave, setShockwave] = useState(false);
    const [imgErr, setImgErr] = useState(false);
    const fidRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sparksRef = useRef<Spark[]>([]);
    const animRef = useRef(0);

    // Derived
    const totalUpgrades = ups.reduce((s, u) => s + u.lv, 0);
    const stageIdx = Math.min(STAGES.length - 1, Math.floor(totalUpgrades / 3));
    const stage = STAGES[stageIdx];
    const lkLv = ups.find(u => u.id === 'luck')?.lv || 0;
    const tbLv = ups.find(u => u.id === 'turbo')?.lv || 0;
    const tm = Math.pow(2, tbLv);
    const spc = (1 + ups.filter(u => u.cat === 'c').reduce((s, u) => s + (u.pc || 0) * u.lv, 0)) * tm;
    const sps = ups.filter(u => u.cat === 'a').reduce((s, u) => s + (u.ps || 0) * u.lv, 0) * tm;
    const br = Math.max(1, Math.floor(50 / Math.pow(2, hlv)));
    const epochBlocks = blk % EP;
    const epochNum = Math.floor(blk / EP);
    const gc = 0.03 * Math.pow(2, lkLv);

    // Canvas particles
    useEffect(() => {
        const cvs = canvasRef.current; if (!cvs) return;
        const ctx = cvs.getContext('2d'); if (!ctx) return;
        cvs.width = cvs.offsetWidth * 2; cvs.height = cvs.offsetHeight * 2; ctx.scale(2, 2);
        const w = cvs.offsetWidth, h = cvs.offsetHeight;
        const ambient: { x: number; y: number; vx: number; vy: number; r: number; a: number; color: string }[] = [];
        for (let i = 0; i < 35; i++) {
            ambient.push({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 - .15,
                r: Math.random() * 2.5 + .5, a: Math.random() * .5,
                color: [stage.color, '#F7931A', '#0ea5e9', '#a78bfa', '#eab308'][Math.floor(Math.random() * 5)]
            });
        }
        let run = true;
        const loop = () => {
            if (!run) return;
            ctx.clearRect(0, 0, w, h);
            for (const p of ambient) {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.color; ctx.globalAlpha = p.a + Math.sin(Date.now() / 800 + p.x) * .2; ctx.fill();
            }
            const sp = sparksRef.current;
            for (let i = sp.length - 1; i >= 0; i--) {
                const s = sp[i]; s.x += s.vx; s.y += s.vy; s.vy += .06; s.life -= .018;
                if (s.life <= 0) { sp.splice(i, 1); continue }
                ctx.beginPath(); ctx.arc(s.x, s.y, 2.5 * s.life, 0, Math.PI * 2);
                ctx.fillStyle = s.color; ctx.globalAlpha = s.life; ctx.fill();
                // Trail
                ctx.beginPath(); ctx.arc(s.x - s.vx, s.y - s.vy, 1.5 * s.life, 0, Math.PI * 2);
                ctx.globalAlpha = s.life * .4; ctx.fill();
            }
            ctx.globalAlpha = 1;
            // Center glow
            const cx = w / 2, cy = h / 2 - 10;
            const grad = ctx.createRadialGradient(cx, cy, 15, cx, cy, 100);
            grad.addColorStop(0, stage.ring); grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad; ctx.fillRect(cx - 100, cy - 100, 200, 200);
            animRef.current = requestAnimationFrame(loop);
        };
        loop();
        return () => { run = false; cancelAnimationFrame(animRef.current) };
    }, [stageIdx, stage.color, stage.ring]);

    // Auto-mine
    useEffect(() => { if (sps <= 0) return; const iv = setInterval(() => { setSats(p => p + sps / 10); setTot(p => p + sps / 10) }, 100); return () => clearInterval(iv) }, [sps]);
    // Auto blocks
    useEffect(() => { const r = Math.max(2000, 10000 - Math.min(8000, sps * 8)); const iv = setInterval(() => { setBlk(p => { const nb = p + 1; if (nb % EP === 0) { setHlv(h => h + 1); setFlash(true); setTimeout(() => setFlash(false), 400) } const g = Math.random() < gc; const rw = g ? br * 10 : br; setSats(s => s + rw); setTot(t => t + rw); return nb }) }, r); return () => clearInterval(iv) }, [sps, br, gc]);
    // Save
    useEffect(() => { const sv = () => { localStorage.setItem('sm_s', JSON.stringify(Math.floor(sats))); localStorage.setItem('sm_t', JSON.stringify(Math.floor(tot))); localStorage.setItem('sm_u', JSON.stringify(ups)); localStorage.setItem('sm_b', JSON.stringify(blk)); localStorage.setItem('sm_h', JSON.stringify(hlv)) }; const iv = setInterval(sv, 2000); return () => { clearInterval(iv); sv() } }, [sats, tot, ups, blk, hlv]);

    const click = useCallback((e: React.MouseEvent) => {
        const el = e.currentTarget as HTMLElement; const r = el.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const g = Math.random() < gc; const v = g ? spc * 5 : spc;
        setSats(p => p + v); setTot(p => p + v);
        const id = fidRef.current++;
        setFx(p => [...p, { id, x, y, v, gold: g }]);
        setTimeout(() => setFx(p => p.filter(f => f.id !== id)), 800);
        // Hit animation
        setHitting(true); setTimeout(() => setHitting(false), 200);
        // Shockwave on golden
        if (g) { setShockwave(true); setTimeout(() => setShockwave(false), 500); }
        // Canvas sparks
        const cvs = canvasRef.current;
        if (cvs) {
            const cr = cvs.getBoundingClientRect();
            const sx = e.clientX - cr.left, sy = e.clientY - cr.top;
            const cnt = g ? 28 : 14;
            for (let i = 0; i < cnt; i++) {
                const a = (Math.PI * 2 / cnt) * i + Math.random() * .4;
                const sp = 2 + Math.random() * 4;
                sparksRef.current.push({ id: Date.now() + i, x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 1, color: g ? '#eab308' : stage.color });
            }
        }
    }, [spc, gc, stage.color]);

    const buy = useCallback((uid: string) => {
        const u = ups.find(x => x.id === uid);
        if (!u || sats < co(u)) return;
        setSats(p => p - co(u));
        setUps(p => p.map(x => x.id === uid ? { ...x, lv: x.lv + 1 } : x));
        localStorage.setItem('sm_upgraded', '1');
        setUpgFlash(uid); setTimeout(() => setUpgFlash(''), 600);
        // Upgrade burst
        const cvs = canvasRef.current;
        if (cvs) {
            const cx = cvs.offsetWidth / 2, cy = cvs.offsetHeight / 2;
            for (let i = 0; i < 24; i++) {
                const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 5;
                sparksRef.current.push({ id: Date.now() + i, x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: '#22c55e' });
            }
        }
    }, [ups, sats]);

    const ren = (cat: string, title: string) => (
        <React.Fragment key={cat}>
            <div className="ut">{title}</div>
            {ups.filter(u => u.cat === cat).map(u => {
                const c = co(u), lk = sats < c;
                return (
                    <div key={u.id} className={`uc ${lk ? 'dim' : ''} ${upgFlash === u.id ? 'uc-flash' : ''}`} onClick={() => !lk && buy(u.id)} title={u.flavor}>
                        <div className="ui">{u.icon}</div>
                        <div className="ub"><div className="un">{u.name}{u.lv > 0 && <span className="ul">Lv.{u.lv}</span>}</div><div className="ud">{u.flavor}</div></div>
                        <div className="uv">{fs(c)}</div>
                    </div>
                );
            })}
        </React.Fragment>
    );

    // Which sprite to show based on auto miners
    const autoLv = ups.filter(u => u.cat === 'a').reduce((s, u) => s + u.lv, 0);

    return (
        <div className="mg">
            <div className="mz-wrap" style={{ background: stage.bg, borderRadius: 'var(--radl)', border: '1px solid var(--bd)', overflow: 'hidden', position: 'relative' }}>
                <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />
                {flash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(234,179,8,.1)', zIndex: 2, pointerEvents: 'none', borderRadius: 'var(--radl)', animation: 'fadeIn .15s ease' }} />}

                <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 16px', minHeight: 460 }}>
                    {/* Stage label */}
                    <div style={{ fontFamily: 'var(--fm)', fontSize: '.58rem', color: stage.color, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: stage.color, boxShadow: `0 0 8px ${stage.color}`, animation: 'blink 2s infinite' }} />
                        {stage.name} · Stage {stageIdx + 1}/{STAGES.length}
                    </div>

                    {/* Character sprite */}
                    <div style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }} onClick={click}>
                        {/* Shockwave on golden */}
                        {shockwave && <div style={{
                            position: 'absolute', inset: -60, borderRadius: '50%',
                            border: `2px solid ${stage.color}`,
                            animation: 'shockwave .5s ease-out forwards',
                            pointerEvents: 'none', zIndex: 5
                        }} />}

                        {/* Pulsing rings */}
                        <div style={{
                            position: 'absolute', inset: -20, borderRadius: '50%',
                            border: `1px solid ${stage.ring}`,
                            animation: 'ringPulse 2.5s ease-in-out infinite',
                            pointerEvents: 'none'
                        }} />
                        <div style={{
                            position: 'absolute', inset: -40, borderRadius: '50%',
                            border: `1px solid ${stage.ring.replace(/[\d.]+\)$/, '.05)')}`,
                            animation: 'ringPulse 2.5s ease-in-out infinite .6s',
                            pointerEvents: 'none'
                        }} />
                        <div style={{
                            position: 'absolute', inset: -60, borderRadius: '50%',
                            border: `1px solid ${stage.ring.replace(/[\d.]+\)$/, '.03)')}`,
                            animation: 'ringPulse 3s ease-in-out infinite 1.2s',
                            pointerEvents: 'none'
                        }} />

                        {/* Sprite image or CSS fallback */}
                        {imgErr ? (
                            <div style={{
                                width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '5rem', filter: `drop-shadow(0 0 24px ${stage.color})`,
                                transition: 'transform .1s',
                                transform: hitting ? 'scale(1.12) rotate(-8deg)' : 'scale(1)',
                                background: `radial-gradient(circle, ${stage.ring}, transparent 70%)`,
                                borderRadius: '50%'
                            }}>
                                {stageIdx < 2 ? '⛏️' : stageIdx < 4 ? '🖥️' : '🏭'}
                            </div>
                        ) : (
                            <img
                                src={hitting ? stage.spriteHit : stage.sprite}
                                alt="miner"
                                onError={() => setImgErr(true)}
                                style={{
                                    width: 160, height: 160, objectFit: 'contain',
                                    filter: `drop-shadow(0 0 24px ${stage.color}) ${hitting ? 'brightness(1.4) saturate(1.3)' : 'brightness(1)'}`,
                                    transition: 'filter .1s, transform .1s',
                                    transform: hitting ? 'scale(1.1) rotate(-6deg)' : 'scale(1)',
                                    imageRendering: 'pixelated',
                                }}
                            />
                        )}

                        {/* Fly-up numbers */}
                        {fx.map(f => (
                            <div key={f.id} className="flu" style={{
                                left: f.x - 30, top: f.y - 20,
                                color: f.gold ? 'var(--y)' : stage.color,
                                fontSize: f.gold ? '1.3rem' : '1rem',
                                textShadow: `0 0 14px ${f.gold ? 'rgba(234,179,8,.7)' : stage.ring}`,
                            }}>+{fs(f.v)}{f.gold ? ' ⭐' : ''}</div>
                        ))}

                        {/* Click hint */}
                        <div style={{ textAlign: 'center', marginTop: 6, fontSize: '.55rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            ⛏ Click to mine
                        </div>
                    </div>

                    {/* Auto miners visual */}
                    {autoLv > 0 && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 14, alignItems: 'center' }}>
                            {autoLv >= 1 && <img src="/mining-rig.png" alt="rig" style={{ width: 36, height: 36, imageRendering: 'pixelated', opacity: .7, animation: 'bob 2s ease-in-out infinite', filter: `drop-shadow(0 0 6px ${stage.color})` }} />}
                            {autoLv >= 5 && <img src="/mining-rig.png" alt="rig" style={{ width: 36, height: 36, imageRendering: 'pixelated', opacity: .7, animation: 'bob 2s ease-in-out infinite .3s', filter: `drop-shadow(0 0 6px ${stage.color})` }} />}
                            {autoLv >= 10 && <img src="/mining-farm.png" alt="farm" style={{ width: 44, height: 44, imageRendering: 'pixelated', opacity: .8, animation: 'bob 2.5s ease-in-out infinite .5s', filter: `drop-shadow(0 0 8px ${stage.color})` }} />}
                            {autoLv >= 20 && <img src="/mining-farm.png" alt="farm" style={{ width: 44, height: 44, imageRendering: 'pixelated', opacity: .8, animation: 'bob 2.5s ease-in-out infinite .8s', filter: `drop-shadow(0 0 8px ${stage.color})` }} />}
                            <div style={{ fontSize: '.55rem', color: 'var(--t4)', marginLeft: 4 }}>⚡ {autoLv} miners active</div>
                        </div>
                    )}

                    {/* Sats display */}
                    <div className="sd" style={{ marginTop: 16 }}>
                        <div className="sd-b" style={{
                            background: `linear-gradient(135deg,${stage.color},var(--y))`,
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'
                        }}>{fs(sats)}</div>
                        <div className="sd-s">satoshis</div>
                        {sps > 0 && <div className="sd-r">+{fs(sps)}/sec</div>}
                    </div>

                    <div className="gs">
                        <span>⛏️ {fs(spc)}/click</span>
                        <span>📦 #{blk.toLocaleString()}</span>
                        <span style={{ color: stage.color }}>🔄 Epoch {epochNum}</span>
                        <span>💰 {br}/block</span>
                    </div>
                    <div className="hb"><div className="hf" style={{ width: `${(epochBlocks / EP) * 100}%`, background: `linear-gradient(90deg,${stage.color},var(--y))` }} /></div>
                    <div style={{ fontSize: '.52rem', color: 'var(--t4)', marginTop: 2 }}>{epochBlocks}/{EP} blocks · {totalUpgrades} upgrades</div>
                    <div className="ar">{ACHS.map(a => <span key={a.id} className={`ach ${a.c(tot) ? 'on' : ''}`}>{a.l}</span>)}</div>
                </div>
            </div>

            {/* Sidebar */}
            <div>
                <div className="P" style={{ padding: 12, marginBottom: 6 }}>
                    <div className="Lb" style={{ marginBottom: 4 }}>📊 Network</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                        <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--fm)', fontWeight: 700, color: stage.color, fontSize: '.85rem' }}>{fs(tot)}</div><div style={{ fontSize: '.48rem', color: 'var(--t4)' }}>Total Mined</div></div>
                        <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--fm)', fontWeight: 700, color: 'var(--g)', fontSize: '.85rem' }}>{sps.toFixed(1)}/s</div><div style={{ fontSize: '.48rem', color: 'var(--t4)' }}>Hash Rate</div></div>
                    </div>
                </div>
                <div className="ucol">{ren('c', '⚙️ CONSENSUS')}{ren('a', '⛏️ MINING')}{ren('s', '✨ SPECIAL')}</div>
            </div>
        </div>
    );
};
export default SatoshiMiner;
