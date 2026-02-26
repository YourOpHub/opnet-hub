import React, { useState, useRef } from 'react';

const OP20_REPO = 'https://github.com/btc-vision/OP_20';
const DOCS_DEPLOY = 'https://docs.opnet.org';
const FAUCET = 'https://faucet.opnet.org';

interface WalletProvider {
  requestAccounts: () => Promise<string[]>;
  signTransaction?: (txHex: string) => Promise<string>;
  sendBitcoin?: (to: string, amount: number) => Promise<string>;
  deploy?: (params: { bytecode: string; salt: string; calldata: string }) => Promise<{ txid: string; contractAddress: string }>;
  signMessage?: (msg: string) => Promise<string>;
}

function getWallet(): WalletProvider | null {
  const w = (window as unknown as { opnet?: WalletProvider; unisat?: WalletProvider });
  return w.opnet || w.unisat || null;
}

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

/** Build OP-20 deploy calldata (ABI-encoded constructor params) */
function buildCalldata(name: string, symbol: string, decimals: number, maxSupply: string): string {
  const enc = new TextEncoder();
  const nB = enc.encode(name);
  const sB = enc.encode(symbol);
  const parts: number[] = [];
  // selector: 4 bytes "deploy" = 0x00000001
  parts.push(0, 0, 0, 1);
  // name length (2 bytes) + name bytes
  parts.push((nB.length >> 8) & 0xff, nB.length & 0xff);
  for (const b of nB) parts.push(b);
  // symbol length (2 bytes) + symbol bytes
  parts.push((sB.length >> 8) & 0xff, sB.length & 0xff);
  for (const b of sB) parts.push(b);
  // decimals (1 byte)
  parts.push(decimals & 0xff);
  // maxSupply as 32-byte big-endian
  const supplyBig = BigInt(maxSupply);
  for (let i = 31; i >= 0; i--) {
    parts.push(Number((supplyBig >> BigInt(i * 8)) & 0xFFn));
  }
  return Array.from(parts).map(b => b.toString(16).padStart(2, '0')).join('');
}

const TokenLauncher: React.FC = () => {
  const [form, setForm] = useState({ name: '', symbol: '', supply: '', decimals: '8', desc: '' });
  const [img, setImg] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ txid: string; contractAddress: string } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const [wasmFile, setWasmFile] = useState<Uint8Array | null>(null);
  const [wasmName, setWasmName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const wasmRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setImg(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const handleWasm = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setWasmName(f.name);
    const r = new FileReader();
    r.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer;
      setWasmFile(new Uint8Array(buf));
    };
    r.readAsArrayBuffer(f);
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

  const deployToken = async () => {
    setDeployError(null);
    setDeployResult(null);
    const wallet = getWallet();
    if (!wallet) {
      setDeployError('No wallet detected. Install OP_WALLET or UniSat extension.');
      return;
    }
    if (!wasmFile) {
      setDeployError('Upload the compiled .wasm contract file first.');
      return;
    }
    setDeploying(true);
    try {
      // 1. Connect wallet
      const accounts = await wallet.requestAccounts();
      if (!accounts?.length) throw new Error('Wallet connection rejected');

      // 2. Build calldata
      const calldata = buildCalldata(config.name, config.symbol, config.decimals, rawSupply);
      const bytecodeHex = Array.from(wasmFile).map(b => b.toString(16).padStart(2, '0')).join('');
      const salt = Date.now().toString(16).padStart(64, '0');

      // 3. Deploy via wallet
      if (wallet.deploy) {
        const result = await wallet.deploy({ bytecode: bytecodeHex, salt, calldata });
        setDeployResult(result);
        localStorage.setItem('hub_token_launched', '1');
        localStorage.setItem('hub_last_deploy', JSON.stringify({ ...config, txid: result.txid, contractAddress: result.contractAddress, time: Date.now() }));
      } else {
        // Fallback: wallet doesn't have deploy method — show manual instructions
        setDeployError('Your wallet does not support direct deployment. Use the manual steps below.');
        setStepsOpen(true);
      }
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🚀 OP-20 Token Launcher</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Configure your token, upload the compiled WASM contract, and deploy directly on Bitcoin L1 via OP_WALLET.
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

            {/* WASM Upload */}
            <div className="upload-zone" style={{ gridColumn: '1/-1', borderColor: wasmFile ? 'var(--g)' : undefined }} onClick={() => wasmRef.current?.click()}>
              <input ref={wasmRef} type="file" accept=".wasm" onChange={handleWasm} style={{ display: 'none' }} />
              {wasmFile
                ? <div style={{ color: 'var(--g)', fontWeight: 600 }}>✓ {wasmName} ({(wasmFile.length / 1024).toFixed(1)} KB)</div>
                : <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>📦</div>}
              <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>{wasmFile ? 'Click to change WASM' : 'Upload compiled .wasm contract *'}</div>
            </div>

            {/* Deploy Button */}
            <button
              className="lbtn"
              onClick={deployToken}
              disabled={!form.name || !form.symbol || !form.supply || deploying}
              style={{ gridColumn: '1/-1', opacity: deploying ? 0.6 : 1 }}
            >
              {deploying ? '⏳ Deploying via OP_WALLET…' : '� Deploy Token'}
            </button>

            {/* Deploy Result */}
            {deployResult && (
              <div style={{ gridColumn: '1/-1', padding: 12, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8 }}>
                <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✅ Token Deployed!</div>
                <div style={{ fontSize: '.75rem', color: 'var(--t2)', wordBreak: 'break-all' }}>
                  <strong>TX:</strong> {deployResult.txid}<br />
                  <strong>Contract:</strong> {deployResult.contractAddress}
                </div>
              </div>
            )}
            {deployError && (
              <div style={{ gridColumn: '1/-1', padding: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8 }}>
                <div style={{ color: '#ef4444', fontSize: '.8rem' }}>⚠️ {deployError}</div>
              </div>
            )}

            {/* Manual fallback toggle */}
            <button className="btn-s" style={{ gridColumn: '1/-1', fontSize: '.75rem' }} onClick={() => setStepsOpen(!stepsOpen)}>
              {stepsOpen ? 'Hide manual steps' : "No wallet? See manual deploy steps"}
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

      {stepsOpen && (
        <div className="P" style={{ marginTop: 16, padding: 20 }}>
          <div className="Lb">📋 Manual Deploy Steps</div>
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
            <div className="rr" style={{ marginTop: 6 }}><span className="rk">4</span><span className="rv">Get testnet BTC from <a href={FAUCET} target="_blank" rel="noopener noreferrer">faucet.opnet.org</a></span></div>
            <div className="rr" style={{ marginTop: 6 }}><span className="rk">5</span><span className="rv">In OP_WALLET: Deploy → drag your <code>.wasm</code> file</span></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <a href={DOCS_DEPLOY} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>Full docs →</a>
          </div>
        </div>
      )}
    </div>
  );
};
export default TokenLauncher;
