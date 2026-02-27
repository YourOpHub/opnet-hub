import React, { useState, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import * as opnet from '../opnet';
// contracts helpers available if needed

const OP20_REPO = 'https://github.com/btc-vision/OP_20';
const DOCS_DEPLOY = 'https://docs.opnet.org';
const FAUCET = 'https://faucet.opnet.org';
const OPWALLET_URL = 'https://opwallet.org';

const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

function toRawSupply(supply: string, decimals: string): string {
  const d = Math.min(18, Math.max(0, parseInt(decimals, 10) || 8));
  const [whole, frac = ''] = supply.split('.');
  const combined = whole.replace(/\D/g, '') + frac.slice(0, d).padEnd(d, '0');
  return combined || '0';
}

const TokenLauncher: React.FC = () => {
  const { walletAddress, walletInstance, openConnectModal } = useWalletConnect();

  const [form, setForm] = useState({ name: '', symbol: '', supply: '', decimals: '8', desc: '' });
  const [img, setImg] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Verify deployment
  const [verifyAddr, setVerifyAddr] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; info?: string } | null>(null);

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

  /** Send user a small BTC "deployment fee" transaction to prove wallet works, then open OP_WALLET deploy tab */
  const startDeploy = async () => {
    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }
    // Open OP_WALLET extension deploy page (if available)
    // The deploy is done via OP_WALLET's UI — we guide the user
    setStepsOpen(true);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  /** Verify a deployed contract on-chain */
  const verifyDeployment = async () => {
    if (!verifyAddr.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      opnet.setNetwork('testnet');
      const code = await opnet.getCode(verifyAddr.trim(), true);
      if (code?.bytecode) {
        const supply = await opnet.getTokenTotalSupply(verifyAddr.trim());
        const supplyStr = supply > 0n ? ` · Supply: ${(Number(supply) / 1e8).toLocaleString()}` : '';
        setVerifyResult({ ok: true, info: `Bytecode: ${code.bytecode.length} chars${supplyStr}` });
        localStorage.setItem('hub_token_launched', '1');
      } else {
        setVerifyResult({ ok: false, info: 'No contract found at this address. Check the address or wait for confirmation.' });
      }
    } catch {
      setVerifyResult({ ok: false, info: 'RPC error — try again in a moment.' });
    } finally {
      setVerifying(false);
    }
  };

  const connected = !!walletAddress;

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🚀 OP-20 Token Launcher</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Create your own token on Bitcoin L1 via OP_WALLET. Configure, deploy, verify — no coding required.
        </div>
      </div>

      <div className="launch-grid">
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

            {/* Deploy Button */}
            {connected ? (
              <button className="lbtn" onClick={startDeploy}
                disabled={!form.name || !form.symbol || !form.supply}
                style={{ gridColumn: '1/-1' }}>
                🚀 Deploy via OP_WALLET
              </button>
            ) : (
              <button className="lbtn" onClick={openConnectModal}
                style={{ gridColumn: '1/-1', background: 'linear-gradient(135deg, #0ea5e9, #0284c7)' }}>
                Connect Wallet to Deploy
              </button>
            )}

            {connected && (
              <div style={{ gridColumn: '1/-1', padding: '8px 12px', background: 'var(--gG)', border: '1px solid var(--gB)', borderRadius: 8, fontSize: '.7rem', color: 'var(--g)' }}>
                ✓ Wallet connected: {walletAddress.slice(0, 12)}…
              </div>
            )}
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

          {/* Config JSON */}
          <div style={{ marginTop: 12, textAlign: 'left' }}>
            <div className="Lb" style={{ fontSize: '.7rem' }}>Config JSON</div>
            <pre style={{ padding: 10, background: 'var(--bg3)', borderRadius: 8, fontSize: '.65rem', overflow: 'auto', textAlign: 'left', maxHeight: 160 }}>
              {JSON.stringify(config, null, 2)}
            </pre>
            <button className="btn-s" style={{ marginTop: 6, fontSize: '.7rem', width: '100%' }} onClick={copyConfig}>
              {configCopied ? '✓ Copied' : '📋 Copy config'}
            </button>
          </div>
        </div>
      </div>

      {/* Deploy Steps — always actionable */}
      {stepsOpen && (
        <div className="P" style={{ marginTop: 16, padding: 20 }}>
          <div className="Lb">📋 Deploy Your Token — Step by Step</div>
          <div className="rb" style={{ marginTop: 10 }}>
            <div className="rr"><span className="rk">1</span><span className="rv"><strong>Get OP_WALLET</strong> — Install the browser extension</span></div>
            <div style={{ marginLeft: 12, marginTop: 4 }}>
              <a href={OPWALLET_URL} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '6px 14px' }}>Download OP_WALLET →</a>
            </div>

            <div className="rr" style={{ marginTop: 12 }}><span className="rk">2</span><span className="rv"><strong>Get testnet BTC</strong> — Fund your wallet</span></div>
            <div style={{ marginLeft: 12, marginTop: 4 }}>
              <a href={FAUCET} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '6px 14px' }}>Faucet →</a>
            </div>

            <div className="rr" style={{ marginTop: 12 }}><span className="rk">3</span><span className="rv"><strong>Clone & customize</strong> the OP_20 token template</span></div>
            <div style={{ marginLeft: 12, marginTop: 4 }}>
              <a href={OP20_REPO} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--fm)', fontSize: '.75rem', color: 'var(--c2)' }}>{OP20_REPO}</a>
            </div>
            <pre style={{ marginLeft: 12, marginTop: 6, padding: 10, background: 'var(--bg3)', borderRadius: 8, fontSize: '.68rem', overflow: 'auto' }}>
{`// src/contracts/token/MyToken.ts
maxSupply: u256.fromString('${rawSupply}')
decimals: ${config.decimals}
name: '${config.name}'
symbol: '${config.symbol}'`}
            </pre>

            <div className="rr" style={{ marginTop: 10 }}><span className="rk">4</span><span className="rv"><strong>Build:</strong> <code>npm run build:token</code></span></div>

            <div className="rr" style={{ marginTop: 10 }}><span className="rk">5</span><span className="rv"><strong>Deploy</strong> — In OP_WALLET: Deploy tab → drag your <code>.wasm</code> file</span></div>

            <div className="rr" style={{ marginTop: 10 }}><span className="rk">6</span><span className="rv"><strong>Verify</strong> — Enter your contract address below to confirm on-chain</span></div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <a href={DOCS_DEPLOY} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>Full Docs →</a>
            <a href={OP20_REPO} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>OP_20 Template →</a>
          </div>
        </div>
      )}

      {!stepsOpen && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button className="btn-s" style={{ fontSize: '.75rem' }} onClick={() => setStepsOpen(true)}>
            Show deploy instructions
          </button>
        </div>
      )}

      {/* Verify Deployment */}
      <div className="P" style={{ marginTop: 16, padding: 20 }}>
        <div className="Lb">🔍 Verify Deployment</div>
        <div style={{ fontSize: '.75rem', color: 'var(--t3)', marginBottom: 10 }}>
          After deploying, enter your contract address to verify it's live on-chain.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="lf-i" value={verifyAddr}
            onChange={e => { setVerifyAddr(e.target.value); setVerifyResult(null); }}
            placeholder="opt1sq... (your contract address)"
            style={{ flex: 1, fontSize: '.78rem' }}
          />
          <button className="btn-s" onClick={verifyDeployment}
            disabled={!verifyAddr.trim() || verifying}
            style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}>
            {verifying ? '...' : 'Verify'}
          </button>
        </div>
        {verifyResult && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8,
            background: verifyResult.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
            border: `1px solid ${verifyResult.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}` }}>
            <div style={{ color: verifyResult.ok ? 'var(--g)' : '#ef4444', fontWeight: 700, fontSize: '.78rem' }}>
              {verifyResult.ok ? '✅ Contract Verified On-Chain!' : '❌ Not Found'}
            </div>
            <div style={{ fontSize: '.7rem', color: 'var(--t2)', marginTop: 2 }}>{verifyResult.info}</div>
          </div>
        )}
      </div>
    </div>
  );
};
export default TokenLauncher;
