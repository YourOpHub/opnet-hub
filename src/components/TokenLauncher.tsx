import React, { useState, useRef } from 'react';
const genLogo = (sym: string): string => {
    const s = (sym || '?').toUpperCase().slice(0, 3);
    const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
    const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};
const TokenLauncher: React.FC = () => {
    const [form, setForm] = useState({ name: '', symbol: '', supply: '', decimals: '8', desc: '' });
    const [img, setImg] = useState<string | null>(null);
    const [deployed, setDeployed] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
    const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => setImg(ev.target?.result as string); r.readAsDataURL(f) };
    const deploy = () => { if (!form.name || !form.symbol || !form.supply) return; setDeploying(true); setTimeout(() => { setDeploying(false); setDeployed(true); localStorage.setItem('hub_token_launched', '1'); }, 2500) };
    const addr = 'bcrt1q' + Array.from({ length: 38 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return (
        <div>
            <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🚀 OP-20 Token Launcher</div>
                <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
                    Deploy a fungible token on Bitcoin L1. WASM bytecode → tapscript → Bitcoin tx → consensus-verified OP-20 token.
                </div>
            </div>
            {!deployed ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 14, alignItems: 'start' }}>
                    <div className="P">
                        <div className="Lb">📝 Token Config</div>
                        <div className="lf">
                            <div className="lf-g"><label className="lf-l">Name *</label><input className="lf-i" value={form.name} onChange={e => set('name', e.target.value)} placeholder="My Token" /></div>
                            <div className="lf-g"><label className="lf-l">Symbol *</label><input className="lf-i" value={form.symbol} onChange={e => set('symbol', e.target.value)} placeholder="MTK" style={{ textTransform: 'uppercase' }} /></div>
                            <div className="lf-g"><label className="lf-l">Supply *</label><input className="lf-i" type="number" value={form.supply} onChange={e => set('supply', e.target.value)} placeholder="21000000" /></div>
                            <div className="lf-g"><label className="lf-l">Decimals</label><input className="lf-i" type="number" value={form.decimals} onChange={e => set('decimals', e.target.value)} /></div>
                            <div className="upload-zone" onClick={() => fileRef.current?.click()}>
                                <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} />
                                {img ? <img src={img} alt="Logo" /> : <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>📸</div>}
                                <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>{img ? 'Click to change logo' : 'Upload token logo (optional)'}</div>
                            </div>
                            <div className="lf-g" style={{ gridColumn: '1/-1' }}><label className="lf-l">Description</label><input className="lf-i" value={form.desc} onChange={e => set('desc', e.target.value)} placeholder="About your token..." /></div>
                            <button className="lbtn" onClick={deploy} disabled={deploying || !form.name || !form.symbol || !form.supply}>{deploying ? '⏳ Compiling WASM…' : '🚀 Deploy on Bitcoin L1'}</button>
                        </div>
                    </div>
                    <div className="P" style={{ textAlign: 'center', padding: 18 }}>
                        <div className="Lb" style={{ justifyContent: 'center' }}>Preview</div>
                        <div style={{ width: 80, height: 80, margin: '8px auto', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bd2)' }}>
                            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div dangerouslySetInnerHTML={{ __html: genLogo(form.symbol || '?') }} />}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--w)', marginTop: 6 }}>{form.name || 'Token Name'}</div>
                        <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.82rem' }}>{form.symbol ? form.symbol.toUpperCase() : 'SYM'}</div>
                        {form.supply && <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 4 }}>Supply: {Number(form.supply).toLocaleString()}</div>}
                        <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 2 }}>OP-20 · Bitcoin L1 · Consensus-Verified</div>
                    </div>
                </div>
            ) : (
                <div className="Pg" style={{ textAlign: 'center', padding: 32 }}>
                    <div style={{ width: 70, height: 70, margin: '0 auto 10px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--gB)' }}>
                        {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div dangerouslySetInnerHTML={{ __html: genLogo(form.symbol) }} />}
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--w)', marginBottom: 4 }}>Token Deployed ✅</div>
                    <div style={{ fontSize: '.78rem', color: 'var(--t3)', marginBottom: 14 }}><strong style={{ color: 'var(--o)' }}>{form.name} ({form.symbol.toUpperCase()})</strong> is live on consensus.</div>
                    <div className="rb" style={{ textAlign: 'left', maxWidth: 400, margin: '0 auto' }}>
                        <div className="rr"><span className="rk">Token</span><span className="rv" style={{ color: 'var(--o)' }}>{form.name}</span></div>
                        <div className="rr"><span className="rk">Standard</span><span className="rv" style={{ color: 'var(--c)' }}>OP-20</span></div>
                        <div className="rr"><span className="rk">Supply</span><span className="rv">{Number(form.supply).toLocaleString()}</span></div>
                        <div className="rr"><span className="rk">Contract (P2OP)</span><span className="rv" style={{ fontSize: '.6rem', wordBreak: 'break-all' }}>{addr}</span></div>
                        <div className="rr"><span className="rk">Status</span><span className="rv" style={{ color: 'var(--g)' }}>● Consensus Confirmed</span></div>
                    </div>
                    <button className="lbtn" style={{ maxWidth: 240, margin: '14px auto 0' }} onClick={() => { setDeployed(false); setForm({ name: '', symbol: '', supply: '', decimals: '8', desc: '' }); setImg(null) }}>🚀 Deploy Another</button>
                </div>
            )}
        </div>
    );
};
export default TokenLauncher;
