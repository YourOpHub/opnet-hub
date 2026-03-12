import React, { useState, useRef, useMemo } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { BinaryWriter } from '@btc-vision/transaction';
import { Transaction } from '@btc-vision/bitcoin';
import { getProvider } from '../contractCache';
import { CURRENT_ENV } from '../config';
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
  const pair = cs[s.charCodeAt(0) % cs.length] ?? ['#F7931A', '#e8850f'];
  const [c1, c2] = pair;
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

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev: ProgressEvent<FileReader>): void => { setImg(ev.target?.result as string); };
    r.readAsDataURL(f);
  };

  const handleWasmUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]; if (!f) return;
    setCustomWasmName(f.name);
    const r = new FileReader();
    r.onload = (ev: ProgressEvent<FileReader>): void => {
      if (ev.target?.result != null) setCustomWasm(new Uint8Array(ev.target.result as ArrayBuffer));
    };
    r.readAsArrayBuffer(f);
  };

  const applyPreset = (p: typeof PRESETS[0]): void => {
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
  const deployToken = async (): Promise<void> => {
    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    if (!tokenName.trim() || !tokenSymbol.trim() || !tokenSupply.trim()) {
      setDeployError('Please fill in token name, symbol, and supply.');
      return;
    }

    type DeployFn = (...args: unknown[]) => Promise<{ contractAddress?: string; contractPubKey?: string; transaction: string[] }>;
    type Web3Provider = { deployContract?: DeployFn };
    const inst = walletInstance as { web3?: Web3Provider } & Web3Provider;
    const web3 = (inst.web3 || inst) as Web3Provider;
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
      if (utxos == null || utxos.length === 0) {
        throw new Error(`No UTXOs found for your address.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC: ${FAUCET}` : ''}`);
      }

      // 4. Deploy via Web3Provider
      setDeployStep('Sign the transaction in your wallet...');
      // deployContract presence is guarded above
      const deployFn = web3.deployContract as DeployFn;
      const result = await deployFn({
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
      logger.info('[Deploy] Contract address:', result.contractAddress);
      logger.info('[Deploy] Funding TX hex length:', fundingTxHex?.length);
      logger.info('[Deploy] Deploy TX hex length:', deployTxHex?.length);

      // Broadcast funding TX first, then deployment TX
      if (fundingTxHex) {
        const fundResult = await provider.sendRawTransaction(fundingTxHex, false);
        logger.info('[Deploy] Funding TX broadcast:', fundResult);
      }
      if (deployTxHex) {
        const deployResult = await provider.sendRawTransaction(deployTxHex, false);
        logger.info('[Deploy] Deploy TX broadcast:', deployResult);
      }

      // Compute real txid from raw transaction hex
      let txid = '';
      try {
        const rawHex = deployTxHex || fundingTxHex || '';
        if (rawHex) {
          txid = Transaction.fromHex(rawHex).getId();
        }
      } catch (txErr) {
        logger.warn('[Deploy] Could not compute txid from raw tx:', txErr);
        txid = result.contractPubKey || result.contractAddress || '';
      }

      setDeployStep('');
      setDeployResult({
        contractAddress: result.contractAddress || '',
        txid,
      });
      localStorage.setItem('hub_token_launched', '1');

      // Save deployed token to gallery
      const deployed = JSON.parse(localStorage.getItem('hub_deployed_tokens') ?? '[]') as Record<string, unknown>[];
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
      logger.error('[Deploy]', e);
      setDeployError(msg);
      setDeployStep('');
    } finally {
      setDeploying(false);
    }
  };

  /** Verify a deployed contract on-chain */
  const verifyDeployment = async (): Promise<void> => {
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
      logger.warn('[TokenLauncher] Contract verification RPC call failed:', e);
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
      <div className="Pg mb-14 text-center p-24-18">
        <div className="fs-110 fw-800 c-w mb-3">Token Launcher</div>
        <div className="c-t3 fs-80 m-auto max-w-480">
          Create your own OP-20 token on Bitcoin L1. Fill in the details, connect your wallet, and deploy. You only sign the transaction — we handle everything else.
        </div>
      </div>

      <div className="launch-grid">
        {/* Left: Token config */}
        <div className="P">
          <div className="Lb">Token Details</div>

          {/* Quick presets */}
          <div className="d-flex gap-6 mb-14">
            {PRESETS.map(p => (
              <button key={p.symbol} onClick={() => applyPreset(p)} className="flex-1 br-14 fs-65 fw-700 pointer ff-ui" style={{ padding: '8px 4px', background: tokenSymbol === p.symbol && !customWasm ? 'rgba(247,147,26,.08)' : 'var(--bg3)', border: `1px solid ${tokenSymbol === p.symbol && !customWasm ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`, color: tokenSymbol === p.symbol && !customWasm ? 'var(--o)' : 'var(--t2)' }}>
                <div>{p.symbol}</div>
                <div className="fs-52 fw-400 mt-2 c-t3">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Name */}
          <div className="mb-10">
            <label className="fs-68 c-t3 fw-600 mb-4 d-block">Token Name</label>
            <input style={inputStyle} aria-label="Token name" value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="e.g. My Awesome Token" />
          </div>

          {/* Symbol */}
          <div className="mb-10">
            <label className="fs-68 c-t3 fw-600 mb-4 d-block">Symbol (ticker)</label>
            <input className="text-upper" aria-label="Token symbol" style={{ ...inputStyle }} value={tokenSymbol} onChange={e => setTokenSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="e.g. MTK" maxLength={6} />
          </div>

          {/* Supply + Decimals row */}
          <div className="d-flex gap-8 mb-10">
            <div style={{ flex: 2 }}>
              <label className="fs-68 c-t3 fw-600 mb-4 d-block">Total Supply</label>
              <input style={inputStyle} type="text" inputMode="numeric" value={tokenSupply} onChange={e => setTokenSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000" />
            </div>
            <div className="flex-1">
              <label className="fs-68 c-t3 fw-600 mb-4 d-block">Decimals</label>
              <select className="pointer" style={{ ...inputStyle }} value={tokenDecimals} onChange={e => setTokenDecimals(Number(e.target.value))}>
                {[0, 2, 4, 6, 8, 18].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Token Mode: Standard vs Mintable */}
          <div className="mb-12">
            <label className="fs-68 c-t3 fw-600 mb-6 d-block">Token Type</label>
            <div className="d-flex gap-6">
              {([['standard', 'Standard', 'All supply minted to you on deploy'], ['mintable', 'Mintable', 'Split: you + public mint']] as const).map(([mode, label, desc]) => (
                <button key={mode} onClick={() => setTokenMode(mode)} className="flex-1 br-14 fs-70 fw-700 pointer ff-ui" style={{ padding: '10px 6px', background: tokenMode === mode ? (mode === 'standard' ? 'rgba(247,147,26,.08)' : 'rgba(168,85,247,.12)') : 'var(--bg3)', border: `1px solid ${tokenMode === mode ? (mode === 'standard' ? 'rgba(247,147,26,.3)' : 'rgba(168,85,247,.3)') : 'var(--bd)'}`, color: tokenMode === mode ? (mode === 'standard' ? 'var(--o)' : '#a855f7') : 'var(--t2)' }}>
                  <div>{mode === 'standard' ? '🔒' : '🌐'} {label}</div>
                  <div className="fs-52 fw-400 mt-2 c-t3">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Mintable mode settings */}
          {tokenMode === 'mintable' && (
            <div className="mb-12 p-12 br-14 bg-purple-06">
              <div className="fs-70 fw-700 c-purple mb-8">Mint Allocation</div>

              {/* Initial mint % slider */}
              <div className="mb-10">
                <div className="d-flex jc-between fs-64 c-t3 mb-4">
                  <span>Initial mint to you</span>
                  <span className="fw-700 c-w">{initialMintPct}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={initialMintPct}
                  onChange={e => setInitialMintPct(Number(e.target.value))}
                  className="w-full accent-purple" />
                <div className="d-flex jc-between fs-56 c-t4">
                  <span>You get: {((parseFloat(tokenSupply) || 0) * initialMintPct / 100).toLocaleString()}</span>
                  <span>Public mint: {((parseFloat(tokenSupply) || 0) * (100 - initialMintPct) / 100).toLocaleString()}</span>
                </div>
              </div>

              {/* Public mint toggle */}
              <div className="d-flex ai-center gap-8 mb-8">
                <button onClick={() => setPublicMintEnabled(!publicMintEnabled)} className="w-36 br-10 pointer pos-relative" style={{ height: 20, border: 'none', background: publicMintEnabled ? '#a855f7' : 'var(--bg3)', transition: 'background .2s' }}>
                  <div className="br-50 pos-absolute" style={{ width: 16, height: 16, background: 'white', top: 2, left: publicMintEnabled ? 18 : 2, transition: 'left .2s' }} />
                </button>
                <span className="fs-66 c-t2">Anyone can mint (public mint)</span>
              </div>

              {/* Max mint per tx */}
              {publicMintEnabled && (
                <div>
                  <label className="fs-62 c-t3 fw-600 mb-4 d-block">Max tokens per mint tx (0 = unlimited)</label>
                  <input className="fs-74" style={{ ...inputStyle }} type="text" inputMode="numeric"
                    value={maxMintPerTx} onChange={e => setMaxMintPerTx(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="10000" />
                </div>
              )}
            </div>
          )}

          {/* Token logo */}
          <div className="upload-zone mb-14 p-10" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*" aria-label="Upload token logo" onChange={handleImage} className="d-none" />
            {img ? <img src={img} alt="Logo" className="w-40 h-40 br-50 obj-cover" /> : <div className="fs-120">+</div>}
            <div className="fs-62 c-t3">{img ? 'Change logo' : 'Logo (optional)'}</div>
          </div>

          {/* Advanced: custom WASM */}
          <button onClick={() => setAdvancedOpen(!advancedOpen)} className="w-full br-14 c-t4 fs-62 pointer ff-ui" style={{ padding: '6px', marginBottom: advancedOpen ? 8 : 14, background: 'none', border: '1px solid var(--bd)' }}>
            {advancedOpen ? '▾ Hide Advanced' : '▸ Advanced: upload custom .wasm'}
          </button>

          {advancedOpen && (
            <div className="mb-14">
              <input ref={wasmRef} type="file" accept=".wasm" onChange={handleWasmUpload} className="d-none" />
              <button onClick={() => wasmRef.current?.click()} className="w-full br-14 fs-72 pointer ff-ui" style={{ padding: '10px', background: customWasm ? 'rgba(16,185,129,.06)' : 'var(--bg3)', border: `1px solid ${customWasm ? 'rgba(16,185,129,.15)' : 'var(--bd)'}`, color: customWasm ? 'var(--g)' : 'var(--t3)' }}>
                {customWasm ? `${customWasmName} (${(customWasm.length / 1024).toFixed(1)} KB)` : 'Upload custom .wasm contract'}
              </button>
              <div className="fs-58 c-t4 mt-4">
                Override the default OP-20 template with your own compiled contract
              </div>
            </div>
          )}

          {/* Deploy Button */}
          {connected ? (
            <button className="lbtn w-full" onClick={deployToken} disabled={deploying} style={{ opacity: deploying ? 0.6 : 1 }}>
              {deploying ? `${deployStep || 'Deploying...'}` : `Deploy $${tokenSymbol.trim() || 'TKN'} on Bitcoin L1`}

            </button>
          ) : (
            <button className="lbtn w-full btn-blue" onClick={openConnectModal}>
              Connect Wallet to Deploy
            </button>
          )}

          {connected && (
            <div className="mt-8 br-8 fs-68 c-g p-6-10 bg-ok">
              Wallet: {walletAddress.slice(0, 16)}...
            </div>
          )}

          {/* Deploy Result */}
          {deployResult && (
            <div className="mt-10 p-12 br-8 bg-success-08" role="alert">
              <div className="c-g fw-700 mb-4">Token Deployed On-Chain!</div>
              <div className="fs-72 c-t2 word-break">
                <strong>Contract:</strong> {deployResult.contractAddress}
              </div>
              {deployResult.txid && (
                <a href={getTxUrl(deployResult.txid)} target="_blank" rel="noopener noreferrer"
                  className="c-c2 fs-65 mt-4 d-block">View Deploy TX →</a>
              )}
            </div>
          )}
          {deployError && (
            <div className="mt-10 p-12 br-8 bg-err-08" role="alert">
              <div className="c-red fs-78">{deployError}</div>
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="P text-center p-18">
          <div className="Lb jc-center">Live Preview</div>
          <div className="br-50 ov-hidden w-80 h-80" style={{ margin: '8px auto', border: '2px solid rgba(255,255,255,.08)' }}>
            {img ? <img src={img} alt="" className="w-full h-full obj-cover" /> : <img src={genLogo(tokenSymbol)} alt={tokenSymbol} className="w-full h-full" />}
          </div>
          <div className="fw-700 fs-95 c-w mt-6">{tokenName || 'Token Name'}</div>
          <div className="text-mono c-o fw-600 fs-82">${tokenSymbol || 'TKN'}</div>
          <div className="fs-68 c-t3 mt-4">Supply: {Number(tokenSupply || 0).toLocaleString()}</div>
          <div className="fs-58 c-t4 mt-2">Decimals: {tokenDecimals} · OP-20 · Bitcoin L1 · {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)}</div>

          {/* Deploy cost — compact */}
          <div className="mt-12 br-14 fs-66 d-flex jc-between ai-center p-8-12 bg-info-o">
            <span className="c-t3">Deploy cost:</span>
            <span className="fw-700 c-o text-mono">~50K sats (~0.0005 BTC)</span>
          </div>

          <div className="mt-14 text-left br-14 fs-68 c-t3 p-10 bg-bg3">
            <div className="fw-700 c-t2 mb-4">How it works:</div>
            <div>1. Fill in your token name, symbol & supply</div>
            <div>2. Connect your OP_WALLET</div>
            <div>3. Click Deploy — sign the transaction</div>
            <div>4. Your token goes live on Bitcoin L1!</div>
            <div className="mt-6 fs-60 c-t4">
              We compile and package everything for you. You only sign the deployment transaction.
            </div>
          </div>

          <div className="mt-10 text-left br-14 fs-62 c-t3 p-8 bg-info-b">
            {CURRENT_ENV !== 'mainnet' && <>Need {CURRENT_ENV} BTC? <a href={FAUCET} target="_blank" rel="noopener noreferrer" className="c-c2">Get from faucet →</a></>}
          </div>
        </div>
      </div>

      {/* Verify Deployment */}
      <div className="P mt-14 p-20" role="form" aria-label="Verify deployment">
        <div className="Lb">Verify Deployment</div>
        <div className="fs-72 c-t3 mb-8">Enter your contract address to check if it's live on-chain.</div>
        <div className="d-flex gap-8">
          <input className="lf-i flex-1 fs-76" aria-label="Contract address to verify" value={verifyAddr}
            onChange={e => { setVerifyAddr(e.target.value); setVerifyResult(null); }}
            placeholder="opt1sq... (contract address)" />
          <button className="btn-s ws-nowrap" onClick={verifyDeployment}
            disabled={!verifyAddr.trim() || verifying}
            style={{ padding: '8px 16px' }}>
            {verifying ? '...' : 'Verify'}
          </button>
        </div>
        {verifyResult && (
          <div className="mt-8 br-8" style={{ padding: '8px 12px', background: verifyResult.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)', border: `1px solid ${verifyResult.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}` }}>
            <div className="fw-700 fs-76" style={{ color: verifyResult.ok ? 'var(--g)' : '#ef4444' }}>
              {verifyResult.ok ? 'Contract Verified On-Chain!' : 'Not Found'}
            </div>
            <div className="fs-68 c-t2 mt-2">{verifyResult.info}</div>
          </div>
        )}
      </div>
    </div>
  );
};
export default TokenLauncher;
