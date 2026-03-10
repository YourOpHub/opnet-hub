import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Transaction } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import {
  getContract, BitcoinUtils,
  type CallResult, type IOP20Contract,
  type TransactionParameters,
} from 'opnet';
import { LAUNCHPAD_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import { OPSCAN_API_BASE, getContractOpscanUrl, getTxUrl } from '../contracts';
import { buildTxParams, withRetry, formatTxError } from '../txUtils';
import type { LaunchToken, TradeRecord } from '../launchpad/types';
import {
  getProgress, isGraduated, fmtNum, hashColor, genLogo, timeAgo, GRADUATION_PCT,
} from '../launchpad/types';
import { loadTokens, saveTokens, addToken, addTrade } from '../launchpad/store';
import { isServerAvailable, fetchTokens, registerToken } from '../launchpad/api';
import { useOps } from '../contexts/OpsContext';

interface MintableOP20 extends IOP20Contract {
  publicMint(amount: bigint): Promise<CallResult>;
}

type SortMode = 'hot1h' | 'hot8h' | 'hot24h' | 'newest' | 'holders';

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR TOKEN LIST ITEM
   ═══════════════════════════════════════════════════════════════ */
const TokenListItem: React.FC<{
  token: LaunchToken; active: boolean; onClick: () => void;
}> = ({ token, active, onClick }) => {
  const progress = getProgress(token);
  const grad = isGraduated(token);
  const [c1] = hashColor(token.symbol);
  const imgSrc = token.image || genLogo(token.symbol);
  const isReal = token.address.startsWith('opt1sq');
  const isPending = token.status === 'pending_confirm';

  return (
    <div onClick={onClick} className={`lp-list-item ${active ? 'active' : ''}`}
      style={{ borderLeft: `3px solid ${active ? c1 : 'transparent'}`, opacity: isPending ? 0.5 : 1 }}>
      <img src={imgSrc} alt="" className="w-40 h-40 br-50 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex-between">
          <span className="fw-700 fs-88 c-w truncate">
            {token.symbol}
          </span>
          <div className="flex-center gap-4">
            {isPending && <span className="c-y fw-700 fs-50">PENDING</span>}
            {!isPending && isReal && <span className="w-6 h-6 br-50 flex-shrink-0" style={{ background: 'var(--g)' }} />}
            {grad && <span className="c-g fw-700 fs-50">GRAD</span>}
          </div>
        </div>
        <div className="fs-sm c-t4 truncate">
          {token.name}
        </div>
        <div className="flex-center gap-6 mt-4">
          <div className="flex-1 br-2 ov-hidden" style={{ height: 4, background: 'rgba(255,255,255,.06)' }}>
            <div className="br-2" style={{ height: '100%', background: grad ? 'var(--g)' : `linear-gradient(90deg, ${c1}, ${c1}88)`, width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .3s' }} />
          </div>
          <span className="text-mono c-t4 text-right fs-58" style={{ minWidth: 28 }}>
            {(progress * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   DEPLOY MODAL
   ═══════════════════════════════════════════════════════════════ */
const DeployModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (token: LaunchToken) => void;
}> = ({ open, onClose, onCreated }) => {
  const { walletAddress, walletInstance, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

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

  // Token configuration
  const [initialMintPct, setInitialMintPct] = useState(50);
  const [publicMintEnabled, setPublicMintEnabled] = useState(true);
  const [maxMintPerTx, setMaxMintPerTx] = useState('');

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setImg(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const deploy = async () => {
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
      const decimals = 8;
      const maxSupply = BigInt(Math.floor(supplyNum)) * (10n ** 8n);
      const initialMintAmount = (maxSupply * BigInt(initialMintPct)) / 100n;
      const maxPerTxNum = maxMintPerTx ? parseFloat(maxMintPerTx) : Math.floor(supplyNum * 0.01);
      const maxPerTx = BigInt(Math.floor(maxPerTxNum)) * (10n ** 8n);

      const writer = new BinaryWriter();
      writer.writeU256(maxSupply);
      writer.writeU8(decimals);
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

      // Poll for contract to appear on-chain
      const pollConfirm = async () => {
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
      pollConfirm().catch(() => {});

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
    <div className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" onClick={e => e.stopPropagation()}>
        <div className="flex-between mb-16">
          <div className="fw-800 fs-lg c-w">Deploy Contract</div>
          <button onClick={onClose} className="c-t3 fs-120 pointer bd-none" style={{ background: 'none' }}>&#x2715;</button>
        </div>

        {/* Image upload */}
        <div className="flex-center-full mb-14">
          <div onClick={() => fileRef.current?.click()}
            className="br-50 d-flex ai-center jc-center pointer ov-hidden w-72 h-72 bg-bg3" style={{ border: '2px dashed var(--bd)' }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} className="d-none" />
            {img ? <img src={img} alt="" className="w-full h-full obj-cover" />
              : <span className="c-t4 fs-160">+</span>}
          </div>
        </div>

        <div className="flex-gap8-mb10">
          <div className="flex-2">
            <label className="fs-82 c-t3 mb-4 d-block">Name *</label>
            <input style={iStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin Pepe" />
          </div>
          <div className="flex-1">
            <label className="fs-82 c-t3 mb-4 d-block">Ticker *</label>
            <input className="text-upper" style={{ ...iStyle }} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="BPEPE" maxLength={6} />
          </div>
        </div>

        <div className="mb-10">
          <label className="fs-82 c-t3 mb-4 d-block">Description</label>
          <textarea style={{ ...iStyle, minHeight: 60, resize: 'vertical' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Tell the world about your token..." />
        </div>

        <div className="mb-10">
          <label className="fs-82 c-t3 mb-4 d-block">Total Supply (Max Supply)</label>
          <input style={iStyle} type="text" inputMode="numeric" value={supply} onChange={e => setSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000000" />
          <div className="fs-72 c-t3 mt-4">
            {initialMintPct}% to you ({((parseFloat(supply) || 0) * initialMintPct / 100).toLocaleString()}) &middot; {100 - initialMintPct}% public mint &middot; Max/tx: {maxMintPerTx || ((parseFloat(supply) || 0) * 0.01).toLocaleString()}
          </div>
        </div>

        {/* Token Settings — always visible, compact */}
        <div className="mb-10 br-10 p-8-10 bg-purple">
          {/* Row 1: Initial mint slider */}
          <div className="flex-center gap-8 mb-6">
            <span className="fs-72 c-t3 ws-nowrap min-w-60">Your mint</span>
            <input type="range" min={0} max={100} step={5} value={initialMintPct}
              onChange={e => setInitialMintPct(Number(e.target.value))}
              className="flex-1 accent-purple h-4" />
            <span className="fs-76 fw-700 c-w text-right min-w-30">{initialMintPct}%</span>
          </div>
          {/* Row 2: Public mint toggle + Max per TX */}
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

        {error && <div className="br-8 c-red fs-80 mb-10 p-10-12 bg-err-08">{error}</div>}

        <button onClick={deploy} disabled={deploying} className="lbtn w-full" style={{ opacity: deploying ? 0.6 : 1 }}>
          {deploying ? step || 'Deploying...' : walletAddress ? `Deploy $${symbol || 'TOKEN'}` : 'Connect Wallet'}
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN LAUNCHPAD — UniSat-style Two-Panel Layout
   ═══════════════════════════════════════════════════════════════ */
const Launchpad: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp } = useOps();

  const [tokens, setTokens] = useState<LaunchToken[]>(() => loadTokens());
  const [selected, setSelected] = useState<LaunchToken | null>(null);
  const [search, setSearch] = useState('');
  const [deployOpen, setDeployOpen] = useState(false);
  const [mintAmt, setMintAmt] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintStep, setMintStep] = useState('');
  const [useServer, setUseServer] = useState(false);
  const [userBal, setUserBal] = useState(0);
  const [addAddr, setAddAddr] = useState('');
  const [adding, setAdding] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('hot24h');

  // Load from server + OPScan on mount
  useEffect(() => {
    void (async () => {
      const available = await isServerAvailable();
      setUseServer(available);
      let merged: LaunchToken[] = loadTokens();

      // Load from our API
      if (available) {
        const serverTokens = await fetchTokens();
        if (serverTokens && serverTokens.length > 0) {
          merged = serverTokens.map(st => {
            const lt = merged.find(l => l.address === st.address);
            return lt ? { ...lt, replies: st.replies || lt.replies, likes: st.likes || lt.likes } : st;
          });
          const local = loadTokens();
          local.forEach(lt => { if (!merged.find(m => m.address === lt.address)) merged.push(lt); });
        }
      }

      setTokens(merged);
      saveTokens(merged);
    })();
  }, []);

  // On-chain sync for selected token
  const syncToken = useCallback(async (addr: string) => {
    if (!addr.startsWith('opt1sq')) return;
    try {
      const c = getContract<IOP20Contract>(addr, LAUNCHPAD_ABI, provider, NETWORK);
      const [tsR, msR] = await Promise.all([
        withRetry(() => c.totalSupply()),
        withRetry(() => c.maximumSupply()),
      ]);
      if ((tsR as CallResult).revert || (msR as CallResult).revert) return;
      const tsP = (tsR as CallResult).properties as Record<string, unknown>;
      const msP = (msR as CallResult).properties as Record<string, unknown>;
      const total = BigInt(String(tsP?.supply || 0));
      const max = BigInt(String(msP?.supply || 0));
      const half = max / 2n;
      const minted = total > half ? Number(total - half) / 1e8 : 0;
      setTokens(prev => {
        const copy = prev.map(t => t.address === addr ? { ...t, mintedSupply: minted } : t);
        saveTokens(copy);
        return copy;
      });
      setSelected(prev => prev && prev.address === addr ? { ...prev, mintedSupply: minted } : prev);
    } catch (e) { logger.warn('[LP] sync failed:', e); }
  }, [provider]);

  // On-chain balance for selected token
  const syncBalance = useCallback(async (addr: string) => {
    if (!senderAddr || !addr.startsWith('opt1sq')) { setUserBal(0); return; }
    try {
      const c = getContract<IOP20Contract>(addr, LAUNCHPAD_ABI, provider, NETWORK, senderAddr);
      const res = await c.balanceOf(senderAddr);
      if (!(res as CallResult).revert) {
        const p = (res as CallResult).properties as Record<string, unknown>;
        setUserBal(Number(BigInt(String(p?.balance || 0))) / 1e8);
      }
    } catch (e) { logger.warn('[Launchpad] Failed to fetch user token balance:', e); setUserBal(0); }
  }, [senderAddr, provider]);

  // Sync when selected changes
  useEffect(() => {
    if (!selected) return;
    void syncToken(selected.address);
    void syncBalance(selected.address);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depend on selected?.address, not the whole object, to avoid re-fetching on unrelated property changes
  }, [selected?.address, walletAddress, syncToken, syncBalance]);

  // Auto-select first token
  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when tokens list changes; including selected would prevent auto-selection
  }, [tokens]);

  // Filter + sort tokens
  const filtered = useMemo(() => {
    let list = tokens;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase().includes(q));
    }
    const now = Date.now();
    const sortFns: Record<SortMode, (a: LaunchToken, b: LaunchToken) => number> = {
      hot1h: (a, b) => {
        const aM = a.trades.filter(t => now - t.timestamp < 3600_000).reduce((s, t) => s + t.amount, 0);
        const bM = b.trades.filter(t => now - t.timestamp < 3600_000).reduce((s, t) => s + t.amount, 0);
        return bM - aM;
      },
      hot8h: (a, b) => {
        const aM = a.trades.filter(t => now - t.timestamp < 28800_000).reduce((s, t) => s + t.amount, 0);
        const bM = b.trades.filter(t => now - t.timestamp < 28800_000).reduce((s, t) => s + t.amount, 0);
        return bM - aM;
      },
      hot24h: (a, b) => {
        const aM = a.trades.filter(t => now - t.timestamp < 86400_000).reduce((s, t) => s + t.amount, 0);
        const bM = b.trades.filter(t => now - t.timestamp < 86400_000).reduce((s, t) => s + t.amount, 0);
        return bM - aM;
      },
      newest: (a, b) => b.createdAt - a.createdAt,
      holders: (a, b) => {
        const aH = new Set(a.trades.map(t => t.wallet)).size;
        const bH = new Set(b.trades.map(t => t.wallet)).size;
        return bH - aH;
      },
    };
    return [...list].sort(sortFns[sortMode]);
  }, [tokens, search, sortMode]);

  // ON-CHAIN MINT
  const handleMint = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!selected) return;
    const amount = parseFloat(mintAmt);
    if (!amount || amount <= 0) return;

    if (!selected.address.startsWith('opt1sq')) {
      setMintStep('Invalid contract address');
      setTimeout(() => setMintStep(''), 3000);
      return;
    }

    setMinting(true); setMintStep('Preparing...');
    try {
      const rawAmount = BitcoinUtils.expandToDecimals(amount, selected.decimals);
      const contract = getContract<MintableOP20>(selected.address, LAUNCHPAD_ABI, provider, NETWORK, senderAddr);

      setMintStep('Simulating publicMint...');
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      const callRes = sim as CallResult;
      if (callRes.revert) throw new Error(`Reverted: ${callRes.revert}`);
      if (!callRes.sendTransaction) throw new Error('Simulation failed — contract may not support publicMint');

      setMintStep('Sign in your wallet...');
      const txParams = await buildTxParams(provider, walletAddress);
      const lpOpId = `mint_${selected.symbol}_${Date.now()}`;
      trackOp({ id: lpOpId, market: 'mint', orderId: selected.symbol, direction: '', role: '', step: `Minting ${amount.toLocaleString()} ${selected.symbol}...` });
      const receipt = await callRes.sendTransaction(txParams as TransactionParameters);
      completeOp(lpOpId);
      const txHash = receipt?.transactionId || '';

      setMintStep(`TX: ${txHash ? txHash.slice(0, 20) + '...' : 'broadcast'}`);

      // Record trade
      const trade: TradeRecord = {
        id: `t_${Date.now()}`, type: 'buy', amount,
        price: 0, wallet: `${walletAddress.slice(0, 10)}...${walletAddress.slice(-4)}`,
        txHash, timestamp: Date.now(),
      };
      const updated = addTrade(selected.address, trade);
      setTokens(updated);
      const refreshed = updated.find(t => t.address === selected.address);
      if (refreshed) setSelected(refreshed);

      setMintStep('TX broadcast! Waiting for confirmation...');
      setMintAmt('');
      // Poll for balance change to confirm
      const startBal = userBal;
      const pollMint = async () => {
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 15000));
          await syncToken(selected.address);
          await syncBalance(selected.address);
          if (userBal !== startBal) break;
        }
        setMintStep('Confirmed!');
        setTimeout(() => setMintStep(''), 4000);
      };
      pollMint().catch(() => { setMintStep(''); });
    } catch (e) {
      logger.error('[LP Mint]', e);
      setMintStep(formatTxError(e));
      setTimeout(() => setMintStep(''), 6000);
    } finally {
      setMinting(false);
    }
  }, [walletAddress, senderAddr, selected, mintAmt, provider, openConnectModal, syncToken, syncBalance, trackOp, completeOp, userBal]);

  // Add contract by address
  const handleAddContract = useCallback(async () => {
    if (!addAddr.trim()) return;
    const addr = addAddr.trim();
    if (tokens.find(t => t.address === addr)) {
      setSelected(tokens.find(t => t.address === addr) || null);
      setAddAddr('');
      return;
    }
    setAdding(true);
    try {
      // Try to read on-chain state
      const c = getContract<IOP20Contract>(addr, LAUNCHPAD_ABI, provider, NETWORK);
      const [tsR, msR] = await Promise.all([c.totalSupply(), c.maximumSupply()]);
      if ((tsR as CallResult).revert || (msR as CallResult).revert) throw new Error('Not a valid OP20 token');
      const tsP = (tsR as CallResult).properties as Record<string, unknown>;
      const msP = (msR as CallResult).properties as Record<string, unknown>;
      const total = Number(BigInt(String(tsP?.supply || 0))) / 1e8;
      const max = Number(BigInt(String(msP?.supply || 0))) / 1e8;
      const half = max / 2;
      const minted = total > half ? total - half : 0;

      const token: LaunchToken = {
        address: addr, name: `Token ${addr.slice(-6)}`, symbol: addr.slice(-4).toUpperCase(),
        decimals: 8, totalSupply: max, publicMintSupply: half,
        maxMintPerTx: Math.floor(max * 0.01), mintedSupply: minted,
        creator: 'unknown', createdAt: Date.now(),
        description: 'Added by contract address', image: null,
        website: '', twitter: '', telegram: '',
        status: minted >= half * GRADUATION_PCT ? 'graduated' : 'bonding',
        txHash: '', trades: [], replies: [], likes: 0,
      };
      const updated = addToken(token);
      setTokens(updated);
      setSelected(token);
      setAddAddr('');
      if (useServer) registerToken(token).catch(() => {});
    } catch (e) {
      setMintStep(e instanceof Error ? e.message : 'Invalid contract');
      setTimeout(() => setMintStep(''), 3000);
    } finally {
      setAdding(false);
    }
  }, [addAddr, tokens, provider, useServer]);

  // Token created callback
  const handleCreated = useCallback((token: LaunchToken) => {
    const updated = addToken(token);
    setTokens(updated);
    setSelected(token);
    if (useServer) registerToken(token).catch(() => {});
  }, [useServer]);

  const isReal = selected && selected.address.startsWith('opt1sq');
  const localHolderCount = selected ? new Set(selected.trades.map(t => t.wallet)).size : 0;
  const [opscanHolders, setOpscanHolders] = useState<number | null>(null);
  const [opscanHolderList, setOpscanHolderList] = useState<Array<{ address: string; balance: string }>>([]);
  // Fetch holder count from OPScan when selected token changes
  useEffect(() => {
    setOpscanHolders(null);
    setOpscanHolderList([]);
    if (!selected) return;
    // Try to find the hex address — our tokens use opt1sq which contains hex pubkey
    // For OPScan we need the hex contract address
    const addr = selected.address;
    if (!addr) return;
    // If address is hex or starts with 0x, use directly; otherwise try txHash-based lookup
    const hexAddr = addr.startsWith('0x') ? addr : (addr.length === 64 ? '0x' + addr : null);
    if (!hexAddr) return;
    void (async () => {
      try {
        const r = await fetch(`${OPSCAN_API_BASE}/tokens/${hexAddr}/holders`);
        if (!r.ok) return;
        const data = await r.json();
        const arr = data?.results || data || [];
        if (Array.isArray(arr)) {
          setOpscanHolders(arr.length);
          setOpscanHolderList(arr.slice(0, 20).map((h: Record<string, unknown>) => ({
            address: String(h.address || h.holderAddress || '').slice(0, 20) + '...',
            balance: String(h.balance || h.amount || '0'),
          })));
        }
      } catch (e) { logger.warn('[Launchpad] Holder data fetch failed:', e); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depend on selected?.address only to avoid refetching on unrelated property changes
  }, [selected?.address]);
  const holderCount = opscanHolders !== null ? opscanHolders : localHolderCount;
  const progress = selected ? getProgress(selected) : 0;
  const grad = selected ? isGraduated(selected) : false;
  const [selColor] = selected ? hashColor(selected.symbol) : ['#F7931A'];

  /* ─── RENDER ─── */
  return (
    <div className="lp-split">
      {/* ═══ LEFT SIDEBAR ═══ */}
      <div className="lp-sidebar">
        <div className="p-14-14-10 bd-b-bd">
          <div className="d-flex jc-between ai-center mb-10">
            <span className="fw-800 fs-100 c-w">Contracts</span>
            <span className="fs-66 c-t4 text-mono br-6 p-2-8" style={{ background: 'rgba(255,255,255,.05)' }}>{tokens.length}</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or address..."
            className="w-full br-12 c-w fs-82 ff-ui outline-none mb-8 p-10-14 bg-bg3 bd-bd box-border" />
          <div className="d-flex gap-4">
            {([['hot1h', '1H Hot'], ['hot8h', '8H Hot'], ['hot24h', '24H Hot'], ['newest', 'Newest'], ['holders', 'Holders']] as [SortMode, string][]).map(([m, label]) => (
              <button key={m} onClick={() => setSortMode(m)}
                className="flex-1 br-8 fs-66 pointer ff-ui fw-700" style={{ padding: '6px 2px', border: '1px solid ' + (sortMode === m ? 'rgba(247,147,26,.5)' : 'var(--bd)'), background: sortMode === m ? 'rgba(247,147,26,.15)' : 'rgba(255,255,255,.03)', color: sortMode === m ? 'var(--o)' : 'var(--t3)', transition: 'all .15s' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Token list */}
        <div className="lp-sidebar-list">
          {filtered.map(t => (
            <TokenListItem key={t.address} token={t} active={selected?.address === t.address} onClick={() => setSelected(t)} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center c-t4 p-20 fs-70">No contracts found</div>
          )}
        </div>

        {/* Add contract */}
        <div className="p-8-10 bd-t-bd">
          <div className="d-flex gap-4 mb-6">
            <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="opt1sq... address"
              onKeyDown={e => e.key === 'Enter' && handleAddContract()}
              className="flex-1 br-8 c-w fs-60 text-mono outline-none p-6-8 bg-bg3 bd-bd" />
            <button onClick={handleAddContract} disabled={adding}
              className="br-8 c-o fs-60 pointer ff-ui fw-700 p-6-10" style={{ background: 'rgba(247,147,26,.15)', border: '1px solid rgba(247,147,26,.3)' }}>
              {adding ? '...' : '+'}
            </button>
          </div>
          <button onClick={() => setDeployOpen(true)} className="lbtn w-full fs-70 p-8">
            Deploy New Contract
          </button>
        </div>
      </div>

      {/* ═══ RIGHT MAIN PANEL ═══ */}
      <div className="lp-main">
        {!selected ? (
          <div className="flex-center-full c-t4 fs-82 h-full">
            Select a contract from the sidebar
          </div>
        ) : (
          <div className="m-auto p-16-20 max-w-720">
            {/* ── Header ── */}
            <div className="flex-center gap-14 mb-16">
              <img src={selected.image || genLogo(selected.symbol)} alt="" className="br-50 w-52 h-52" style={{ border: `2px solid ${selColor}44` }} />
              <div className="flex-1">
                <div className="flex-center gap-8 flex-wrap">
                  <span className="fw-800 c-w fs-110">{selected.name}</span>
                  <span className="text-mono fw-700 fs-90" style={{ color: selColor }}>${selected.symbol}</span>
                  {grad && <span className="c-g fw-700 fs-xs br-6 p-2-8 tag-grad">GRADUATED</span>}
                  {isReal && <span className="c-o fw-600 br-6 fs-56 p-2-8" style={{ background: 'rgba(247,147,26,.1)' }}>ON-CHAIN</span>}
                </div>
                <div className="fs-xs c-t4 text-mono mt-2 word-break">
                  {selected.address}
                </div>
                <div className="flex-center gap-10 mt-4">
                  {selected.twitter && <a href={`https://x.com/${selected.twitter}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x1D54F; Twitter</a>}
                  {selected.website && <a href={`https://${selected.website}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x1F310; Website</a>}
                  {selected.telegram && <a href={`https://t.me/${selected.telegram}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x2708; Telegram</a>}
                </div>
              </div>
            </div>

            {selected.description && (
              <div className="fs-72 c-t3 mb-14 lh-15">
                {selected.description}
              </div>
            )}

            {/* ── Supply Info ── */}
            <div className="P p-14 mb-12">
              <div className="Lb mb-8">Supply</div>
              {/* Progress bar */}
              <div className="mb-10">
                <div className="flex-between mb-4 fs-58 c-t4">
                  <span>Minted: {fmtNum(selected.mintedSupply)} / {fmtNum(selected.publicMintSupply)}</span>
                  <span className="fw-700" style={{ color: grad ? 'var(--g)' : selColor }}>{(progress * 100).toFixed(1)}%</span>
                </div>
                <div className="br-4 ov-hidden progress-bar-md">
                  <div className="br-4" style={{ height: '100%', background: grad ? 'var(--g)' : `linear-gradient(90deg, ${selColor}, var(--o))`, width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .5s' }} />
                </div>
              </div>
              <div className="d-grid fs-66 grid-1-1" style={{ gap: '6px 16px' }}>
                {[
                  ['Total Supply', fmtNum(selected.totalSupply)],
                  ['Public Mint', fmtNum(selected.publicMintSupply)],
                  ['Max / TX', fmtNum(selected.maxMintPerTx)],
                  ['Decimals', String(selected.decimals)],
                  ['Holders', String(holderCount)],
                  ['Creator', selected.creator.slice(0, 16) + '...'],
                  ['Created', timeAgo(selected.createdAt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex-between">
                    <span className="c-t4">{k}</span>
                    <span className="c-t2 text-mono fs-xs">{v}</span>
                  </div>
                ))}
              </div>
              {walletAddress && userBal > 0 && (
                <div className="mt-8 br-8 fs-66 p-6-10 tag-onchain">
                  Your balance: <strong className="c-g text-mono">{fmtNum(userBal)} {selected.symbol}</strong>
                </div>
              )}
            </div>

            {/* ── Holders (OPScan or local) ── */}
            {opscanHolderList.length > 0 ? (
              <div className="P p-14 mb-12">
                <div className="Lb mb-8">
                  Top Holders ({opscanHolders ?? opscanHolderList.length})
                  <span className="fs-50 c-t4 fw-400 ml-6">via OPScan</span>
                </div>
                <div className="max-h-200-overflow">
                  {opscanHolderList.map((h, i) => (
                    <div key={i} className="flex-between fs-66" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                      <div className="flex-center gap-8">
                        <span className="c-t4 text-mono min-w-20">#{i + 1}</span>
                        <span className="c-t2 text-mono">{h.address}</span>
                      </div>
                      <span className="text-mono fw-600 c-w fs-xs">
                        {(() => { try { const n = Number(BigInt(h.balance)) / Math.pow(10, selected.decimals); return fmtNum(n); } catch (e) { logger.warn('[Launchpad] Failed to format holder balance:', e); return h.balance; } })()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : selected.trades.length > 0 && (() => {
              const bals: Record<string, number> = {};
              for (const tr of selected.trades) {
                bals[tr.wallet] = (bals[tr.wallet] || 0) + tr.amount;
              }
              const sorted = Object.entries(bals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
              if (sorted.length === 0) return null;
              return (
                <div className="P p-14 mb-12">
                  <div className="Lb mb-8">Top Holders ({sorted.length})</div>
                  <div className="max-h-200-overflow">
                    {sorted.map(([wallet, amount], i) => (
                      <div key={wallet} className="flex-between fs-66" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                        <div className="flex-center gap-8">
                          <span className="c-t4 text-mono min-w-20">#{i + 1}</span>
                          <span className="c-t2 text-mono">{wallet.length > 20 ? wallet.slice(0, 12) + '...' + wallet.slice(-6) : wallet}</span>
                        </div>
                        <div className="flex-center gap-6">
                          <span className="text-mono fw-600 c-w">{fmtNum(amount)}</span>
                          <span className="c-t4 fs-56">{selected.symbol}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Mint Panel ── */}
            {selected.status === 'pending_confirm' ? (
              <div className="P p-14 mb-12 text-center">
                <div className="fs-120 mb-6" style={{ animation: 'spin 2s linear infinite' }}>&#x23F3;</div> {/* dynamic animation */}
                <div className="fw-700 c-y fs-82 mb-4">Awaiting Confirmation</div>
                <div className="fs-72 c-t3">
                  Contract is being deployed. Wait ~5 blocks for on-chain confirmation before minting.
                </div>
              </div>
            ) : !grad ? (
              <div className="P p-14 mb-12">
                <div className="Lb mb-8">Public Mint</div>
                <div className="mb-6">
                  <div className="flex-between mb-4 fs-62 c-t3">
                    <span>Amount</span>
                    <span className="fw-700 c-w text-mono">
                      {mintAmt ? fmtNum(Number(mintAmt)) : '0'} / {fmtNum(selected.maxMintPerTx)}
                    </span>
                  </div>
                  <input type="range" min={0} max={selected.maxMintPerTx} step={Math.max(1, Math.floor(selected.maxMintPerTx / 100))}
                    value={Number(mintAmt) || 0}
                    onChange={e => setMintAmt(e.target.value === '0' ? '' : e.target.value)}
                    className="w-full mb-4" style={{ accentColor: selColor }} />
                  <div className="d-flex gap-4">
                    {[25, 50, 75, 100].map(pct => (
                      <button key={pct} onClick={() => setMintAmt(String(Math.floor(selected.maxMintPerTx * pct / 100)))}
                        className="flex-1 br-8 c-t3 fs-56 pointer text-mono" style={{ padding: '4px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--bd)' }}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleMint} disabled={minting || !mintAmt}
                  className="lbtn w-full" style={{ opacity: minting ? 0.6 : 1 }}>
                  {minting ? mintStep || 'Minting...' : walletAddress ? `Mint ${selected.symbol}` : 'Connect Wallet'}
                </button>
                {!minting && mintStep && (
                  <div className="mt-6 fs-62 text-center" style={{ color: mintStep.includes('Minted') ? 'var(--g)' : '#ef4444' }}>
                    {mintStep}
                  </div>
                )}
                <div className="mt-8 c-t4 text-center fs-54">
                  On-chain publicMint &middot; Costs ~1K sats BTC gas
                </div>
              </div>
            ) : (
              <div className="P p-14 mb-12 text-center">
                <div className="mb-6 fs-160">&#x1F393;</div>
                <div className="fw-700 c-g fs-82 mb-4">Graduated!</div>
                <div className="fs-72 c-t3">
                  Public mint complete. Trade on <strong>Swap</strong> page via MotoSwap AMM.
                </div>
              </div>
            )}

            {/* ── Links & Trade ── */}
            <div className="P p-14 mb-12">
              <div className="Lb mb-8">Links & Trade</div>
              <div className="flex-center gap-6 flex-wrap mb-8">
                {isReal && (
                  <a href={getContractOpscanUrl(selected.address)} target="_blank" rel="noopener noreferrer"
                    className="br-8 c-c fs-62 no-decoration fw-600 p-4-10 bg-info-b">
                    OPScan
                  </a>
                )}
                {isReal && selected.txHash && (
                  <a href={getTxUrl(selected.txHash)} target="_blank" rel="noopener noreferrer"
                    className="br-8 c-o fs-62 no-decoration fw-600 p-4-10 bg-info-o-08">
                    Deploy TX
                  </a>
                )}
              </div>
              <div className="fs-sm c-t3 lh-15">
                Trade on <strong>Swap</strong> page via MotoSwap AMM pools.
              </div>
            </div>

            {/* ── Recent Activity ── */}
            <div className="P p-14">
              <div className="Lb mb-8">Recent Activity</div>
              <div className="max-h-200-overflow">
                {selected.trades.slice().reverse().slice(0, 15).map(tr => (
                  <div key={tr.id} className="flex-between fs-62" style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                    <div className="flex-center gap-6">
                      <span className="c-g fw-700">MINT</span>
                      <span className="c-t2 text-mono">{fmtNum(tr.amount)} {selected.symbol}</span>
                    </div>
                    <div className="flex-center gap-8 c-t4">
                      <span>{tr.wallet.slice(0, 8)}...</span>
                      <span>{timeAgo(tr.timestamp)}</span>
                    </div>
                  </div>
                ))}
                {selected.trades.length === 0 && (
                  <div className="c-t4 fs-sm text-center p-16">
                    No mints yet. Be the first!
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Deploy Modal */}
      <DeployModal open={deployOpen} onClose={() => setDeployOpen(false)} onCreated={handleCreated} />
    </div>
  );
};

export default Launchpad;
