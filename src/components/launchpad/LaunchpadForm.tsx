import React, { useState, useRef, useMemo } from 'react';
import { logger } from '../../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Transaction } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import { getContract, type CallResult, type IOP20Contract } from 'opnet';
import { LAUNCHPAD_ABI } from '../../abis';
import { getProvider } from '../../contractCache';
import { NETWORK, CURRENT_ENV } from '../../config';
import type { LaunchToken } from '../../launchpad/types';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface LaunchpadFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: (token: LaunchToken) => void;
}

const LaunchpadForm: React.FC<LaunchpadFormProps> = ({ open, onClose, onCreated }) => {
  const { walletAddress, walletInstance, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const trapRef = useFocusTrap(open, onClose);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [desc, setDesc] = useState('');
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [initialMintPct, setInitialMintPct] = useState(50);
  const [publicMintEnabled, setPublicMintEnabled] = useState(true);
  const [maxMintPerTx, setMaxMintPerTx] = useState('');

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev: ProgressEvent<FileReader>): void => { setImg(ev.target?.result as string); };
    r.readAsDataURL(f);
  };

  const deploy = async (): Promise<void> => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!name.trim() || !symbol.trim()) { setError('Name and symbol required'); return; }

    const inst = walletInstance as { web3?: Record<string, unknown>; deployContract?: unknown };
    const web3 = inst.web3 || inst;
    if (!(web3 as Record<string, unknown>)?.deployContract) { setError('Wallet does not support deployment. Use OP_WALLET.'); return; }

    setDeploying(true); setError('');
    try {
      setStep('Loading MintableToken bytecode...');
      const base = import.meta.env.BASE_URL || '/';
      const resp = await fetch(`${base}wasm/MintableToken.wasm`);
      if (!resp.ok) throw new Error('Failed to load MintableToken.wasm');
      const bytecode = new Uint8Array(await resp.arrayBuffer());

      setStep('Encoding parameters...');
      const supplyNum = parseFloat(supply) || 1_000_000_000;
      const maxSupply = BigInt(Math.floor(supplyNum)) * (10n ** 8n);
      const initialMintAmount = (maxSupply * BigInt(initialMintPct)) / 100n;
      const maxPerTxNum = maxMintPerTx ? parseFloat(maxMintPerTx) : Math.floor(supplyNum * 0.01);
      const maxPerTx = BigInt(Math.floor(maxPerTxNum)) * (10n ** 8n);

      const writer = new BinaryWriter();
      writer.writeU256(maxSupply);
      writer.writeU8(8);
      writer.writeStringWithLength(name.trim());
      writer.writeStringWithLength(symbol.trim().toUpperCase());
      writer.writeU256(initialMintAmount);
      writer.writeBoolean(publicMintEnabled);
      writer.writeU256(maxPerTx);

      setStep('Fetching UTXOs...');
      const utxos = await provider.utxoManager.getUTXOs({ address: walletAddress });
      if (!utxos?.length) throw new Error(`No UTXOs.${CURRENT_ENV !== 'mainnet' ? ' Get ' + CURRENT_ENV + ' BTC from faucet.' : ''}`);

      setStep('Sign deployment in your wallet...');
      const result = await (web3 as { deployContract: (...args: unknown[]) => Promise<{ contractAddress?: string; transaction: string[] }> }).deployContract({
        bytecode, calldata: writer.getBuffer(), utxos, from: walletAddress,
        feeRate: 10, priorityFee: 10_000n, gasSatFee: 100_000n,
        revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
      });

      setStep('Broadcasting...');
      const [fundingTx, deployTx] = result.transaction;
      if (fundingTx) await provider.sendRawTransaction(fundingTx, false);
      if (deployTx) await provider.sendRawTransaction(deployTx, false);

      let txid = '';
      try { txid = Transaction.fromHex(deployTx || fundingTx || '').getId(); } catch (e) { logger.warn('[Launchpad] token deploy txid parse error:', e); }

      const publicMintShare = supplyNum * (100 - initialMintPct) / 100;
      const token: LaunchToken = {
        address: result.contractAddress || txid || `opt1sq_${Date.now()}`,
        name: name.trim(), symbol: symbol.trim().toUpperCase(), decimals: 8,
        totalSupply: supplyNum, publicMintSupply: publicMintShare,
        maxMintPerTx: maxPerTxNum,
        mintedSupply: 0, creator: walletAddress,
        createdAt: Date.now(), description: desc.trim() || `${name.trim()} on Bitcoin L1`,
        image: img, website, twitter, telegram,
        status: 'bonding', txHash: txid, trades: [], replies: [], likes: 0,
      };

      token.status = 'pending_confirm';
      onCreated(token);
      setStep('Waiting for on-chain confirmation (~5 min)...');

      const pollConfirm = async (): Promise<void> => {
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 15000));
          try {
            const c = getContract<IOP20Contract>(token.address, LAUNCHPAD_ABI, provider, NETWORK);
            const res = await c.maximumSupply();
            if (!(res as CallResult).revert) {
              token.status = 'bonding';
              onCreated(token);
              break;
            }
          } catch (e) { logger.warn('[Launchpad] Polling for contract confirmation:', e); }
        }
      };
      pollConfirm().catch((e) => { logger.warn('[LaunchpadForm] pollConfirm error:', e); });

      setStep(''); setDeploying(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deployment failed');
      setStep(''); setDeploying(false);
    }
  };

  if (!open) return null;

  const iStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 12,
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.85rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div ref={trapRef} className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" role="dialog" aria-modal="true" aria-label="Deploy new token contract" onClick={e => e.stopPropagation()}>
        <div className="flex-between mb-16">
          <div className="fw-800 fs-lg c-w">Deploy Contract</div>
          <button onClick={onClose} aria-label="Close deploy dialog" className="c-t3 fs-120 pointer bd-none" style={{ background: 'none' }}>&#x2715;</button>
        </div>

        {/* Image upload */}
        <div className="flex-center-full mb-14">
          <div onClick={() => fileRef.current?.click()}
            className="br-50 d-flex ai-center jc-center pointer ov-hidden w-72 h-72 bg-bg3" style={{ border: '2px dashed var(--bd)' }}>
            <input ref={fileRef} type="file" accept="image/*" aria-label="Upload token logo" onChange={handleImage} className="d-none" />
            {img ? <img src={img} alt="Token logo preview" className="w-full h-full obj-cover" />
              : <span className="c-t4 fs-160">+</span>}
          </div>
        </div>

        <div className="flex-gap8-mb10">
          <div className="flex-2">
            <label className="fs-82 c-t3 mb-4 d-block">Name *</label>
            <input style={iStyle} aria-label="Token name" value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin Pepe" />
          </div>
          <div className="flex-1">
            <label className="fs-82 c-t3 mb-4 d-block">Ticker *</label>
            <input className="text-upper" aria-label="Token ticker symbol" style={{ ...iStyle }} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="BPEPE" maxLength={6} />
          </div>
        </div>

        <div className="mb-10">
          <label className="fs-82 c-t3 mb-4 d-block">Description</label>
          <textarea style={{ ...iStyle, minHeight: 60, resize: 'vertical' }} aria-label="Token description" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Tell the world about your token..." />
        </div>

        <div className="mb-10">
          <label className="fs-82 c-t3 mb-4 d-block">Total Supply (Max Supply)</label>
          <input style={iStyle} type="text" inputMode="numeric" aria-label="Total supply" value={supply} onChange={e => setSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000000" />
          <div className="fs-72 c-t3 mt-4">
            {initialMintPct}% to you ({((parseFloat(supply) || 0) * initialMintPct / 100).toLocaleString()}) &middot; {100 - initialMintPct}% public mint &middot; Max/tx: {maxMintPerTx || ((parseFloat(supply) || 0) * 0.01).toLocaleString()}
          </div>
        </div>

        {/* Token Settings */}
        <div className="mb-10 br-10 p-8-10 bg-purple">
          <div className="flex-center gap-8 mb-6">
            <span className="fs-72 c-t3 ws-nowrap min-w-60">Your mint</span>
            <input type="range" min={0} max={100} step={5} value={initialMintPct}
              aria-label="Initial mint percentage"
              onChange={e => setInitialMintPct(Number(e.target.value))}
              className="flex-1 accent-purple h-4" />
            <span className="fs-76 fw-700 c-w text-right min-w-30">{initialMintPct}%</span>
          </div>
          <div className="flex-center gap-8">
            <button onClick={() => setPublicMintEnabled(!publicMintEnabled)} className="pointer flex-shrink-0 pos-relative" style={{ width: 32, height: 18, borderRadius: 9, border: 'none', background: publicMintEnabled ? '#a855f7' : 'var(--bg3)', transition: 'background .2s' }}>
              <div className="br-50 pos-absolute" style={{ width: 14, height: 14, background: 'white', top: 2, left: publicMintEnabled ? 16 : 2, transition: 'left .2s' }} />
            </button>
            <span className="fs-72 c-t3 ws-nowrap">Public mint</span>
            {publicMintEnabled && (
              <>
                <span className="fs-72 c-t4">|</span>
                <span className="fs-72 c-t3 ws-nowrap">Max/tx:</span>
                <input className="fs-78" style={{ ...iStyle, padding: '5px 8px', width: 100 }} type="text" inputMode="numeric"
                  aria-label="Maximum mint per transaction"
                  value={maxMintPerTx} onChange={e => setMaxMintPerTx(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={String(Math.floor((parseFloat(supply) || 0) * 0.01))} />
              </>
            )}
          </div>
        </div>

        <div className="flex-gap6-mb14">
          <div className="flex-1">
            <label className="fs-72 c-t3">Website</label>
            <input className="fs-80" style={{ ...iStyle }} value={website} onChange={e => setWebsite(e.target.value)} placeholder="example.com" />
          </div>
          <div className="flex-1">
            <label className="fs-72 c-t3">Twitter</label>
            <input className="fs-80" style={{ ...iStyle }} value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@handle" />
          </div>
          <div className="flex-1">
            <label className="fs-72 c-t3">Telegram</label>
            <input className="fs-80" style={{ ...iStyle }} value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="t.me/group" />
          </div>
        </div>

        <div className="br-10 fs-78 c-t2 mb-12 p-10-12 bg-info-o">
          Deploy cost: <strong className="c-o">~50K sats (~0.0005 BTC)</strong> &middot; Contract goes live on Bitcoin L1
        </div>

        {error && <div className="br-8 c-red fs-80 mb-10 p-10-12 bg-err-08" role="alert">{error}</div>}

        <button onClick={deploy} disabled={deploying} className="lbtn w-full" style={{ opacity: deploying ? 0.6 : 1 }}>
          {deploying ? step || 'Deploying...' : walletAddress ? `Deploy $${symbol || 'TOKEN'}` : 'Connect Wallet'}
        </button>
      </div>
    </div>
  );
};

export default React.memo(LaunchpadForm);
