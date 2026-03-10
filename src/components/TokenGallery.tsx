import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  JSONRpcProvider, getContract, BitcoinUtils,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { MINTABLE_ABI } from '../abis';
import { getProvider } from '../contractCache';
import type { TxParams } from '../txUtils';
import { NETWORK, CURRENT_ENV } from '../config';
import * as opnet from '../opnet';
import { DEPLOYED_CONTRACTS, getContractOpscanUrl, getTxUrl } from '../contracts';
import { addTxRecord, getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';
import { useOps } from '../contexts/OpsContext';
import { fetchAllTokens, type IndexedToken, formatTokenBalance } from '../tokenApi';


/** Typed interface for MintableToken publicMint */
interface IMintableContract extends BaseContractProperties {
  publicMint(amount: bigint): Promise<CallResult>;
}

const FAUCET = 'https://faucet.opnet.org';

/** Fetch network gas parameters and build proper tx params */
async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<TxParams> {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee: bigint = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  // Frontend: signer/mldsaSigner null — wallet extension injects real signers
  return {
    signer: null,
    mldsaSigner: null,
    refundTo,
    maximumAllowedSatToSpend: 50_000n,
    network: NETWORK,
    feeRate,
    priorityFee,
  };
}

interface DeployedToken {
  address: string;
  txid: string;
  name: string;
  symbol: string;
  supply: string;
  decimals: number;
  mode: 'standard' | 'mintable';
  publicMint: boolean;
  maxMintPerTx: string;
  initialMintPct: number;
  deployedAt: number;
  deployer: string;
}


const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g${s})"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g${s}" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

