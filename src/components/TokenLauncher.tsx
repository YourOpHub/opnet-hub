import React, { useState, useRef, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { BinaryWriter } from '@btc-vision/transaction';
import { Transaction } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import * as opnet from '../opnet';
import { getTxUrl } from '../contracts';

const FAUCET = 'https://faucet.opnet.org';
const GENERIC_WASM = 'GenericToken.wasm';
const MINTABLE_WASM = 'MintableToken.wasm';

type TokenMode = 'standard' | 'mintable';

const PRESETS = [
  { name: 'Meme Coin', symbol: 'MEME', supply: '1000000000', decimals: 8, desc: 'Billion-supply meme token' },
  { name: 'Game Gold', symbol: 'GOLD', supply: '21000000', decimals: 8, desc: 'Limited supply game token' },
  { name: 'Community Token', symbol: 'COM', supply: '100000000', decimals: 18, desc: 'Community governance token' },
];

const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

const TokenLauncher: React.FC = () => {
  const { walletAddress, walletInstance, openConnectModal } = useWalletConnect();

  // Token parameters — user fills these in
  const [tokenName, setTokenName] = useState('My Token');
  const [tokenSymbol, setTokenSymbol] = useState('MTK');
  const [tokenSupply, setTokenSupply] = useState('1000000');
  const [tokenDecimals, setTokenDecimals] = useState(8);

  // Token mode: standard (all to deployer) vs mintable (split + public mint)
  const [tokenMode, setTokenMode] = useState<TokenMode>('standard');
  const [initialMintPct, setInitialMintPct] = useState(100); // % of supply minted to deployer
  const [publicMintEnabled, setPublicMintEnabled] = useState(true);
  const [maxMintPerTx, setMaxMintPerTx] = useState('10000'); // max tokens per public mint tx

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ contractAddress: string; txid: string } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployStep, setDeployStep] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customWasm, setCustomWasm] = useState<Uint8Array | null>(null);
  const [customWasmName, setCustomWasmName] = useState('');
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

  const applyPreset = (p: typeof PRESETS[0]) => {
    setTokenName(p.name);
    setTokenSymbol(p.symbol);
    setTokenSupply(p.supply);
    setTokenDecimals(p.decimals);
    setCustomWasm(null);
  };

  /** Encode deployment calldata based on token mode */
  const encodeCalldata = (): Uint8Array => {
    const writer = new BinaryWriter();
    const supplyNum = parseFloat(tokenSupply) || 0;
    const maxSupply = BigInt(Math.floor(supplyNum)) * (10n ** BigInt(tokenDecimals));
    writer.writeU256(maxSupply);
    writer.writeU8(tokenDecimals);
    writer.writeStringWithLength(tokenName.trim() || 'Token');
    writer.writeStringWithLength(tokenSymbol.trim().toUpperCase() || 'TKN');

    if (tokenMode === 'mintable') {
      // MintableToken extra fields: initialMintAmount, publicMintEnabled, maxMintPerTx
      const initialMintAmount = (maxSupply * BigInt(initialMintPct)) / 100n;
      writer.writeU256(initialMintAmount);
      writer.writeBoolean(publicMintEnabled);
      const maxPerTx = BigInt(Math.floor(parseFloat(maxMintPerTx) || 0)) * (10n ** BigInt(tokenDecimals));
      writer.writeU256(maxPerTx);
    }
    return writer.getBuffer();
  };

  const provider = useMemo(() => getProvider(), []);

  /** Deploy token: fetch GenericToken.wasm + encode calldata → Web3Provider.deployContract() */
  const deployToken = async () => {
    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    if (!tokenName.trim() || !tokenSymbol.trim() || !tokenSupply.trim()) {
      setDeployError('Please fill in token name, symbol, and supply.');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = walletInstance as any;
    const web3 = inst.web3 || inst;
    if (!web3?.deployContract) {
      setDeployError('Your wallet does not support Web3 deployment API. Please use OP_WALLET.');
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      // 1. Get WASM bytecode
      setDeployStep('Loading contract bytecode...');
      let bytecode: Uint8Array;
      if (customWasm) {
        bytecode = customWasm;
      } else {
        const wasmFile = tokenMode === 'mintable' ? MINTABLE_WASM : GENERIC_WASM;
        const base = import.meta.env.BASE_URL || '/';
        const resp = await fetch(`${base}wasm/${wasmFile}`);
        if (!resp.ok) throw new Error(`Failed to fetch ${wasmFile}: ${resp.status}`);
        bytecode = new Uint8Array(await resp.arrayBuffer());
      }

      // 2. Encode deployment calldata with token params
      setDeployStep('Encoding token parameters...');
      const calldata = encodeCalldata();

      // 3. Fetch UTXOs from provider (required by wallet API)
      setDeployStep('Fetching UTXOs...');
      const utxos = await provider.utxoManager.getUTXOs({
        address: walletAddress,
      });
      if (!utxos || utxos.length === 0) {
        throw new Error(`No UTXOs found for your address.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC: ${FAUCET}` : ''}`);
      }

      // 4. Deploy via Web3Provider
      setDeployStep('Sign the transaction in your wallet...');
      const result = await web3.deployContract({
        bytecode,
        calldata,
        utxos,
        from: walletAddress,
        feeRate: 10,
        priorityFee: 10_000n,
        gasSatFee: 100_000n,
        revealMLDSAPublicKey: true,
        linkMLDSAPublicKeyToAddress: true,
      });

      // 5. Broadcast via RPC provider (wallet doesn't support broadcast method)
      setDeployStep('Broadcasting transactions...');
      const [fundingTxHex, deployTxHex] = result.transaction;
      console.log('[Deploy] Contract address:', result.contractAddress);
      console.log('[Deploy] Funding TX hex length:', fundingTxHex?.length);
      console.log('[Deploy] Deploy TX hex length:', deployTxHex?.length);

      // Broadcast funding TX first, then deployment TX
      if (fundingTxHex) {
        const fundResult = await provider.sendRawTransaction(fundingTxHex, false);
        console.log('[Deploy] Funding TX broadcast:', fundResult);
      }
      if (deployTxHex) {
        const deployResult = await provider.sendRawTransaction(deployTxHex, false);
        console.log('[Deploy] Deploy TX broadcast:', deployResult);
      }

      // Compute real txid from raw transaction hex
      let txid = '';
      try {
        const rawHex = deployTxHex || fundingTxHex || '';
        if (rawHex) {
          txid = Transaction.fromHex(rawHex).getId();
        }
      } catch (txErr) {
        console.warn('[Deploy] Could not compute txid from raw tx:', txErr);
        txid = result.contractPubKey || result.contractAddress || '';
      }

      setDeployStep('');
      setDeployResult({
        contractAddress: result.contractAddress || '',
        txid,
      });
      localStorage.setItem('hub_token_launched', '1');

      // Save deployed token to gallery
      const deployed = JSON.parse(localStorage.getItem('hub_deployed_tokens') || '[]');
      deployed.push({
        address: result.contractAddress || '',
        txid,
        name: tokenName.trim(),
        symbol: tokenSymbol.trim().toUpperCase(),
        supply: tokenSupply,
        decimals: tokenDecimals,
        mode: tokenMode,
        publicMint: tokenMode === 'mintable' && publicMintEnabled,
        maxMintPerTx: tokenMode === 'mintable' ? maxMintPerTx : '0',
        initialMintPct,
        deployedAt: Date.now(),
        deployer: walletAddress,
      });
      localStorage.setItem('hub_deployed_tokens', JSON.stringify(deployed));
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Deployment failed';
      if (msg.toLowerCase().includes('no utxo')) {
        msg = `Your wallet has no BTC UTXOs.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC from the faucet first: https://faucet.opnet.org` : ''}`;
      }
      console.error('[Deploy]', e);
      setDeployError(msg);
      setDeployStep('');
    } finally {
      setDeploying(false);
    }
  };

  /** Verify a deployed contract on-chain */
  const verifyDeployment = async () => {
    if (!verifyAddr.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    const prevNet = opnet.getNetwork();
    try {
      opnet.setNetwork(CURRENT_ENV);
      const code = await opnet.getCode(verifyAddr.trim(), true);
      if (code?.bytecode) {
        const supply = await opnet.getTokenTotalSupply(verifyAddr.trim());
        const supplyStr = supply > 0n ? ` · Supply: ${(Number(supply) / 1e8).toLocaleString()}` : '';
        setVerifyResult({ ok: true, info: `Bytecode: ${code.bytecode.length} chars${supplyStr}` });
        localStorage.setItem('hub_token_launched', '1');
      } else {
        setVerifyResult({ ok: false, info: 'No contract found. Check address or wait for confirmation.' });
      }
    } catch (e) {
      console.warn('[TokenLauncher] Contract verification RPC call failed:', e);
      setVerifyResult({ ok: false, info: 'RPC error — try again.' });
    } finally {
      opnet.setNetwork(prevNet);
      setVerifying(false);
    }
  };

  const connected = !!walletAddress;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: '14px',
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>Token Launcher</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 480, margin: '0 auto' }}>
          Create your own OP-20 token on Bitcoin L1. Fill in the details, connect your wallet, and deploy. You only sign the transaction — we handle everything else.
        </div>
      </div>

      <div className="launch-grid">
        {/* Left: Token config */}
        <div className="P">
          <div className="Lb">Token Details</div>

          {/* Quick presets */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {PRESETS.map(p => (
              <button key={p.symbol} onClick={() => applyPreset(p)} style={{
                flex: 1, padding: '8px 4px', borderRadius: '14px',
                background: tokenSymbol === p.symbol && !customWasm ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
                border: `1px solid ${tokenSymbol === p.symbol && !customWasm ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`,
                color: tokenSymbol === p.symbol && !customWasm ? 'var(--o)' : 'var(--t2)',
                fontSize: '.65rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
              }}>
                <div>{p.symbol}</div>
                <div style={{ fontSize: '.52rem', fontWeight: 400, marginTop: 2, color: 'var(--t3)' }}>{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Name */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 4, display: 'block' }}>Token Name</label>
            <input style={inputStyle} value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="e.g. My Awesome Token" />
          </div>

          {/* Symbol */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 4, display: 'block' }}>Symbol (ticker)</label>
            <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={tokenSymbol} onChange={e => setTokenSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="e.g. MTK" maxLength={6} />
          </div>

          {/* Supply + Decimals row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 4, display: 'block' }}>Total Supply</label>
              <input style={inputStyle} type="text" inputMode="numeric" value={tokenSupply} onChange={e => setTokenSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 4, display: 'block' }}>Decimals</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={tokenDecimals} onChange={e => setTokenDecimals(Number(e.target.value))}>
                {[0, 2, 4, 6, 8, 18].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Token Mode: Standard vs Mintable */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: '.68rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Token Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['standard', 'Standard', 'All supply minted to you on deploy'], ['mintable', 'Mintable', 'Split: you + public mint']] as const).map(([mode, label, desc]) => (
                <button key={mode} onClick={() => setTokenMode(mode)} style={{
                  flex: 1, padding: '10px 6px', borderRadius: '14px',
                  background: tokenMode === mode ? (mode === 'standard' ? 'rgba(247,147,26,.08)' : 'rgba(168,85,247,.12)') : 'var(--bg3)',
                  border: `1px solid ${tokenMode === mode ? (mode === 'standard' ? 'rgba(247,147,26,.3)' : 'rgba(168,85,247,.3)') : 'var(--bd)'}`,
                  color: tokenMode === mode ? (mode === 'standard' ? 'var(--o)' : '#a855f7') : 'var(--t2)',
                  fontSize: '.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
                }}>
                  <div>{mode === 'standard' ? '🔒' : '🌐'} {label}</div>
                  <div style={{ fontSize: '.52rem', fontWeight: 400, marginTop: 2, color: 'var(--t3)' }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Mintable mode settings */}
          {tokenMode === 'mintable' && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.15)', borderRadius: '14px' }}>
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#a855f7', marginBottom: 8 }}>Mint Allocation</div>

              {/* Initial mint % slider */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.64rem', color: 'var(--t3)', marginBottom: 4 }}>
                  <span>Initial mint to you</span>
                  <span style={{ fontWeight: 700, color: 'var(--w)' }}>{initialMintPct}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={initialMintPct}
                  onChange={e => setInitialMintPct(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#a855f7' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.56rem', color: 'var(--t4)' }}>
                  <span>You get: {((parseFloat(tokenSupply) || 0) * initialMintPct / 100).toLocaleString()}</span>
                  <span>Public mint: {((parseFloat(tokenSupply) || 0) * (100 - initialMintPct) / 100).toLocaleString()}</span>
                </div>
              </div>

              {/* Public mint toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button onClick={() => setPublicMintEnabled(!publicMintEnabled)} style={{
                  width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: publicMintEnabled ? '#a855f7' : 'var(--bg3)',
                  position: 'relative', transition: 'background .2s',
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', background: 'white',
                    position: 'absolute', top: 2, left: publicMintEnabled ? 18 : 2, transition: 'left .2s',
                  }} />
                </button>
                <span style={{ fontSize: '.66rem', color: 'var(--t2)' }}>Anyone can mint (public mint)</span>
              </div>

              {/* Max mint per tx */}
              {publicMintEnabled && (
                <div>
                  <label style={{ fontSize: '.62rem', color: 'var(--t3)', fontWeight: 600, marginBottom: 4, display: 'block' }}>Max tokens per mint tx (0 = unlimited)</label>
                  <input style={{ ...inputStyle, fontSize: '.74rem' }} type="text" inputMode="numeric"
                    value={maxMintPerTx} onChange={e => setMaxMintPerTx(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="10000" />
                </div>
              )}
            </div>
          )}

          {/* Token logo */}
          <div className="upload-zone" onClick={() => fileRef.current?.click()} style={{ marginBottom: 14, padding: '10px' }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
            {img ? <img src={img} alt="Logo" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ fontSize: '1.2rem' }}>+</div>}
            <div style={{ fontSize: '.62rem', color: 'var(--t3)' }}>{img ? 'Change logo' : 'Logo (optional)'}</div>
          </div>

          {/* Advanced: custom WASM */}
          <button onClick={() => setAdvancedOpen(!advancedOpen)} style={{
            width: '100%', padding: '6px', marginBottom: advancedOpen ? 8 : 14,
            background: 'none', border: '1px solid var(--bd)', borderRadius: '14px',
            color: 'var(--t4)', fontSize: '.62rem', cursor: 'pointer', fontFamily: 'var(--ff)',
          }}>
            {advancedOpen ? '▾ Hide Advanced' : '▸ Advanced: upload custom .wasm'}
          </button>

          {advancedOpen && (
            <div style={{ marginBottom: 14 }}>
              <input ref={wasmRef} type="file" accept=".wasm" onChange={handleWasmUpload} style={{ display: 'none' }} />
              <button onClick={() => wasmRef.current?.click()} style={{
                width: '100%', padding: '10px', borderRadius: '14px',
                background: customWasm ? 'rgba(16,185,129,.06)' : 'var(--bg3)',
                border: `1px solid ${customWasm ? 'rgba(16,185,129,.15)' : 'var(--bd)'}`,
                color: customWasm ? 'var(--g)' : 'var(--t3)',
                fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--ff)',
              }}>
                {customWasm ? `${customWasmName} (${(customWasm.length / 1024).toFixed(1)} KB)` : 'Upload custom .wasm contract'}
              </button>
              <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 4 }}>
                Override the default OP-20 template with your own compiled contract
              </div>
            </div>
          )}

          {/* Deploy Button */}
          {connected ? (
            <button className="lbtn" onClick={deployToken} disabled={deploying} style={{ width: '100%', opacity: deploying ? 0.6 : 1 }}>
              {deploying ? `${deployStep || 'Deploying...'}` : `Deploy $${tokenSymbol.trim() || 'TKN'} on Bitcoin L1`}
            </button>
          ) : (
            <button className="lbtn" onClick={openConnectModal}
              style={{ width: '100%', background: 'linear-gradient(135deg, #0ea5e9, #0284c7)' }}>
              Connect Wallet to Deploy
            </button>
          )}

          {connected && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)', borderRadius: 8, fontSize: '.68rem', color: 'var(--g)' }}>
              Wallet: {walletAddress.slice(0, 16)}...
            </div>
          )}

          {/* Deploy Result */}
          {deployResult && (
            <div style={{ marginTop: 10, padding: 12, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8 }}>
              <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>Token Deployed On-Chain!</div>
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
              <div style={{ color: '#ef4444', fontSize: '.78rem' }}>{deployError}</div>
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="P" style={{ textAlign: 'center', padding: 18 }}>
          <div className="Lb" style={{ justifyContent: 'center' }}>Live Preview</div>
          <div style={{ width: 80, height: 80, margin: '8px auto', borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(255,255,255,.08)' }}>
            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={genLogo(tokenSymbol)} alt={tokenSymbol} style={{ width: '100%', height: '100%' }} />}
          </div>
          <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--w)', marginTop: 6 }}>{tokenName || 'Token Name'}</div>
          <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.82rem' }}>${tokenSymbol || 'TKN'}</div>
          <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 4 }}>Supply: {Number(tokenSupply || 0).toLocaleString()}</div>
          <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginTop: 2 }}>Decimals: {tokenDecimals} · OP-20 · Bitcoin L1 · {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)}</div>

          {/* Deploy cost — compact */}
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.15)', borderRadius: '14px', fontSize: '.66rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--t3)' }}>Deploy cost:</span>
            <span style={{ fontWeight: 700, color: 'var(--o)', fontFamily: 'var(--fm)' }}>~50K sats (~0.0005 BTC)</span>
          </div>

          <div style={{ marginTop: 14, textAlign: 'left', padding: '10px', background: 'var(--bg3)', borderRadius: '14px', fontSize: '.68rem', color: 'var(--t3)' }}>
            <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>How it works:</div>
            <div>1. Fill in your token name, symbol & supply</div>
            <div>2. Connect your OP_WALLET</div>
            <div>3. Click Deploy — sign the transaction</div>
            <div>4. Your token goes live on Bitcoin L1!</div>
            <div style={{ marginTop: 6, fontSize: '.6rem', color: 'var(--t4)' }}>
              We compile and package everything for you. You only sign the deployment transaction.
            </div>
          </div>

          <div style={{ marginTop: 10, textAlign: 'left', padding: '8px', background: 'rgba(14,165,233,.06)', borderRadius: '14px', border: '1px solid rgba(14,165,233,.15)', fontSize: '.62rem', color: 'var(--t3)' }}>
            {CURRENT_ENV !== 'mainnet' && <>Need {CURRENT_ENV} BTC? <a href={FAUCET} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>Get from faucet →</a></>}
          </div>
        </div>
      </div>

      {/* Verify Deployment */}
      <div className="P" style={{ marginTop: 14, padding: 20 }}>
        <div className="Lb">Verify Deployment</div>
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
              {verifyResult.ok ? 'Contract Verified On-Chain!' : 'Not Found'}
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--t2)', marginTop: 2 }}>{verifyResult.info}</div>
          </div>
        )}
      </div>
    </div>
  );
};
export default TokenLauncher;
