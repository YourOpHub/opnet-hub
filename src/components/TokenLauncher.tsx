import React, { useState, useRef } from 'react';

const OP20_REPO = 'https://github.com/btc-vision/OP_20';
const DOCS_DEPLOY = 'https://docs.opnet.org';
const FAUCET = 'https://faucet.opnet.org';

const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

/** maxSupply with decimals: e.g. 21e6 with 8 decimals = 2100000000000000n */
function toRawSupply(supply: string, decimals: string): string {
  const d = Math.min(18, Math.max(0, parseInt(decimals, 10) || 8));
  const [whole, frac = ''] = supply.split('.');
  const combined = whole.replace(/\D/g, '') + frac.slice(0, d).padEnd(d, '0');
  return combined || '0';
}

const TokenLauncher: React.FC = () => {
  const [form, setForm] = useState({ name: '', symbol: '', supply: '', decimals: '8', desc: '' });
  const [img, setImg] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setImg(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const rawSupply = toRawSupply(form.supply, form.decimals);
  const config = {
    name: form.name || 'My Token',
    symbol: (form.symbol || 'MTK').toUpperCase(),
    decimals: parseInt(form.decimals, 10) || 8,
    maxSupply: rawSupply,
    description: form.desc || '',
  };

  const copyConfig = () => {
    const text = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setConfigCopied(true);
      setTimeout(() => setConfigCopied(false), 2000);
    });
  };

  const openSteps = () => {
    if (!form.name || !form.symbol || !form.supply) return;
    localStorage.setItem('hub_token_launched', '1');
    setStepsOpen(true);
  };

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🚀 OP-20 Token Launcher</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Configure your token, then build the contract from the OP_20 template and deploy with OP_WALLET. Real deployment on Bitcoin L1.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 14, alignItems: 'start' }}>
        <div className="P">
          <div className="Lb">📝 Token Config</div>
          <div className="lf">
            <div className="lf-g"><label className="lf-l">Name *</label><input className="lf-i" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My Token" /></div>
            <div className="lf-g"><label className="lf-l">Symbol *</label><input className="lf-i" value={form.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="MTK" style={{ textTransform: 'uppercase' }} /></div>
            <div className="lf-g"><label className="lf-l">Max supply *</label><input className="lf-i" type="text" inputMode="decimal" value={form.supply} onChange={(e) => set('supply', e.target.value)} placeholder="21000000" /></div>
            <div className="lf-g"><label className="lf-l">Decimals</label><input className="lf-i" type="number" value={form.decimals} onChange={(e) => set('decimals', e.target.value)} /></div>
            <div className="upload-zone" onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} />
              {img ? <img src={img} alt="Logo" /> : <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>📸</div>}
              <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>{img ? 'Click to change logo' : 'Upload token logo (optional)'}</div>
            </div>
            <div className="lf-g" style={{ gridColumn: '1/-1' }}><label className="lf-l">Description</label><input className="lf-i" value={form.desc} onChange={(e) => set('desc', e.target.value)} placeholder="About your token..." /></div>
            <button className="lbtn" onClick={openSteps} disabled={!form.name || !form.symbol || !form.supply}>
              📋 Generate config &amp; show deploy steps
            </button>
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
          <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 2 }}>OP-20 · Bitcoin L1</div>
        </div>
      </div>

      {stepsOpen && (
        <div className="P" style={{ marginTop: 16, padding: 20 }}>
          <div className="Lb">📋 Deploy steps (real OP_NET)</div>
          <div className="rb" style={{ marginTop: 10 }}>
            <div className="rr"><span className="rk">1</span><span className="rv">Clone the OP_20 template:</span></div>
            <div style={{ marginLeft: 12, fontFamily: 'var(--fm)', fontSize: '.8rem', color: 'var(--t2)', wordBreak: 'break-all' }}>
              <a href={OP20_REPO} target="_blank" rel="noopener noreferrer">{OP20_REPO}</a>
            </div>
            <div className="rr" style={{ marginTop: 10 }}><span className="rk">2</span><span className="rv">In <code>src/contracts/token/MyToken.ts</code> set:</span></div>
            <pre style={{ marginLeft: 12, padding: 10, background: 'var(--bg3)', borderRadius: 8, fontSize: '.7rem', overflow: 'auto' }}>
{`maxSupply: u256.fromString('${rawSupply}')
decimals: ${config.decimals}
name: '${config.name}'
symbol: '${config.symbol}'`}
            </pre>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">3</span><span className="rv">Build: <code>npm run build:token</code></span></div>
            <div className="rr" style={{ marginTop: 6 }}><span className="rk">4</span><span className="rv">Get regtest BTC from <a href={FAUCET} target="_blank" rel="noopener noreferrer">faucet.opnet.org</a></span></div>
            <div className="rr" style={{ marginTop: 6 }}><span className="rk">5</span><span className="rv">In OP_WALLET: Deploy → drag your <code>.wasm</code> file</span></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="lbtn" style={{ flex: 0 }} onClick={copyConfig}>
              {configCopied ? '✓ Copied' : 'Copy config JSON'}
            </button>
            <a href={DOCS_DEPLOY} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>Full docs →</a>
          </div>
        </div>
      )}
    </div>
  );
};
export default TokenLauncher;
