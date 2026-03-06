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
  const isPending = token.status === 'pending_confirm';

  return (
    <div onClick={onClick} className={`lp-list-item ${active ? 'active' : ''}`}
      style={{ borderLeft: `3px solid ${active ? c1 : 'transparent'}`, opacity: isPending ? 0.5 : 1 }}>
      <img src={imgSrc} alt="" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--w)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token.symbol}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {isPending && <span style={{ fontSize: '.5rem', color: 'var(--y)', fontWeight: 700 }}>PENDING</span>}
            {!isPending && isReal && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--g)', flexShrink: 0 }} />}
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
            const c = getContract<IOP20Contract>(token.address, OP20_ABI, provider, NETWORK);
            const res = await c.maximumSupply();
            if (!(res as CallResult).revert) {
              token.status = 'bonding';
              onCreated(token);
              break;
            }
          } catch { /* not yet */ }
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
          <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Total Supply (Max Supply)</label>
          <input style={iStyle} type="text" inputMode="numeric" value={supply} onChange={e => setSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000000" />
          <div style={{ fontSize: '.56rem', color: 'var(--t4)', marginTop: 2 }}>
            {initialMintPct}% to you ({((parseFloat(supply) || 0) * initialMintPct / 100).toLocaleString()}) &middot; {100 - initialMintPct}% public mint &middot; Max/tx: {maxMintPerTx || ((parseFloat(supply) || 0) * 0.01).toLocaleString()}
          </div>
        </div>

        {/* Token Settings — always visible, compact */}
        <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.12)', borderRadius: 10 }}>
          {/* Row 1: Initial mint slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: '.58rem', color: 'var(--t3)', whiteSpace: 'nowrap', minWidth: 60 }}>Your mint</span>
            <input type="range" min={0} max={100} step={5} value={initialMintPct}
              onChange={e => setInitialMintPct(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#a855f7', height: 4 }} />
            <span style={{ fontSize: '.62rem', fontWeight: 700, color: 'var(--w)', minWidth: 30, textAlign: 'right' }}>{initialMintPct}%</span>
          </div>
          {/* Row 2: Public mint toggle + Max per TX */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPublicMintEnabled(!publicMintEnabled)} style={{
              width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: publicMintEnabled ? '#a855f7' : 'var(--bg3)', position: 'relative', transition: 'background .2s',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 2, left: publicMintEnabled ? 16 : 2, transition: 'left .2s',
              }} />
            </button>
            <span style={{ fontSize: '.56rem', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Public mint</span>
            {publicMintEnabled && (
              <>
                <span style={{ fontSize: '.56rem', color: 'var(--t4)' }}>|</span>
                <span style={{ fontSize: '.56rem', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Max/tx:</span>
                <input style={{ ...iStyle, fontSize: '.66rem', padding: '4px 7px', width: 90 }} type="text" inputMode="numeric"
                  value={maxMintPerTx} onChange={e => setMaxMintPerTx(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={String(Math.floor((parseFloat(supply) || 0) * 0.01))} />
              </>
            )}
          </div>
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

  // Load from server + OPScan on mount
  useEffect(() => {
    (async () => {
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
    (async () => {
      try {
        const r = await fetch(`https://api.opscan.org/v1/op_testnet/tokens/${hexAddr}/holders`);
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
      } catch { /* */ }
    })();
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

            {/* ── Holders (OPScan or local) ── */}
            {opscanHolderList.length > 0 ? (
              <div className="P" style={{ padding: 14, marginBottom: 12 }}>
                <div className="Lb" style={{ marginBottom: 8 }}>
                  Top Holders ({opscanHolders ?? opscanHolderList.length})
                  <span style={{ fontSize: '.5rem', color: 'var(--t4)', marginLeft: 6, fontWeight: 400 }}>via OPScan</span>
                </div>
                <div style={{ maxHeight: 200, overflow: 'auto' }}>
                  {opscanHolderList.map((h, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.66rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--t4)', fontFamily: 'var(--fm)', minWidth: 20 }}>#{i + 1}</span>
                        <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{h.address}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)', fontWeight: 600, fontSize: '.6rem' }}>
                        {(() => { try { const n = Number(BigInt(h.balance)) / Math.pow(10, selected.decimals); return fmtNum(n); } catch { return h.balance; } })()}
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
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Mint Panel ── */}
            {selected.status === 'pending_confirm' ? (
              <div className="P" style={{ padding: 14, marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', marginBottom: 6, animation: 'spin 2s linear infinite' }}>&#x23F3;</div>
                <div style={{ fontWeight: 700, color: 'var(--y)', fontSize: '.82rem', marginBottom: 4 }}>Awaiting Confirmation</div>
                <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>
                  Contract is being deployed. Wait ~5 blocks for on-chain confirmation before minting.
                </div>
              </div>
            ) : !grad ? (
              <div className="P" style={{ padding: 14, marginBottom: 12 }}>
                <div className="Lb" style={{ marginBottom: 8 }}>Public Mint</div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.62rem', color: 'var(--t3)', marginBottom: 3 }}>
                    <span>Amount</span>
                    <span style={{ fontWeight: 700, color: 'var(--w)', fontFamily: 'var(--fm)' }}>
                      {mintAmt ? fmtNum(Number(mintAmt)) : '0'} / {fmtNum(selected.maxMintPerTx)}
                    </span>
                  </div>
                  <input type="range" min={0} max={selected.maxMintPerTx} step={Math.max(1, Math.floor(selected.maxMintPerTx / 100))}
                    value={Number(mintAmt) || 0}
                    onChange={e => setMintAmt(e.target.value === '0' ? '' : e.target.value)}
                    style={{ width: '100%', accentColor: selColor, marginBottom: 4 }} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[25, 50, 75, 100].map(pct => (
                      <button key={pct} onClick={() => setMintAmt(String(Math.floor(selected.maxMintPerTx * pct / 100)))}
                        style={{ flex: 1, padding: '4px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--bd)', color: 'var(--t3)', fontSize: '.56rem', cursor: 'pointer', fontFamily: 'var(--fm)' }}>
                        {pct}%
                      </button>
                    ))}
                  </div>
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

            {/* ── Links & Trade ── */}
            <div className="P" style={{ padding: 14, marginBottom: 12 }}>
              <div className="Lb" style={{ marginBottom: 8 }}>Links & Trade</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {isReal && (
                  <a href={`https://testnet.opscan.org/contract/${selected.address}`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(14,165,233,.08)', border: '1px solid rgba(14,165,233,.15)', color: 'var(--c)', fontSize: '.62rem', textDecoration: 'none', fontWeight: 600 }}>
                    OPScan
                  </a>
                )}
                {isReal && selected.txHash && (
                  <a href={`https://testnet.opnet.org/tx/${selected.txHash}`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(247,147,26,.08)', border: '1px solid rgba(247,147,26,.15)', color: 'var(--o)', fontSize: '.62rem', textDecoration: 'none', fontWeight: 600 }}>
                    Deploy TX
                  </a>
                )}
              </div>
              <div style={{ fontSize: '.68rem', color: 'var(--t3)', lineHeight: 1.5 }}>
                Trade on <strong>Swap</strong> page via MotoSwap AMM pools.
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
