import React, { useState, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import * as opnet from '../opnet';
import { getTxUrl } from '../contracts';

const OP20_REPO = 'https://github.com/btc-vision/OP_20';
const DOCS_DEPLOY = 'https://docs.opnet.org';
const FAUCET = 'https://faucet.opnet.org';
const OPWALLET_URL = 'https://opwallet.org';

const WASM_TEMPLATES = [
  { name: 'Mine Token', symbol: 'MINE', file: 'MineToken.wasm', supply: '21,000,000', desc: 'Game token template' },
  { name: 'Vibe Token', symbol: 'VIBE', file: 'VibeToken.wasm', supply: '100,000,000', desc: 'Community token template' },
];

const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

const TokenLauncher: React.FC = () => {
  const { walletAddress, walletInstance, provider, signer, openConnectModal } = useWalletConnect();

  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [customWasm, setCustomWasm] = useState<Uint8Array | null>(null);
  const [customWasmName, setCustomWasmName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ contractAddress: string; txid: string } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wasmRef = useRef<HTMLInputElement>(null);

  // Verify deployment
  const [verifyAddr, setVerifyAddr] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; info?: string } | null>(null);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setImg(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const handleWasmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setCustomWasmName(f.name);
    const r = new FileReader();
    r.onload = (ev) => {
      if (ev.target?.result) setCustomWasm(new Uint8Array(ev.target.result as ArrayBuffer));
    };
    r.readAsArrayBuffer(f);
  };

  /** Deploy token via Web3Provider.deployContract() — wallet handles signing, MLDSA, challenge */
  const deployToken = async () => {
    if (!walletAddress || !walletInstance || !provider || !signer) {
      openConnectModal();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const web3 = (walletInstance as any).web3;
    if (!web3?.deployContract) {
      setDeployError('Your wallet does not support Web3 deployment API. Please use OP_WALLET.');
      setStepsOpen(true);
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      // 1. Get WASM bytecode — custom upload or template
      let bytecode: Uint8Array;
      if (customWasm) {
        bytecode = customWasm;
      } else {
        const tpl = WASM_TEMPLATES[selectedTemplate];
        const base = import.meta.env.BASE_URL || '/';
        const resp = await fetch(`${base}wasm/${tpl.file}`);
        if (!resp.ok) throw new Error(`Failed to fetch ${tpl.file}: ${resp.status}`);
        bytecode = new Uint8Array(await resp.arrayBuffer());
      }

      // 2. Fetch UTXOs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const utxos = await (provider as any).utxoManager.getUTXOs({
        address: signer.p2tr, optimize: true, mergePendingUTXOs: true, filterSpentUTXOs: true,
      }).catch(() => []);

      // 3. Deploy via Web3Provider — wallet handles signer + MLDSA + challenge
      const result = await web3.deployContract({
        bytecode,
        utxos: utxos || [],
        feeRate: 10,
        priorityFee: 10_000n,
        gasSatFee: 100_000n,
        revealMLDSAPublicKey: true,
        linkMLDSAPublicKeyToAddress: true,
      });

      setDeployResult({
        contractAddress: result.contractAddress,
        txid: result.transaction?.[1] || result.transaction?.[0] || '',
      });
      localStorage.setItem('hub_token_launched', '1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deployment failed';
      console.error('[Deploy]', e);
      setDeployError(msg);
    } finally {
      setDeploying(false);
    }
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
        setVerifyResult({ ok: false, info: 'No contract found. Check address or wait for confirmation.' });
      }
    } catch {
      setVerifyResult({ ok: false, info: 'RPC error — try again.' });
    } finally {
      setVerifying(false);
    }
  };

  const connected = !!walletAddress;
  const tpl = WASM_TEMPLATES[selectedTemplate];

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🚀 OP-20 Token Launcher</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 480, margin: '0 auto' }}>
          Deploy your own token on Bitcoin L1. Connect wallet → pick template or upload WASM → deploy. Real on-chain deployment!
        </div>
      </div>

      <div className="launch-grid">
        {/* Left: Deploy config */}
        <div className="P">
          <div className="Lb">� Contract Template</div>

          {/* Template selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {WASM_TEMPLATES.map((t, i) => (
              <button key={t.symbol} onClick={() => { setSelectedTemplate(i); setCustomWasm(null); }} style={{
                flex: 1, padding: '10px', borderRadius: 'var(--rad)',
                background: selectedTemplate === i && !customWasm ? 'var(--oG)' : 'var(--bg3)',
                border: `1px solid ${selectedTemplate === i && !customWasm ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`,
                color: selectedTemplate === i && !customWasm ? 'var(--o)' : 'var(--t2)',
                fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
              }}>
                <div>{t.symbol}</div>
                <div style={{ fontSize: '.6rem', fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Custom WASM upload */}
          <div style={{ marginBottom: 12 }}>
            <input ref={wasmRef} type="file" accept=".wasm" onChange={handleWasmUpload} style={{ display: 'none' }} />
            <button onClick={() => wasmRef.current?.click()} style={{
              width: '100%', padding: '10px', borderRadius: 'var(--rad)',
              background: customWasm ? 'var(--gG)' : 'var(--bg3)',
              border: `1px solid ${customWasm ? 'var(--gB)' : 'var(--bd)'}`,
              color: customWasm ? 'var(--g)' : 'var(--t3)',
              fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--ff)',
            }}>
              {customWasm ? `✓ ${customWasmName} (${(customWasm.length / 1024).toFixed(1)} KB)` : '📁 Or upload your own .wasm contract'}
            </button>
          </div>

          {/* Token logo */}
          <div className="upload-zone" onClick={() => fileRef.current?.click()} style={{ marginBottom: 12 }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} />
            {img ? <img src={img} alt="Logo" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ fontSize: '1.4rem' }}>📸</div>}
            <div style={{ fontSize: '.68rem', color: 'var(--t3)' }}>{img ? 'Change logo' : 'Token logo (optional)'}</div>
          </div>

          {/* Deploy Button */}
          {connected ? (
            <button className="lbtn" onClick={deployToken} disabled={deploying} style={{ width: '100%', opacity: deploying ? 0.6 : 1 }}>
              {deploying ? '⏳ Deploying on-chain…' : `🚀 Deploy ${customWasm ? customWasmName : tpl.symbol} Token`}
            </button>
          ) : (
            <button className="lbtn" onClick={openConnectModal}
              style={{ width: '100%', background: 'linear-gradient(135deg, #0ea5e9, #0284c7)' }}>
              Connect Wallet to Deploy
            </button>
          )}

          {connected && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--gG)', border: '1px solid var(--gB)', borderRadius: 8, fontSize: '.68rem', color: 'var(--g)' }}>
              ✓ {walletAddress.slice(0, 16)}…
            </div>
          )}

          {/* Deploy Result */}
          {deployResult && (
            <div style={{ marginTop: 10, padding: 12, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8 }}>
              <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✅ Token Deployed On-Chain!</div>
              <div style={{ fontSize: '.72rem', color: 'var(--t2)', wordBreak: 'break-all' }}>
                <strong>Contract:</strong> {deployResult.contractAddress}
              </div>
              {deployResult.txid && (
                <a href={getTxUrl(deployResult.txid)} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View Deploy TX →</a>
              )}
            </div>
          )}
          {deployError && (
            <div style={{ marginTop: 10, padding: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8 }}>
              <div style={{ color: '#ef4444', fontSize: '.78rem' }}>⚠️ {deployError}</div>
            </div>
          )}
        </div>

        {/* Right: Preview + Info */}
        <div className="P" style={{ textAlign: 'center', padding: 18 }}>
          <div className="Lb" style={{ justifyContent: 'center' }}>Preview</div>
          <div style={{ width: 80, height: 80, margin: '8px auto', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bd2)' }}>
            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div dangerouslySetInnerHTML={{ __html: genLogo(customWasm ? 'CUSTOM' : tpl.symbol) }} />}
          </div>
          <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--w)', marginTop: 6 }}>{customWasm ? customWasmName.replace('.wasm', '') : tpl.name}</div>
          <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.82rem' }}>{customWasm ? 'CUSTOM' : tpl.symbol}</div>
          {!customWasm && <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 4 }}>Supply: {tpl.supply}</div>}
          <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 2 }}>OP-20 · Bitcoin L1 · Testnet</div>

          <div style={{ marginTop: 14, textAlign: 'left', padding: '10px', background: 'var(--bg3)', borderRadius: 'var(--rad)', fontSize: '.68rem', color: 'var(--t3)' }}>
            <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>How it works:</div>
            <div>1. Pick a template or upload your compiled .wasm</div>
            <div>2. Click Deploy — your wallet signs the transaction</div>
            <div>3. Contract deploys to Bitcoin L1 via OPNet</div>
            <div>4. You get a unique contract address</div>
          </div>
        </div>
      </div>

      {/* Manual deploy steps */}
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <button className="btn-s" style={{ fontSize: '.72rem' }} onClick={() => setStepsOpen(!stepsOpen)}>
          {stepsOpen ? 'Hide' : 'Show'} custom token guide (compile your own .wasm)
        </button>
      </div>

      {stepsOpen && (
        <div className="P" style={{ marginTop: 10, padding: 20 }}>
          <div className="Lb">📋 Custom Token Guide</div>
          <div className="rb" style={{ marginTop: 10 }}>
            <div className="rr"><span className="rk">1</span><span className="rv"><strong>Install OP_WALLET</strong> — <a href={OPWALLET_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>opwallet.org</a></span></div>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">2</span><span className="rv"><strong>Get testnet BTC</strong> — <a href={FAUCET} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>faucet.opnet.org</a></span></div>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">3</span><span className="rv"><strong>Clone</strong> <a href={OP20_REPO} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>{OP20_REPO}</a></span></div>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">4</span><span className="rv"><strong>Edit</strong> token name, symbol, supply in source</span></div>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">5</span><span className="rv"><strong>Build:</strong> <code>npm run build:token</code></span></div>
            <div className="rr" style={{ marginTop: 8 }}><span className="rk">6</span><span className="rv"><strong>Upload</strong> the .wasm above and click Deploy</span></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <a href={DOCS_DEPLOY} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>Docs →</a>
            <a href={OP20_REPO} target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none' }}>Template →</a>
          </div>
        </div>
      )}

      {/* Verify Deployment */}
      <div className="P" style={{ marginTop: 14, padding: 20 }}>
        <div className="Lb">🔍 Verify Deployment</div>
        <div style={{ fontSize: '.72rem', color: 'var(--t3)', marginBottom: 8 }}>Enter your contract address to check if it's live on-chain.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="lf-i" value={verifyAddr}
            onChange={e => { setVerifyAddr(e.target.value); setVerifyResult(null); }}
            placeholder="opt1sq... (contract address)"
            style={{ flex: 1, fontSize: '.76rem' }} />
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
            <div style={{ color: verifyResult.ok ? 'var(--g)' : '#ef4444', fontWeight: 700, fontSize: '.76rem' }}>
              {verifyResult.ok ? '✅ Contract Verified On-Chain!' : '❌ Not Found'}
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--t2)', marginTop: 2 }}>{verifyResult.info}</div>
          </div>
        )}
      </div>
    </div>
  );
};
export default TokenLauncher;
