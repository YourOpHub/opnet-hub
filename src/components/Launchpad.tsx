import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Transaction } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type BitcoinInterfaceAbi, type CallResult, type BaseContractProperties, type IOP20Contract,
  type TransactionParameters,
} from 'opnet';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { buildTxParams, withRetry, formatTxError } from '../txUtils';
import type { LaunchToken, TradeRecord } from '../launchpad/types';
import {
  getProgress, isGraduated, fmtNum, hashColor, genLogo, timeAgo, GRADUATION_PCT,
} from '../launchpad/types';
import { loadTokens, saveTokens, addToken, addTrade } from '../launchpad/store';
import { isServerAvailable, fetchTokens, registerToken } from '../launchpad/api';
const OP20_ABI: BitcoinInterfaceAbi = [
  { name: 'publicMint', inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [], type: BitcoinAbiTypes.Function },
  { name: 'totalSupply', inputs: [], outputs: [{ name: 'supply', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'maximumSupply', inputs: [], outputs: [{ name: 'supply', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'balanceOf', inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'isPublicMintEnabled', inputs: [], outputs: [{ name: 'enabled', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'getMaxMintPerTx', inputs: [], outputs: [{ name: 'maxAmount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
];

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

  return (
    <div onClick={onClick} className={`lp-list-item ${active ? 'active' : ''}`}
      style={{ borderLeft: `3px solid ${active ? c1 : 'transparent'}` }}>
      <img src={imgSrc} alt="" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--w)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token.symbol}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {isReal && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--g)', flexShrink: 0 }} />}
            {grad && <span style={{ fontSize: '.5rem', color: 'var(--g)', fontWeight: 700 }}>GRAD</span>}
          </div>
        </div>
        <div style={{ fontSize: '.68rem', color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {token.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: grad ? 'var(--g)' : `linear-gradient(90deg, ${c1}, ${c1}88)`,
              width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .3s',
            }} />
          </div>
          <span style={{ fontSize: '.58rem', fontFamily: 'var(--fm)', color: 'var(--t4)', minWidth: 28, textAlign: 'right' }}>
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
      const initialMintAmount = maxSupply / 2n; // 50% to deployer
      const maxPerTx = BigInt(Math.floor(supplyNum * 0.01)) * (10n ** 8n); // 1% per TX

      const writer = new BinaryWriter();
      writer.writeU256(maxSupply);
      writer.writeU8(decimals);
      writer.writeStringWithLength(name.trim());
      writer.writeStringWithLength(symbol.trim().toUpperCase());
      writer.writeU256(initialMintAmount);
      writer.writeBoolean(true); // publicMint enabled
      writer.writeU256(maxPerTx);

      setStep('Fetching UTXOs...');
      const utxos = await provider.utxoManager.getUTXOs({ address: walletAddress });
      if (!utxos?.length) throw new Error('No UTXOs. Get testnet BTC from faucet.');

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
      try { txid = Transaction.fromHex(deployTx || fundingTx || '').getId(); } catch {}

      const token: LaunchToken = {
        address: result.contractAddress || txid || `opt1sq_${Date.now()}`,
        name: name.trim(), symbol: symbol.trim().toUpperCase(), decimals: 8,
        totalSupply: supplyNum, publicMintSupply: supplyNum / 2,
        maxMintPerTx: Math.floor(supplyNum * 0.01),
        mintedSupply: 0, creator: walletAddress,
        createdAt: Date.now(), description: desc.trim() || `${name.trim()} on Bitcoin L1`,
        image: img, website, twitter, telegram,
        status: 'bonding', txHash: txid, trades: [], replies: [], likes: 0,
      };

      onCreated(token);
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
    fontSize: '.78rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>Deploy Contract</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: '1.2rem', cursor: 'pointer' }}>&#x2715;</button>
        </div>

        {/* Image upload */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div onClick={() => fileRef.current?.click()}
            style={{ width: 72, height: 72, borderRadius: '50%', border: '2px dashed var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: 'var(--bg3)' }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: '1.5rem', color: 'var(--t4)' }}>+</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Name *</label>
            <input style={iStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin Pepe" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Ticker *</label>
            <input style={{ ...iStyle, textTransform: 'uppercase' }} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="BPEPE" maxLength={6} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Description</label>
          <textarea style={{ ...iStyle, minHeight: 60, resize: 'vertical' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Tell the world about your token..." />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Total Supply</label>
          <input style={iStyle} type="text" inputMode="numeric" value={supply} onChange={e => setSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000000" />
          <div style={{ fontSize: '.56rem', color: 'var(--t4)', marginTop: 2 }}>50% to you &middot; 50% for public mint &middot; 1% max per TX</div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Website</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={website} onChange={e => setWebsite(e.target.value)} placeholder="example.com" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Twitter</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@handle" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Telegram</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="t.me/group" />
          </div>
        </div>

        <div style={{ padding: '8px 10px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 10, fontSize: '.65rem', color: 'var(--t3)', marginBottom: 12 }}>
          Deploy cost: <strong style={{ color: 'var(--o)' }}>~50K sats (~0.0005 BTC)</strong> &middot; Contract goes live on Bitcoin L1
        </div>

        {error && <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#ef4444', fontSize: '.72rem', marginBottom: 10 }}>{error}</div>}

        <button onClick={deploy} disabled={deploying} className="lbtn" style={{ width: '100%', opacity: deploying ? 0.6 : 1 }}>
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

  // Load from server on mount (social/registry layer)
  useEffect(() => {
    (async () => {
      const available = await isServerAvailable();
      setUseServer(available);
      if (available) {
        const serverTokens = await fetchTokens();
        if (serverTokens && serverTokens.length > 0) {
          const local = loadTokens();
          const merged = serverTokens.map(st => {
            const lt = local.find(l => l.address === st.address);
            return lt ? { ...lt, replies: st.replies || lt.replies, likes: st.likes || lt.likes } : st;
          });
          local.forEach(lt => { if (!merged.find(m => m.address === lt.address)) merged.push(lt); });
          setTokens(merged);
          saveTokens(merged);
        }
      }
    })();
  }, []);

  // On-chain sync for selected token
  const syncToken = useCallback(async (addr: string) => {
    if (!addr.startsWith('opt1sq')) return;
    try {
      const c = getContract<IOP20Contract>(addr, OP20_ABI, provider, NETWORK);
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
    } catch (e) { console.warn('[LP] sync failed:', e); }
  }, [provider]);

  // On-chain balance for selected token
  const syncBalance = useCallback(async (addr: string) => {
    if (!senderAddr || !addr.startsWith('opt1sq')) { setUserBal(0); return; }
    try {
      const c = getContract<IOP20Contract>(addr, OP20_ABI, provider, NETWORK, senderAddr);
      const res = await c.balanceOf(senderAddr);
      if (!(res as CallResult).revert) {
        const p = (res as CallResult).properties as Record<string, unknown>;
        setUserBal(Number(BigInt(String(p?.balance || 0))) / 1e8);
      }
    } catch { setUserBal(0); }
  }, [senderAddr, provider]);

  // Sync when selected changes
  useEffect(() => {
    if (!selected) return;
    syncToken(selected.address);
    syncBalance(selected.address);
  }, [selected?.address, walletAddress, syncToken, syncBalance]);

  // Auto-select first token
  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0]);
  }, [tokens, selected]);

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
      const contract = getContract<MintableOP20>(selected.address, OP20_ABI, provider, NETWORK, senderAddr);

      setMintStep('Simulating publicMint...');
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      const callRes = sim as CallResult;
      if (callRes.revert) throw new Error(`Reverted: ${callRes.revert}`);
      if (!callRes.sendTransaction) throw new Error('Simulation failed — contract may not support publicMint');

      setMintStep('Sign in your wallet...');
      const txParams = await buildTxParams(provider, walletAddress);
      const receipt = await callRes.sendTransaction(txParams as TransactionParameters);
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

      setMintStep('Minted! Syncing...');
      setTimeout(() => { syncToken(selected.address); syncBalance(selected.address); }, 8000);
      setTimeout(() => setMintStep(''), 6000);
      setMintAmt('');
    } catch (e) {
      console.error('[LP Mint]', e);
      setMintStep(formatTxError(e));
      setTimeout(() => setMintStep(''), 6000);
    } finally {
      setMinting(false);
    }
  }, [walletAddress, senderAddr, selected, mintAmt, provider, openConnectModal, syncToken, syncBalance]);

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
      const c = getContract<IOP20Contract>(addr, OP20_ABI, provider, NETWORK);
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
  const holderCount = selected ? new Set(selected.trades.map(t => t.wallet)).size : 0;
  const progress = selected ? getProgress(selected) : 0;
  const grad = selected ? isGraduated(selected) : false;
  const [selColor] = selected ? hashColor(selected.symbol) : ['#F7931A'];

  /* ─── RENDER ─── */
  return (
    <div className="lp-split">
      {/* ═══ LEFT SIDEBAR ═══ */}
      <div className="lp-sidebar">
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>Contracts</span>
            <span style={{ fontSize: '.66rem', color: 'var(--t4)', fontFamily: 'var(--fm)', background: 'rgba(255,255,255,.05)', padding: '2px 8px', borderRadius: 6 }}>{tokens.length}</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or address..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {([['hot1h', '1H Hot'], ['hot8h', '8H Hot'], ['hot24h', '24H Hot'], ['newest', 'Newest'], ['holders', 'Holders']] as [SortMode, string][]).map(([m, label]) => (
              <button key={m} onClick={() => setSortMode(m)}
                style={{ flex: 1, padding: '6px 2px', borderRadius: 8, border: '1px solid ' + (sortMode === m ? 'rgba(247,147,26,.5)' : 'var(--bd)'), background: sortMode === m ? 'rgba(247,147,26,.15)' : 'rgba(255,255,255,.03)', color: sortMode === m ? 'var(--o)' : 'var(--t3)', fontSize: '.66rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700, transition: 'all .15s' }}>
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
            <div style={{ padding: 20, textAlign: 'center', fontSize: '.7rem', color: 'var(--t4)' }}>No contracts found</div>
          )}
        </div>

        {/* Add contract */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="opt1sq... address"
              onKeyDown={e => e.key === 'Enter' && handleAddContract()}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.6rem', fontFamily: 'var(--fm)', outline: 'none' }} />
            <button onClick={handleAddContract} disabled={adding}
              style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(247,147,26,.15)', border: '1px solid rgba(247,147,26,.3)', color: 'var(--o)', fontSize: '.6rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700 }}>
              {adding ? '...' : '+'}
            </button>
          </div>
          <button onClick={() => setDeployOpen(true)} className="lbtn" style={{ width: '100%', padding: '8px', fontSize: '.7rem' }}>
            Deploy New Contract
          </button>
        </div>
      </div>

      {/* ═══ RIGHT MAIN PANEL ═══ */}
      <div className="lp-main">
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t4)', fontSize: '.82rem' }}>
            Select a contract from the sidebar
          </div>
        ) : (
          <div style={{ padding: '16px 20px', maxWidth: 720, margin: '0 auto' }}>
            {/* ── Header ── */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
              <img src={selected.image || genLogo(selected.symbol)} alt="" style={{ width: 52, height: 52, borderRadius: '50%', border: `2px solid ${selColor}44` }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--w)' }}>{selected.name}</span>
                  <span style={{ fontFamily: 'var(--fm)', color: selColor, fontWeight: 700, fontSize: '.9rem' }}>${selected.symbol}</span>
                  {grad && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(16,185,129,.12)', color: 'var(--g)', fontSize: '.6rem', fontWeight: 700 }}>GRADUATED</span>}
                  {isReal && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(247,147,26,.1)', color: 'var(--o)', fontSize: '.56rem', fontWeight: 600 }}>ON-CHAIN</span>}
                </div>
                <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontFamily: 'var(--fm)', marginTop: 2, wordBreak: 'break-all' }}>
                  {selected.address}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  {selected.twitter && <a href={`https://x.com/${selected.twitter}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.6rem', color: 'var(--c2)', textDecoration: 'none' }}>&#x1D54F; Twitter</a>}
                  {selected.website && <a href={`https://${selected.website}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.6rem', color: 'var(--c2)', textDecoration: 'none' }}>&#x1F310; Website</a>}
                  {selected.telegram && <a href={`https://t.me/${selected.telegram}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.6rem', color: 'var(--c2)', textDecoration: 'none' }}>&#x2708; Telegram</a>}
                </div>
              </div>
            </div>

            {selected.description && (
              <div style={{ fontSize: '.72rem', color: 'var(--t3)', marginBottom: 14, lineHeight: 1.5 }}>
                {selected.description}
              </div>
            )}

            {/* ── Supply Info ── */}
            <div className="P" style={{ padding: 14, marginBottom: 12 }}>
              <div className="Lb" style={{ marginBottom: 8 }}>Supply</div>
              {/* Progress bar */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.58rem', color: 'var(--t4)', marginBottom: 3 }}>
                  <span>Minted: {fmtNum(selected.mintedSupply)} / {fmtNum(selected.publicMintSupply)}</span>
                  <span style={{ color: grad ? 'var(--g)' : selColor, fontWeight: 700 }}>{(progress * 100).toFixed(1)}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    background: grad ? 'var(--g)' : `linear-gradient(90deg, ${selColor}, var(--o))`,
                    width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .5s',
                  }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '.66rem' }}>
                {[
                  ['Total Supply', fmtNum(selected.totalSupply)],
                  ['Public Mint', fmtNum(selected.publicMintSupply)],
                  ['Max / TX', fmtNum(selected.maxMintPerTx)],
                  ['Decimals', String(selected.decimals)],
                  ['Holders', String(holderCount)],
                  ['Creator', selected.creator.slice(0, 16) + '...'],
                  ['Created', timeAgo(selected.createdAt)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--t4)' }}>{k}</span>
                    <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)', fontSize: '.6rem' }}>{v}</span>
                  </div>
                ))}
              </div>
              {walletAddress && userBal > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(16,185,129,.06)', borderRadius: 8, fontSize: '.66rem' }}>
                  Your balance: <strong style={{ color: 'var(--g)', fontFamily: 'var(--fm)' }}>{fmtNum(userBal)} {selected.symbol}</strong>
                </div>
              )}
            </div>

            {/* ── Top Holders ── */}
            {selected.trades.length > 0 && (() => {
              const bals: Record<string, number> = {};
              for (const tr of selected.trades) {
                bals[tr.wallet] = (bals[tr.wallet] || 0) + tr.amount;
              }
              const sorted = Object.entries(bals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
              if (sorted.length === 0) return null;
              return (
                <div className="P" style={{ padding: 14, marginBottom: 12 }}>
                  <div className="Lb" style={{ marginBottom: 8 }}>Top Holders ({sorted.length})</div>
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {sorted.map(([wallet, amount], i) => (
                      <div key={wallet} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.66rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--t4)', fontFamily: 'var(--fm)', minWidth: 20 }}>#{i + 1}</span>
                          <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{wallet.length > 20 ? wallet.slice(0, 12) + '...' + wallet.slice(-6) : wallet}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)', fontWeight: 600 }}>{fmtNum(amount)}</span>
                          <span style={{ color: 'var(--t4)', fontSize: '.56rem' }}>{selected.symbol}</span>
                          {selected.publicMintSupply > 0 && (
                            <span style={{ color: 'var(--t4)', fontSize: '.52rem', fontFamily: 'var(--fm)', minWidth: 40, textAlign: 'right' }}>
                              {((amount / selected.publicMintSupply) * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Mint Panel ── */}
            {!grad ? (
              <div className="P" style={{ padding: 14, marginBottom: 12 }}>
                <div className="Lb" style={{ marginBottom: 8 }}>Public Mint</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input type="text" inputMode="numeric" value={mintAmt} onChange={e => setMintAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={`Amount (max ${fmtNum(selected.maxMintPerTx)})`}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.8rem', fontFamily: 'var(--fm)', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {[1000, 10000, 100000, selected.maxMintPerTx].filter(v => v > 0).map((v, i) => (
                    <button key={i} onClick={() => setMintAmt(String(v))}
                      style={{ flex: 1, padding: '5px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--bd)', color: 'var(--t3)', fontSize: '.56rem', cursor: 'pointer', fontFamily: 'var(--fm)' }}>
                      {v === selected.maxMintPerTx ? 'MAX' : fmtNum(v)}
                    </button>
                  ))}
                </div>
                <button onClick={handleMint} disabled={minting || !mintAmt}
                  className="lbtn" style={{ width: '100%', opacity: minting ? 0.6 : 1 }}>
                  {minting ? mintStep || 'Minting...' : walletAddress ? `Mint ${selected.symbol}` : 'Connect Wallet'}
                </button>
                {!minting && mintStep && (
                  <div style={{ marginTop: 6, fontSize: '.62rem', color: mintStep.includes('Minted') ? 'var(--g)' : '#ef4444', textAlign: 'center' }}>
                    {mintStep}
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: '.54rem', color: 'var(--t4)', textAlign: 'center' }}>
                  On-chain publicMint &middot; Costs ~1K sats BTC gas
                </div>
              </div>
            ) : (
              <div className="P" style={{ padding: 14, marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>&#x1F393;</div>
                <div style={{ fontWeight: 700, color: 'var(--g)', fontSize: '.82rem', marginBottom: 4 }}>Graduated!</div>
                <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>
                  Public mint complete. Trade on <strong>Swap</strong> page via MotoSwap AMM.
                </div>
              </div>
            )}

            {/* ── Trade ── */}
            <div className="P" style={{ padding: 14, marginBottom: 12 }}>
              <div className="Lb" style={{ marginBottom: 8 }}>Trade</div>
              <div style={{ fontSize: '.7rem', color: 'var(--t3)', lineHeight: 1.6 }}>
                <div style={{ marginBottom: 8 }}>
                  Trade this token on the <strong>Swap</strong> page using MotoSwap AMM pools.
                  After graduation, full trading is available via liquidity pools.
                </div>
                {isReal && selected.txHash && (
                  <a href={`https://testnet.opnet.org/tx/${selected.txHash}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', textDecoration: 'none', fontSize: '.62rem' }}>
                    View deploy TX on explorer &#x2197;
                  </a>
                )}
              </div>
            </div>

            {/* ── Recent Activity ── */}
            <div className="P" style={{ padding: 14 }}>
              <div className="Lb" style={{ marginBottom: 8 }}>Recent Activity</div>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {selected.trades.slice().reverse().slice(0, 15).map(tr => (
                  <div key={tr.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.62rem' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--g)', fontWeight: 700 }}>MINT</span>
                      <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fmtNum(tr.amount)} {selected.symbol}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, color: 'var(--t4)' }}>
                      <span>{tr.wallet.slice(0, 8)}...</span>
                      <span>{timeAgo(tr.timestamp)}</span>
                    </div>
                  </div>
                ))}
                {selected.trades.length === 0 && (
                  <div style={{ color: 'var(--t4)', fontSize: '.68rem', textAlign: 'center', padding: 16 }}>
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