const TokenGallery: React.FC = () => {
  const { walletAddress, walletInstance, address: senderAddr, openConnectModal } = useWalletConnect();
  const { trackOp, completeOp } = useOps();
  const [tokens, setTokens] = useState<DeployedToken[]>([]);
  const [chainInfo, setChainInfo] = useState<Record<string, { totalSupply: bigint; confirmed: boolean }>>({});
  const [mintAddr, setMintAddr] = useState<string | null>(null);
  const [mintAmount, setMintAmount] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tab, setTab] = useState<'user' | 'featured' | 'all'>('all');
  const [featMintSym, setFeatMintSym] = useState<string | null>(null);
  const [featMintAmt, setFeatMintAmt] = useState('');
  const [featMinting, setFeatMinting] = useState(false);
  const [featMintResult, setFeatMintResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mintHistory, setMintHistory] = useState<TxRecord[]>([]);
  const [histRefresh, setHistRefresh] = useState(0);
  // All tokens from indexer
  const [allTokens, setAllTokens] = useState<IndexedToken[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allSearch, setAllSearch] = useState('');
  const [sortField, setSortField] = useState<'block' | 'symbol' | 'supply' | 'holders'>('block');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterMintable, setFilterMintable] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  // Manual import
  const [importAddr, setImportAddr] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (walletAddress) setMintHistory(getTxHistory(walletAddress).filter(r => r.type === 'mint'));
  }, [walletAddress, histRefresh]);

  // Load all tokens from indexer when tab=all
  const loadAllTokens = useCallback(async () => {
    setAllLoading(true);
    try {
      const list = await fetchAllTokens();
      setAllTokens(list);
    } catch (e) { console.warn('[TokenGallery] Failed to fetch all tokens:', e); }
    setAllLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'all') loadAllTokens();
  }, [tab, loadAllTokens]);

  const API_BASE = import.meta.env.VITE_API_URL || '';
  const doImportToken = useCallback(async () => {
    if (!importAddr || (!importAddr.startsWith('opt1') && !importAddr.startsWith('0x'))) {
      setImportResult({ ok: false, msg: 'Enter a valid opt1... or 0x... address' });
      return;
    }
    setImporting(true); setImportResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/tokens/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: importAddr.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setImportResult({ ok: false, msg: data.error || 'Token not found or not OP-20' });
      } else {
        setImportResult({ ok: true, msg: `${data.existed ? 'Already indexed' : 'Added'}: ${data.token.symbol} (${data.token.name})` });
        setImportAddr('');
        loadAllTokens();
      }
    } catch (e) {
      setImportResult({ ok: false, msg: e instanceof Error ? e.message : 'Import failed' });
    } finally { setImporting(false); }
  }, [importAddr, API_BASE, loadAllTokens]);

  const toggleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'symbol' ? 'asc' : 'desc');
    }
  }, [sortField]);

  const sortIcon = (field: typeof sortField) => sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const sortedFiltered = useMemo(() => {
    let list = allTokens;
    if (allSearch.trim()) {
      const q = allSearch.toLowerCase();
      list = list.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.includes(q));
    }
    if (filterMintable) {
      list = list.filter(t => t.mintable === 1);
    }
    const sorted = [...list];
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'block': sorted.sort((a, b) => dir * (a.deploy_block - b.deploy_block)); break;
      case 'symbol': sorted.sort((a, b) => dir * a.symbol.localeCompare(b.symbol)); break;
      case 'supply': sorted.sort((a, b) => {
        const sa = BigInt(a.total_supply || '0'); const sb = BigInt(b.total_supply || '0');
        return dir * (sa > sb ? 1 : sa < sb ? -1 : 0);
      }); break;
      case 'holders': sorted.sort((a, b) => dir * ((a.holder_count || 0) - (b.holder_count || 0))); break;
    }
    return sorted;
  }, [allTokens, allSearch, sortField, sortDir, filterMintable]);

  // Reset page when search/sort changes
  useEffect(() => { setPage(0); }, [allSearch, sortField, sortDir, filterMintable]);

  const totalPages = Math.ceil(sortedFiltered.length / PAGE_SIZE);
  const pagedTokens = useMemo(() => sortedFiltered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedFiltered, page]);

  // Load user-deployed tokens from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hub_deployed_tokens');
      if (raw) setTokens(JSON.parse(raw));
    } catch (e) { console.warn('[TokenGallery] Failed to load deployed tokens from localStorage:', e); }
  }, []);

  // Check on-chain status for user tokens
  useEffect(() => {
    if (tokens.length === 0) return;
    const prevNet = opnet.getNetwork();
    opnet.setNetwork(CURRENT_ENV);
    tokens.forEach(t => {
      if (!t.address) return;
      opnet.getTokenTotalSupply(t.address).then(supply => {
        setChainInfo(prev => ({ ...prev, [t.address]: { totalSupply: supply, confirmed: supply > 0n } }));
      }).catch(() => {});
    });
    return () => { opnet.setNetwork(prevNet); };
  }, [tokens]);

  // Featured tokens (our pre-deployed MINE and VIBE)
  const featured = Object.entries(DEPLOYED_CONTRACTS).map(([_sym, tok]) => ({
    address: tok.address,
    symbol: tok.symbol,
    name: tok.name,
    icon: tok.icon,
    supply: tok.supply.toLocaleString(),
    decimals: tok.decimals,
    deployTxid: tok.deployTxid,
    description: tok.description,
    publicMint: tok.publicMint,
    maxMintPerTx: tok.maxMintPerTx,
  }));

  const provider = useMemo(() => getProvider(), []);

  const doFeaturedMint = useCallback(async (tok: typeof featured[0]) => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const amt = parseFloat(featMintAmt);
    if (!amt || amt <= 0) { setFeatMintResult({ ok: false, msg: 'Enter a valid amount' }); return; }
    const maxMint = tok.maxMintPerTx ? tok.maxMintPerTx / Math.pow(10, tok.decimals) : 1_000_000;
    if (amt > maxMint) { setFeatMintResult({ ok: false, msg: `Max ${maxMint.toLocaleString()} per mint` }); return; }
    if (!senderAddr) { setFeatMintResult({ ok: false, msg: 'Wallet not available. Reconnect.' }); return; }
    setFeatMinting(true); setFeatMintResult(null);
    try {
      const rawAmount = BitcoinUtils.expandToDecimals(amt, tok.decimals);
      const contract = getContract<IMintableContract>(tok.address, MINTABLE_ABI, provider, NETWORK, senderAddr);
      const sim = await contract.publicMint(rawAmount);
      if ((sim as CallResult).revert) throw new Error(`Mint reverted: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress!);
      const fmOpId = `mint_${tok.symbol}_${Date.now()}`;
      trackOp({ id: fmOpId, market: 'mint', orderId: tok.symbol, direction: '', role: '', step: `Minting ${amt.toLocaleString()} ${tok.symbol}...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      completeOp(fmOpId);
      const txHash = receipt.transactionId || '';
      setFeatMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${tok.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: tok.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress! });
      setHistRefresh(k => k + 1);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = `No BTC UTXOs.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC: ${FAUCET}` : ''}`;
      setFeatMintResult({ ok: false, msg });
    } finally { setFeatMinting(false); }
  }, [walletAddress, walletInstance, featMintAmt, openConnectModal, provider, senderAddr]);

  const removeToken = (addr: string) => {
    const updated = tokens.filter(t => t.address !== addr);
    setTokens(updated);
    localStorage.setItem('hub_deployed_tokens', JSON.stringify(updated));
  };

  const doMint = useCallback(async (token: DeployedToken) => {
    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    const amt = parseFloat(mintAmount);
    if (!amt || amt <= 0) {
      setMintResult({ ok: false, msg: 'Enter a valid amount' });
      return;
    }

    if (!senderAddr) {
      setMintResult({ ok: false, msg: 'Wallet public key not available. Reconnect wallet.' });
      return;
    }

    setMinting(true);
    setMintResult(null);

    try {
      const rawAmount = BigInt(Math.floor(amt * Math.pow(10, token.decimals)));

      const contract = getContract<IMintableContract>(
        token.address, MINTABLE_ABI, provider, NETWORK, senderAddr,
      );
      const sim = await contract.publicMint(rawAmount);

      if ((sim as CallResult).revert) {
        throw new Error(`Mint simulation reverted: ${(sim as CallResult).revert}`);
      }

      const txParams = await buildTxParams(provider, walletAddress!);
      const umOpId = `mint_${token.symbol}_${Date.now()}`;
      trackOp({ id: umOpId, market: 'mint', orderId: token.symbol, direction: '', role: '', step: `Minting ${amt.toLocaleString()} ${token.symbol}...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      completeOp(umOpId);

      const txHash = receipt.transactionId || '';
      setMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${token.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: token.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress! });
      setHistRefresh(k => k + 1);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) {
        msg = `No BTC UTXOs.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC: ${FAUCET}` : ''}`;
      }
      setMintResult({ ok: false, msg });
    } finally {
      setMinting(false);
    }
  }, [walletAddress, walletInstance, mintAmount, openConnectModal, provider, senderAddr]);

  const connected = !!walletAddress;
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: '14px',
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🪙 Tokens</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 480, margin: '0 auto' }}>
          OPNet {CURRENT_ENV} tokens. Mint directly from your wallet — max 1,000 per transaction.
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([['all', `All Tokens (${allTokens.length})`], ['featured', 'Featured'], ['user', `My (${tokens.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '10px', borderRadius: '14px',
            background: tab === id ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
            border: `1px solid ${tab === id ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`,
            color: tab === id ? 'var(--o)' : 'var(--t2)',
            fontSize: '.78rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
          }}>{label}</button>
        ))}
      </div>

      {/* All Tokens from Indexer */}
      {tab === 'all' && (
        <div>
          {/* Search + Sort row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} type="text" value={allSearch}
              onChange={e => setAllSearch(e.target.value)} placeholder="Search name, symbol, address..." />
            <button onClick={loadAllTokens} disabled={allLoading} style={{
              padding: '8px 12px', borderRadius: '14px', fontSize: '.7rem', fontWeight: 700,
              background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)',
              cursor: allLoading ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
            }}>{allLoading ? '...' : '↻'}</button>
          </div>

          {/* Sort chips + filter */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '.58rem', color: 'var(--t4)', fontWeight: 600, marginRight: 2 }}>Sort:</span>
            {([['block', 'Block'], ['symbol', 'A\u2194Z'], ['supply', 'Supply'], ['holders', 'Holders']] as const).map(([id, label]) => (
              <button key={id} onClick={() => toggleSort(id)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: '.6rem', fontWeight: 700,
                background: sortField === id ? 'rgba(247,147,26,.12)' : 'transparent',
                border: `1px solid ${sortField === id ? 'rgba(247,147,26,.3)' : 'rgba(255,255,255,.06)'}`,
                color: sortField === id ? 'var(--o)' : 'var(--t3)',
                cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .15s',
              }}>{label}{sortIcon(id)}</button>
            ))}
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,.08)', margin: '0 2px' }} />
            <button onClick={() => setFilterMintable(v => !v)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: '.6rem', fontWeight: 700,
              background: filterMintable ? 'rgba(168,85,247,.15)' : 'transparent',
              border: `1px solid ${filterMintable ? 'rgba(168,85,247,.3)' : 'rgba(255,255,255,.06)'}`,
              color: filterMintable ? '#a855f7' : 'var(--t3)',
              cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .15s',
            }}>Mintable{filterMintable ? ' \u2713' : ''}</button>
            <span style={{ marginLeft: 'auto', fontSize: '.58rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
              {sortedFiltered.length.toLocaleString()} tokens
            </span>
          </div>

          {/* Manual import (collapsible) */}
          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--t3)', cursor: 'pointer', padding: '6px 0' }}>
              + Import token by address
            </summary>
            <div className="P" style={{ padding: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1, fontSize: '.72rem' }} type="text" value={importAddr}
                  onChange={e => setImportAddr(e.target.value)} placeholder="0x... or opt1sq..." />
                <button onClick={doImportToken} disabled={importing} style={{
                  padding: '8px 14px', borderRadius: '14px', fontSize: '.68rem', fontWeight: 700,
                  background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none',
                  color: 'white', cursor: importing ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
                  opacity: importing ? 0.6 : 1, whiteSpace: 'nowrap',
                }}>{importing ? '...' : 'Import'}</button>
              </div>
              {importResult && (
                <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, fontSize: '.62rem',
                  background: importResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                  border: `1px solid ${importResult.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.2)'}`,
                  color: importResult.ok ? 'var(--g)' : '#ef4444',
                }}>{importResult.msg}</div>
              )}
            </div>
          </details>

          {/* Token table */}
          {allLoading && allTokens.length === 0 ? (
            <div className="P empty-state">
              <div className="empty-state-icon">⏳</div>
              <div className="empty-state-title">Loading tokens...</div>
              <div className="empty-state-desc">Fetching the full token index from the OP_NET blockchain.</div>
            </div>
          ) : sortedFiltered.length === 0 ? (
            <div className="P empty-state">
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">{allSearch ? 'No tokens match your search' : 'No tokens found'}</div>
              <div className="empty-state-desc">
                {allSearch ? 'Try a different search term or clear the filter.' : 'The indexer is scanning blocks — tokens will appear as they are discovered.'}
              </div>
            </div>
          ) : (
            <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--bd)', background: 'var(--bg2)' }}>
              {/* Table header — clickable for sorting */}
              <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 70px 80px 50px 50px', gap: 4, padding: '7px 10px',
                fontSize: '.56rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700,
                borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(8,8,16,.5)', userSelect: 'none' }}>
                <span style={{ textAlign: 'center' }}>#</span>
                <span onClick={() => toggleSort('symbol')} style={{ cursor: 'pointer', color: sortField === 'symbol' ? 'var(--o)' : undefined }}>
                  Token{sortIcon('symbol')}
                </span>
                <span style={{ textAlign: 'right' }}>Symbol</span>
                <span onClick={() => toggleSort('supply')} style={{ textAlign: 'right', cursor: 'pointer', color: sortField === 'supply' ? 'var(--o)' : undefined }}>
                  Supply{sortIcon('supply')}
                </span>
                <span onClick={() => toggleSort('holders')} style={{ textAlign: 'right', cursor: 'pointer', color: sortField === 'holders' ? 'var(--o)' : undefined }}>
                  Holders{sortIcon('holders')}
                </span>
                <span onClick={() => toggleSort('block')} style={{ textAlign: 'right', cursor: 'pointer', color: sortField === 'block' ? 'var(--o)' : undefined }}>
                  Block{sortIcon('block')}
                </span>
              </div>
              {/* Rows */}
              <div>
                {pagedTokens.map((tok, i) => (
                  <a key={tok.pubkey || tok.address} href={getContractOpscanUrl(tok.pubkey || tok.address)} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'grid', gridTemplateColumns: '36px 1fr 70px 80px 50px 50px', gap: 4, padding: '7px 10px',
                      alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.03)',
                      textDecoration: 'none', color: 'inherit', transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ textAlign: 'center', fontSize: '.55rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
                      {page * PAGE_SIZE + i + 1}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <img src={genLogo(tok.symbol)} alt={tok.symbol} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '.72rem', color: 'var(--w)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tok.name}</div>
                        <div style={{ fontFamily: 'var(--fm)', fontSize: '.46rem', color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(tok.pubkey || tok.address).slice(0, 20)}...
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: '.68rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>{tok.symbol}</span>
                      {tok.mintable === 1 && (
                        <span style={{ fontSize: '.4rem', background: 'rgba(168,85,247,.12)', color: '#a855f7',
                          padding: '1px 4px', borderRadius: 3, fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap' }}>MINT</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '.62rem', color: 'var(--t2)', fontFamily: 'var(--fm)' }}>
                      {tok.total_supply && tok.total_supply !== '0' ? formatTokenBalance(tok.total_supply, tok.decimals) : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '.58rem', color: (tok.holder_count || 0) > 0 ? 'var(--t2)' : 'var(--t4)', fontFamily: 'var(--fm)' }}>
                      {(tok.holder_count || 0) > 0 ? tok.holder_count?.toLocaleString() ?? '—' : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '.58rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
                      {tok.deploy_block > 0 ? `#${tok.deploy_block}` : '—'}
                    </div>
                  </a>
                ))}
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px',
                  borderTop: '1px solid rgba(255,255,255,.06)', background: 'rgba(8,8,16,.3)' }}>
                  <button onClick={() => setPage(0)} disabled={page === 0} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: '.58rem', fontWeight: 700,
                    background: 'none', border: '1px solid var(--bd)', color: page === 0 ? 'var(--t4)' : 'var(--t2)',
                    cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--ff)',
                  }}>{'<<'}</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: '.58rem', fontWeight: 700,
                    background: 'none', border: '1px solid var(--bd)', color: page === 0 ? 'var(--t4)' : 'var(--t2)',
                    cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--ff)',
                  }}>{'<'}</button>
                  <span style={{ fontSize: '.62rem', color: 'var(--t2)', fontFamily: 'var(--fm)', minWidth: 80, textAlign: 'center' }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: '.58rem', fontWeight: 700,
                    background: 'none', border: '1px solid var(--bd)', color: page >= totalPages - 1 ? 'var(--t4)' : 'var(--t2)',
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--ff)',
                  }}>{'>'}</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: '.58rem', fontWeight: 700,
                    background: 'none', border: '1px solid var(--bd)', color: page >= totalPages - 1 ? 'var(--t4)' : 'var(--t2)',
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--ff)',
                  }}>{'>>'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Featured tokens */}
      {tab === 'featured' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {featured.map(tok => (
            <div key={tok.symbol} className="P" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.8rem' }}>{tok.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: '.95rem', color: 'var(--w)' }}>{tok.name}</span>
                    <span style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.78rem' }}>${tok.symbol}</span>
                    <span style={{ fontSize: '.48rem', background: 'rgba(16,185,129,.06)', color: 'var(--g)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>
                  </div>
                  <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 2 }}>{tok.description}</div>
                  <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginTop: 4 }}>
                    Supply: {tok.supply} · Decimals: {tok.decimals}
                  </div>
                  <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', marginTop: 2, wordBreak: 'break-all' }}>{tok.address}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                    className="btn-s" style={{ textDecoration: 'none', fontSize: '.62rem', padding: '6px 10px', textAlign: 'center' }}>OPScan</a>
                  <a href={getTxUrl(tok.deployTxid)} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '.56rem', color: 'var(--c2)', textAlign: 'center' }}>Deploy TX</a>
                  {tok.publicMint && (
                    <button onClick={() => setFeatMintSym(featMintSym === tok.symbol ? null : tok.symbol)} style={{
                      padding: '8px 14px', borderRadius: '14px', fontSize: '.7rem', fontWeight: 800,
                      background: featMintSym === tok.symbol ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                      border: 'none', color: featMintSym === tok.symbol ? '#a855f7' : 'white',
                      cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '.02em',
                      boxShadow: featMintSym === tok.symbol ? 'none' : '0 2px 12px rgba(168,85,247,.3)',
                    }}>{featMintSym === tok.symbol ? 'Close' : '🪙 Mint'}</button>
                  )}
                </div>
              </div>
              {/* Featured mint panel */}
              {featMintSym === tok.symbol && tok.publicMint && (
                <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.15)', borderRadius: '14px' }}>
                  <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#a855f7', marginBottom: 6 }}>Public Mint — ${tok.symbol}</div>
                  <div style={{ fontSize: '.58rem', color: 'var(--t3)', marginBottom: 6 }}>Max per tx: {tok.maxMintPerTx ? (tok.maxMintPerTx / Math.pow(10, tok.decimals)).toLocaleString() : '1,000'} {tok.symbol}</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input style={{ ...inputStyle, width: '100%', paddingRight: 48 }} type="text" inputMode="decimal"
                        value={featMintAmt} onChange={e => { const v = e.target.value; const maxMint = tok.maxMintPerTx ? tok.maxMintPerTx / Math.pow(10, tok.decimals) : 1_000_000; if (v === '' || (Number(v) >= 0 && Number(v) <= maxMint)) setFeatMintAmt(v); }}
                        placeholder={`Amount (max ${tok.maxMintPerTx ? (tok.maxMintPerTx / Math.pow(10, tok.decimals)).toLocaleString() : '1,000'})`} />
                      <button onClick={() => setFeatMintAmt(String(tok.maxMintPerTx ? tok.maxMintPerTx / Math.pow(10, tok.decimals) : 1000))} style={{
                        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                        padding: '3px 6px', fontSize: '.52rem', fontWeight: 700, background: 'rgba(168,85,247,.15)',
                        border: 'none', borderRadius: 4, color: '#a855f7', cursor: 'pointer', fontFamily: 'var(--ff)',
                      }}>MAX</button>
                    </div>
                    {connected ? (
                      <button onClick={() => doFeaturedMint(tok)} disabled={featMinting} style={{
                        padding: '8px 16px', borderRadius: '14px', fontWeight: 700, fontSize: '.75rem',
                        background: 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none',
                        color: 'white', cursor: featMinting ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
                        opacity: featMinting ? 0.6 : 1, whiteSpace: 'nowrap',
                      }}>{featMinting ? 'Minting...' : 'Mint'}</button>
                    ) : (
                      <button onClick={openConnectModal} style={{
                        padding: '8px 16px', borderRadius: '14px', fontWeight: 700, fontSize: '.72rem',
                        background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none',
                        color: 'white', cursor: 'pointer', fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                      }}>Connect</button>
                    )}
                  </div>
                  {featMintResult && (
                    <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: '.68rem',
                      background: featMintResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                      border: `1px solid ${featMintResult.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.2)'}`,
                      color: featMintResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
                    }}>{featMintResult.msg}</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Pool card */}
          <div className="P" style={{ padding: 16, border: '1px solid rgba(168,85,247,.15)', background: 'rgba(168,85,247,.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.6rem' }}>🔄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '.9rem', color: 'var(--w)' }}>MINE/VIBE Liquidity Pool</div>
                <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginTop: 2 }}>SimplePool AMM · 0.3% fee · 5M MINE / 25M VIBE</div>
                <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', marginTop: 2, wordBreak: 'break-all' }}>
                  {'opt1sqqslqmts6wcchuh55f7hf6hurux2d4363cthz9p0'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User-deployed tokens */}
      {tab === 'user' && (
        <div>
          {tokens.length === 0 ? (
            <div className="P" style={{ padding: 30, textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>🪙</div>
              <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>No tokens deployed yet</div>
              <div style={{ fontSize: '.75rem', color: 'var(--t3)' }}>
                Deploy your first token from the <strong>Launcher</strong> tab. It will appear here automatically.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {tokens.map((tok, idx) => {
                const info = chainInfo[tok.address];
                const isConfirmed = info?.confirmed;
                const isMintOpen = mintAddr === tok.address;

                return (
                  <div key={tok.address || idx} className="P" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <img src={genLogo(tok.symbol)} alt={tok.symbol} style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, border: '2px solid rgba(255,255,255,.08)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: '.9rem', color: 'var(--w)' }}>{tok.name}</span>
                          <span style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.78rem' }}>${tok.symbol}</span>
                          {isConfirmed && <span style={{ fontSize: '.48rem', background: 'rgba(16,185,129,.06)', color: 'var(--g)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>}
                          {!isConfirmed && tok.address && <span style={{ fontSize: '.48rem', background: 'rgba(234,179,8,.1)', color: 'var(--y)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>PENDING</span>}
                          {tok.mode === 'mintable' && <span style={{ fontSize: '.48rem', background: 'rgba(168,85,247,.1)', color: '#a855f7', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>MINTABLE</span>}
                        </div>
                        <div style={{ fontSize: '.64rem', color: 'var(--t3)', marginTop: 3 }}>
                          Supply: {Number(tok.supply).toLocaleString()} · Decimals: {tok.decimals}
                          {tok.mode === 'mintable' && ` · Initial: ${tok.initialMintPct}% to deployer`}
                        </div>
                        {info?.totalSupply != null && info.totalSupply > 0n && (
                          <div style={{ fontSize: '.6rem', color: 'var(--g)', marginTop: 2 }}>
                            On-chain supply: {(Number(info.totalSupply) / Math.pow(10, tok.decimals)).toLocaleString()}
                          </div>
                        )}
                        {tok.address && (
                          <div style={{ fontFamily: 'var(--fm)', fontSize: '.5rem', color: 'var(--t4)', marginTop: 3, wordBreak: 'break-all' }}>{tok.address}</div>
                        )}
                        <div style={{ fontSize: '.52rem', color: 'var(--t4)', marginTop: 2 }}>
                          Deployed: {new Date(tok.deployedAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                        {tok.address && (
                          <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                            className="btn-s" style={{ textDecoration: 'none', fontSize: '.58rem', padding: '5px 8px', textAlign: 'center' }}>OPScan</a>
                        )}
                        {tok.txid && (
                          <a href={getTxUrl(tok.txid)} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '.54rem', color: 'var(--c2)', textAlign: 'center' }}>TX</a>
                        )}
                        {tok.publicMint && (
                          <button onClick={() => setMintAddr(isMintOpen ? null : tok.address)} style={{
                            padding: '5px 8px', borderRadius: '14px', fontSize: '.58rem', fontWeight: 700,
                            background: isMintOpen ? 'rgba(168,85,247,.15)' : 'rgba(168,85,247,.08)',
                            border: '1px solid rgba(168,85,247,.2)', color: '#a855f7', cursor: 'pointer', fontFamily: 'var(--ff)',
                          }}>{isMintOpen ? 'Close' : 'Mint'}</button>
                        )}
                        <button onClick={() => removeToken(tok.address)} style={{
                          padding: '3px 6px', borderRadius: 4, fontSize: '.48rem', fontWeight: 600,
                          background: 'none', border: '1px solid rgba(239,68,68,.2)', color: '#ef4444',
                          cursor: 'pointer', fontFamily: 'var(--ff)',
                        }}>Remove</button>
                      </div>
                    </div>

                    {/* Mint panel */}
                    {isMintOpen && tok.publicMint && (
                      <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.15)', borderRadius: '14px' }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#a855f7', marginBottom: 8 }}>Public Mint — ${tok.symbol}</div>
                        {tok.maxMintPerTx && tok.maxMintPerTx !== '0' && (
                          <div style={{ fontSize: '.6rem', color: 'var(--t3)', marginBottom: 6 }}>Max per tx: {Number(tok.maxMintPerTx).toLocaleString()}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input style={{ ...inputStyle, flex: 1 }} type="text" inputMode="decimal"
                            value={mintAmount} onChange={e => setMintAmount(e.target.value)}
                            placeholder={`Amount of ${tok.symbol} to mint`} />
                          {connected ? (
                            <button onClick={() => doMint(tok)} disabled={minting} style={{
                              padding: '8px 16px', borderRadius: '14px', fontWeight: 700, fontSize: '.75rem',
                              background: 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none',
                              color: 'white', cursor: minting ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
                              opacity: minting ? 0.6 : 1, whiteSpace: 'nowrap',
                            }}>{minting ? 'Minting...' : 'Mint'}</button>
                          ) : (
                            <button onClick={openConnectModal} style={{
                              padding: '8px 16px', borderRadius: '14px', fontWeight: 700, fontSize: '.72rem',
                              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none',
                              color: 'white', cursor: 'pointer', fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                            }}>Connect</button>
                          )}
                        </div>
                        {mintResult && (
                          <div style={{
                            padding: '8px 10px', borderRadius: 6, fontSize: '.68rem',
                            background: mintResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                            border: `1px solid ${mintResult.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.2)'}`,
                            color: mintResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
                          }}>{mintResult.msg}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mint History */}
      {mintHistory.length > 0 && (
        <div className="P" style={{ marginTop: 14, padding: 16 }}>
          <div className="Lb">Mint History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mintHistory.slice(0, 10).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: '.72rem' }}>
                <span style={{ fontSize: '.9rem', width: 22, textAlign: 'center' }}>🪙</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--w)' }}>
                    Minted {Number(tx.amountA || 0).toLocaleString()} {tx.tokenA}
                  </div>
                  <div style={{ fontSize: '.58rem', color: 'var(--t4)' }}>{formatTimeAgo(tx.ts)}</div>
                </div>
                {tx.txHash && (
                  <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.56rem', color: 'var(--c2)', textDecoration: 'none', whiteSpace: 'nowrap' }}>TX ↗</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info section */}
      <div className="P" style={{ marginTop: 14, padding: 16, fontSize: '.72rem', color: 'var(--t3)', lineHeight: 1.5 }}>
        <div className="Lb">About Tokens</div>
        <p>Tokens deployed via <strong>Token Launcher</strong> appear in "My Tokens" automatically. Featured tokens are pre-deployed by the OPNet Hub team.</p>
        <p style={{ marginTop: 6 }}>
          <strong>Mintable tokens</strong> with public mint enabled allow anyone to mint directly from this page using their OP_WALLET.
        </p>
        <div style={{ marginTop: 8, padding: '8px', background: 'rgba(14,165,233,.06)', borderRadius: '14px', border: '1px solid rgba(14,165,233,.15)', fontSize: '.62rem', color: 'var(--t3)' }}>
          {CURRENT_ENV !== 'mainnet' && <>Need {CURRENT_ENV} BTC? <a href={FAUCET} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>Get from faucet →</a></>}
        </div>
      </div>
    </div>
  );
};

export default TokenGallery;
