import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  type JSONRpcProvider, getContract, BitcoinUtils,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { MINTABLE_ABI } from '../abis';
import { getProvider } from '../contractCache';
import type { TxParams } from '../txUtils';
import { NETWORK, CURRENT_ENV } from '../config';
import * as opnet from '../opnet';
import { DEPLOYED_CONTRACTS, type ContractTokenInfo, getContractOpscanUrl, getTxUrl } from '../contracts';
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

/** Server response for token import */
interface ImportTokenResponse {
  ok?: boolean;
  error?: string;
  existed?: boolean;
  token?: { symbol: string; name: string };
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
  const pair = cs[s.charCodeAt(0) % cs.length] ?? ['#F7931A', '#e8850f'];
  const [c1, c2] = pair;
  const svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g${s})"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g${s}" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
    } catch (e) { logger.warn('[TokenGallery] Failed to fetch all tokens:', e); }
    setAllLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'all') void loadAllTokens();
  }, [tab, loadAllTokens]);

  const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
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
      const data = (await res.json()) as ImportTokenResponse;
      if (!res.ok || data.ok !== true) {
        setImportResult({ ok: false, msg: data.error ?? 'Token not found or not OP-20' });
      } else {
        setImportResult({ ok: true, msg: `${data.existed === true ? 'Already indexed' : 'Added'}: ${data.token?.symbol ?? '?'} (${data.token?.name ?? '?'})` });
        setImportAddr('');
        void loadAllTokens();
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

  const sortIcon = (field: typeof sortField): string => sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

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
    } catch (e) { logger.warn('[TokenGallery] Failed to load deployed tokens from localStorage:', e); }
  }, []);

  // Check on-chain status for user tokens
  useEffect(() => {
    if (tokens.length === 0) return;
    const ac = new AbortController();
    const prevNet = opnet.getNetwork();
    opnet.setNetwork(CURRENT_ENV);
    tokens.forEach(t => {
      if (!t.address) return;
      opnet.getTokenTotalSupply(t.address).then(supply => {
        if (!ac.signal.aborted) setChainInfo(prev => ({ ...prev, [t.address]: { totalSupply: supply, confirmed: supply > 0n } }));
      }).catch((e) => { logger.warn('[TokenGallery] Token supply fetch error:', e); });
    });
    return () => { ac.abort(); opnet.setNetwork(prevNet); };
  }, [tokens]);

  // Featured tokens (our pre-deployed MINE and VIBE)
  const featured = (Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]).map(([_sym, tok]) => ({
    address: tok.address,
    symbol: tok.symbol,
    name: tok.name,
    icon: tok.icon,
    iconImg: tok.iconImg,
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
      if (!walletAddress) throw new Error('Wallet not connected');
      const txParams = await buildTxParams(provider, walletAddress);
      const fmOpId = `mint_${tok.symbol}_${Date.now()}`;
      trackOp({ id: fmOpId, market: 'mint', orderId: tok.symbol, direction: '', role: '', step: `Minting ${amt.toLocaleString()} ${tok.symbol}...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      completeOp(fmOpId);
      const txHash = receipt.transactionId || '';
      setFeatMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${tok.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: tok.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress });
      setHistRefresh(k => k + 1);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = `No BTC UTXOs.${CURRENT_ENV !== 'mainnet' ? ` Get ${CURRENT_ENV} BTC: ${FAUCET}` : ''}`;
      setFeatMintResult({ ok: false, msg });
    } finally { setFeatMinting(false); }
  }, [walletAddress, walletInstance, featMintAmt, openConnectModal, provider, senderAddr, trackOp, completeOp]);

  const removeToken = (addr: string): void => {
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

      if (!walletAddress) throw new Error('Wallet not connected');
      const txParams = await buildTxParams(provider, walletAddress);
      const umOpId = `mint_${token.symbol}_${Date.now()}`;
      trackOp({ id: umOpId, market: 'mint', orderId: token.symbol, direction: '', role: '', step: `Minting ${amt.toLocaleString()} ${token.symbol}...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      completeOp(umOpId);

      const txHash = receipt.transactionId || '';
      setMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${token.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: token.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress });
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
  }, [walletAddress, walletInstance, mintAmount, openConnectModal, provider, senderAddr, trackOp, completeOp]);

  const connected = !!walletAddress;
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: '14px',
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div>
      <div className="Pg mb-14 text-center p-24-18">
        <div className="fs-110 fw-800 c-w mb-3">🪙 Tokens</div>
        <div className="c-t3 fs-80 m-auto max-w-480">
          OPNet {CURRENT_ENV} tokens. Mint directly from your wallet — max 1,000 per transaction.
        </div>
      </div>

      {/* Tab switcher */}
      <div className="d-flex gap-6 mb-14">
        {([['all', `All Tokens (${allTokens.length})`], ['featured', 'Featured'], ['user', `My (${tokens.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="flex-1 br-14 fs-78 fw-700 pointer ff-ui" style={{ padding: '10px', background: tab === id ? 'rgba(247,147,26,.08)' : 'var(--bg3)', border: `1px solid ${tab === id ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`, color: tab === id ? 'var(--o)' : 'var(--t2)' }}>{label}</button>
        ))}
      </div>

      {/* All Tokens from Indexer */}
      {tab === 'all' && (
        <div>
          {/* Search + Sort row */}
          <div className="d-flex gap-6 mb-8 flex-wrap">
            <input className="flex-1 min-w-140" style={{ ...inputStyle }} type="text" value={allSearch}
              onChange={e => setAllSearch(e.target.value)} placeholder="Search name, symbol, address..."
              aria-label="Search tokens by name, symbol, or address" />
            <button onClick={loadAllTokens} disabled={allLoading} aria-label="Refresh token list" className="br-14 fs-70 fw-700 c-t2 ff-ui p-8-12 bg-bg3 bd-bd" style={{ cursor: allLoading ? 'not-allowed' : 'pointer' }}>{allLoading ? '...' : '↻'}</button>
          </div>

          {/* Sort chips + filter */}
          <div className="d-flex gap-4 mb-10 flex-wrap ai-center">
            <span className="fs-58 c-t4 fw-600 mr-2">Sort:</span>
            {([['block', 'Block'], ['symbol', 'A\u2194Z'], ['supply', 'Supply'], ['holders', 'Holders']] as const).map(([id, label]) => (
              <button key={id} onClick={() => toggleSort(id)} className="br-20 fs-60 fw-700 pointer ff-ui" style={{ padding: '4px 10px', background: sortField === id ? 'rgba(247,147,26,.12)' : 'transparent', border: `1px solid ${sortField === id ? 'rgba(247,147,26,.3)' : 'rgba(255,255,255,.06)'}`, color: sortField === id ? 'var(--o)' : 'var(--t3)', transition: 'all .15s' }}>{label}{sortIcon(id)}</button>
            ))}
            <span className="sep-v" />
            <button onClick={() => setFilterMintable(v => !v)} aria-pressed={filterMintable} aria-label="Filter mintable tokens" className="br-20 fs-60 fw-700 pointer ff-ui" style={{ padding: '4px 10px', background: filterMintable ? 'rgba(168,85,247,.15)' : 'transparent', border: `1px solid ${filterMintable ? 'rgba(168,85,247,.3)' : 'rgba(255,255,255,.06)'}`, color: filterMintable ? '#a855f7' : 'var(--t3)', transition: 'all .15s' }}>Mintable{filterMintable ? ' \u2713' : ''}</button>
            <span className="ml-auto fs-58 c-t4 text-mono">
              {sortedFiltered.length.toLocaleString()} tokens
            </span>
          </div>

          {/* Manual import (collapsible) */}
          <details className="mb-10">
            <summary className="fs-68 fw-700 c-t3 pointer p-6-0">
              + Import token by address
            </summary>
            <div className="P p-12 mt-4">
              <div className="d-flex gap-6">
                <input className="flex-1 fs-72" style={{ ...inputStyle }} type="text" value={importAddr}
                  onChange={e => setImportAddr(e.target.value)} placeholder="0x... or opt1sq..."
                  aria-label="Token contract address to import" />
                <button onClick={doImportToken} disabled={importing} className="br-14 fs-68 fw-700 c-white ff-ui ws-nowrap p-8-14 btn-blue" style={{ cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.6 : 1 }}>{importing ? '...' : 'Import'}</button>
              </div>
              {importResult && (
                <div className={`mt-6 br-6 fs-62 p-6-8 ${importResult.ok ? 'bg-ok c-g' : 'bg-err c-red'}`} role="alert">{importResult.msg}</div>
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
            <div className="br-14 ov-hidden bd bg-card" role="table" aria-label="Token list">
              {/* Table header — clickable for sorting */}
              <div className="d-grid gap-4 fs-56 c-t4 text-upper ls-06 fw-700 user-select-none p-7-10" role="row" style={{ gridTemplateColumns: '36px 1fr 70px 80px 50px 50px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(8,8,16,.5)' }}>
                <span className="text-center">#</span>
                <span onClick={() => toggleSort('symbol')} className="pointer" style={{ color: sortField === 'symbol' ? 'var(--o)' : undefined }}>
                  Token{sortIcon('symbol')}
                </span>
                <span className="text-right">Symbol</span>
                <span onClick={() => toggleSort('supply')} className="text-right pointer" style={{ color: sortField === 'supply' ? 'var(--o)' : undefined }}>
                  Supply{sortIcon('supply')}
                </span>
                <span onClick={() => toggleSort('holders')} className="text-right pointer" style={{ color: sortField === 'holders' ? 'var(--o)' : undefined }}>
                  Holders{sortIcon('holders')}
                </span>
                <span onClick={() => toggleSort('block')} className="text-right pointer" style={{ color: sortField === 'block' ? 'var(--o)' : undefined }}>
                  Block{sortIcon('block')}
                </span>
              </div>
              {/* Rows */}
              <div>
                {pagedTokens.map((tok, i) => (
                  <a key={tok.pubkey || tok.address} href={getContractOpscanUrl(tok.pubkey || tok.address)} target="_blank" rel="noopener noreferrer"
                    className="d-grid gap-4 ai-center no-decoration p-7-10" style={{ gridTemplateColumns: '36px 1fr 70px 80px 50px 50px', borderBottom: '1px solid rgba(255,255,255,.03)', color: 'inherit', transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span className="text-center fs-55 c-t4 text-mono">
                      {page * PAGE_SIZE + i + 1}
                    </span>
                    <div className="d-flex ai-center gap-8 min-w-0">
                      <img src={genLogo(tok.symbol)} alt={tok.symbol} className="w-28 h-28 br-50 flex-shrink-0 bd-w6" />
                      <div className="min-w-0">
                        <div className="fw-700 fs-72 c-w ov-hidden text-ellipsis ws-nowrap">{tok.name}</div>
                        <div className="text-mono fs-46 c-t4 ov-hidden text-ellipsis ws-nowrap">
                          {(tok.pubkey || tok.address).slice(0, 20)}...
                        </div>
                      </div>
                    </div>
                    <div className="text-right d-flex ai-center jc-end gap-4">
                      <span className="fw-700 fs-68 c-o text-mono">{tok.symbol}</span>
                      {tok.mintable === 1 && (
                        <span className="fs-40 c-purple br-3 fw-700 lh-14 ws-nowrap tag-mint">MINT</span>
                      )}
                    </div>
                    <div className="text-right fs-62 c-t2 text-mono">
                      {tok.total_supply && tok.total_supply !== '0' ? formatTokenBalance(tok.total_supply, tok.decimals) : '—'}
                    </div>
                    <div className="text-right fs-58 text-mono" style={{ color: (tok.holder_count || 0) > 0 ? 'var(--t2)' : 'var(--t4)' }}>
                      {(tok.holder_count || 0) > 0 ? tok.holder_count?.toLocaleString() ?? '—' : '—'}
                    </div>
                    <div className="text-right fs-58 c-t4 text-mono">
                      {tok.deploy_block > 0 ? `#${tok.deploy_block}` : '—'}
                    </div>
                  </a>
                ))}
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="d-flex ai-center jc-center gap-6 p-10" style={{ borderTop: '1px solid rgba(255,255,255,.06)', background: 'rgba(8,8,16,.3)' }}>
                  <button onClick={() => setPage(0)} disabled={page === 0} aria-label="First page" className="br-6 fs-58 fw-700 ff-ui p-4-8 bg-none bd-bd" style={{ color: page === 0 ? 'var(--t4)' : 'var(--t2)', cursor: page === 0 ? 'default' : 'pointer' }}>{'<<'}</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page" className="br-6 fs-58 fw-700 ff-ui p-4-10 bg-none bd-bd" style={{ color: page === 0 ? 'var(--t4)' : 'var(--t2)', cursor: page === 0 ? 'default' : 'pointer' }}>{'<'}</button>
                  <span className="fs-62 c-t2 text-mono text-center min-w-80">
                    {page + 1} / {totalPages}
                  </span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label="Next page" className="br-6 fs-58 fw-700 ff-ui p-4-10 bg-none bd-bd" style={{ color: page >= totalPages - 1 ? 'var(--t4)' : 'var(--t2)', cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>{'>'}</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} aria-label="Last page" className="br-6 fs-58 fw-700 ff-ui p-4-8 bg-none bd-bd" style={{ color: page >= totalPages - 1 ? 'var(--t4)' : 'var(--t2)', cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>{'>>'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Featured tokens */}
      {tab === 'featured' && (
        <div className="d-grid gap-10">
          {featured.map(tok => (
            <div key={tok.symbol} className="P p-16">
              <div className="d-flex ai-center gap-12">
                {tok.iconImg
                  ? <img src={tok.iconImg} alt={tok.symbol} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <span className="fs-180">{tok.icon}</span>
                }
                <div className="flex-1">
                  <div className="d-flex ai-center gap-6">
                    <span className="fw-800 fs-95 c-w">{tok.name}</span>
                    <span className="text-mono c-o fw-600 fs-78">${tok.symbol}</span>
                    <span className="fs-48 c-g br-3 fw-700 tag-onchain">ON-CHAIN</span>
                  </div>
                  <div className="fs-68 c-t3 mt-2">{tok.description}</div>
                  <div className="fs-62 c-t4 mt-4">
                    Supply: {tok.supply} · Decimals: {tok.decimals}
                  </div>
                  <div className="text-mono fs-52 c-t4 mt-2 word-break">{tok.address}</div>
                </div>
                <div className="d-flex flex-col-dir gap-4 flex-shrink-0">
                  <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                    className="btn-s no-decoration fs-62 text-center p-6-10">OPScan</a>
                  <a href={getTxUrl(tok.deployTxid)} target="_blank" rel="noopener noreferrer"
                    className="fs-56 c-c2 text-center">Deploy TX</a>
                  {tok.publicMint && (
                    <button onClick={() => setFeatMintSym(featMintSym === tok.symbol ? null : tok.symbol)} className="br-14 fs-70 fw-800 pointer ff-ui ls-02 p-8-14 no-border" style={{ background: featMintSym === tok.symbol ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg, #a855f7, #7c3aed)', color: featMintSym === tok.symbol ? '#a855f7' : 'white', boxShadow: featMintSym === tok.symbol ? 'none' : '0 2px 12px rgba(168,85,247,.3)' }}>{featMintSym === tok.symbol ? 'Close' : '🪙 Mint'}</button>
                  )}
                </div>
              </div>
              {/* Featured mint panel */}
              {featMintSym === tok.symbol && tok.publicMint && (
                <div className="mt-12 p-12 br-14 bg-purple">
                  <div className="fs-70 fw-700 c-purple mb-6">Public Mint — ${tok.symbol}</div>
                  <div className="fs-58 c-t3 mb-6">Max per tx: {tok.maxMintPerTx ? (tok.maxMintPerTx / Math.pow(10, tok.decimals)).toLocaleString() : '1,000'} {tok.symbol}</div>
                  <div className="d-flex gap-6 mb-8">
                    <div className="flex-1 pos-relative">
                      <input className="w-full" style={{ ...inputStyle, paddingRight: 48 }} type="text" inputMode="decimal"
                        value={featMintAmt} onChange={e => { const v = e.target.value; const maxMint = tok.maxMintPerTx ? tok.maxMintPerTx / Math.pow(10, tok.decimals) : 1_000_000; if (v === '' || (Number(v) >= 0 && Number(v) <= maxMint)) setFeatMintAmt(v); }}
                        placeholder={`Amount (max ${tok.maxMintPerTx ? (tok.maxMintPerTx / Math.pow(10, tok.decimals)).toLocaleString() : '1,000'})`}
                        aria-label={`Amount of ${tok.symbol} to mint`} />
                      <button onClick={() => setFeatMintAmt(String(tok.maxMintPerTx ? tok.maxMintPerTx / Math.pow(10, tok.decimals) : 1000))} aria-label={`Use maximum ${tok.symbol} mint amount`} className="abs-right-vc fs-52 fw-700 br-4 c-purple pointer ff-ui p-3-6 bg-purple no-border">MAX</button>
                    </div>
                    {connected ? (
                      <button onClick={() => doFeaturedMint(tok)} disabled={featMinting} className="br-14 fw-700 fs-75 c-white ff-ui ws-nowrap p-8-14 btn-purple" style={{ cursor: featMinting ? 'not-allowed' : 'pointer', opacity: featMinting ? 0.6 : 1 }}>{featMinting ? 'Minting...' : 'Mint'}</button>
                    ) : (
                      <button onClick={openConnectModal} className="br-14 fw-700 fs-72 c-white pointer ff-ui ws-nowrap p-8-14 btn-blue">Connect</button>
                    )}
                  </div>
                  {featMintResult && (
                    <div className={`br-6 fs-68 word-break p-8-10 ${featMintResult.ok ? 'bg-ok c-g' : 'bg-err c-red'}`} role="alert">{featMintResult.msg}</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Pool card */}
          <div className="P p-16" style={{ border: '1px solid rgba(168,85,247,.15)', background: 'rgba(168,85,247,.03)' }}>
            <div className="d-flex ai-center gap-10">
              <span className="fs-160">🔄</span>
              <div className="flex-1">
                <div className="fw-800 fs-90 c-w">MINE/VIBE Liquidity Pool</div>
                <div className="fs-65 c-t3 mt-2">SimplePool AMM · 0.3% fee · 500K MINE / 25M VIBE</div>
                <div className="text-mono fs-52 c-t4 mt-2 word-break">
                  {'opt1sqrfwvy6ekprrx9h5nwem9d07nufuzqhxg5zg6ar2'}
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
            <div className="P p-30 text-center">
              <div className="fs-200 mb-8">🪙</div>
              <div className="fw-700 c-t2 mb-4">No tokens deployed yet</div>
              <div className="fs-75 c-t3">
                Deploy your first token from the <strong>Launcher</strong> tab. It will appear here automatically.
              </div>
            </div>
          ) : (
            <div className="d-grid gap-10">
              {tokens.map((tok, idx) => {
                const info = chainInfo[tok.address];
                const isConfirmed = info?.confirmed;
                const isMintOpen = mintAddr === tok.address;

                return (
                  <div key={tok.address || idx} className="P p-16">
                    <div className="d-flex ai-start gap-12">
                      <img src={genLogo(tok.symbol)} alt={`${tok.symbol} token logo`} className="w-48 h-48 br-50 flex-shrink-0 bd-w8" />
                      <div className="flex-1 min-w-0">
                        <div className="d-flex ai-center gap-6 flex-wrap">
                          <span className="fw-800 fs-90 c-w">{tok.name}</span>
                          <span className="text-mono c-o fw-600 fs-78">${tok.symbol}</span>
                          {isConfirmed && <span className="fs-48 c-g br-3 fw-700 tag-onchain">ON-CHAIN</span>}
                          {!isConfirmed && tok.address && <span className="fs-48 c-y br-3 fw-700 tag-pending">PENDING</span>}
                          {tok.mode === 'mintable' && <span className="fs-48 c-purple br-3 fw-700 tag-mintable">MINTABLE</span>}
                        </div>
                        <div className="fs-64 c-t3 mt-3">
                          Supply: {Number(tok.supply).toLocaleString()} · Decimals: {tok.decimals}
                          {tok.mode === 'mintable' && ` · Initial: ${tok.initialMintPct}% to deployer`}
                        </div>
                        {info?.totalSupply != null && info.totalSupply > 0n && (
                          <div className="fs-60 c-g mt-2">
                            On-chain supply: {(Number(info.totalSupply) / Math.pow(10, tok.decimals)).toLocaleString()}
                          </div>
                        )}
                        {tok.address && (
                          <div className="text-mono fs-50 c-t4 mt-3 word-break">{tok.address}</div>
                        )}
                        <div className="fs-52 c-t4 mt-2">
                          Deployed: {new Date(tok.deployedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="d-flex flex-col-dir gap-4 flex-shrink-0">
                        {tok.address && (
                          <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                            className="btn-s no-decoration fs-58 text-center p-5-8">OPScan</a>
                        )}
                        {tok.txid && (
                          <a href={getTxUrl(tok.txid)} target="_blank" rel="noopener noreferrer"
                            className="fs-54 c-c2 text-center">TX</a>
                        )}
                        {tok.publicMint && (
                          <button onClick={() => setMintAddr(isMintOpen ? null : tok.address)} className="br-14 fs-58 fw-700 c-purple pointer ff-ui" style={{ padding: '5px 8px', background: isMintOpen ? 'rgba(168,85,247,.15)' : 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.2)' }}>{isMintOpen ? 'Close' : 'Mint'}</button>
                        )}
                        <button onClick={() => removeToken(tok.address)} className="br-4 fs-48 fw-600 c-red pointer ff-ui p-3-6 btn-ghost-red">Remove</button>
                      </div>
                    </div>

                    {/* Mint panel */}
                    {isMintOpen && tok.publicMint && (
                      <div className="mt-12 p-12 br-14 bg-purple">
                        <div className="fs-70 fw-700 c-purple mb-8">Public Mint — ${tok.symbol}</div>
                        {tok.maxMintPerTx && tok.maxMintPerTx !== '0' && (
                          <div className="fs-60 c-t3 mb-6">Max per tx: {Number(tok.maxMintPerTx).toLocaleString()}</div>
                        )}
                        <div className="d-flex gap-8 mb-8">
                          <input className="flex-1" style={{ ...inputStyle }} type="text" inputMode="decimal"
                            value={mintAmount} onChange={e => setMintAmount(e.target.value)}
                            placeholder={`Amount of ${tok.symbol} to mint`}
                            aria-label={`Amount of ${tok.symbol} to mint`} />
                          {connected ? (
                            <button onClick={() => doMint(tok)} disabled={minting} className="br-14 fw-700 fs-75 c-white ff-ui ws-nowrap p-8-14 btn-purple" style={{ cursor: minting ? 'not-allowed' : 'pointer', opacity: minting ? 0.6 : 1 }}>{minting ? 'Minting...' : 'Mint'}</button>
                          ) : (
                            <button onClick={openConnectModal} className="br-14 fw-700 fs-72 c-white pointer ff-ui ws-nowrap p-8-14 btn-blue">Connect</button>
                          )}
                        </div>
                        {mintResult && (
                          <div className={`br-6 fs-68 word-break p-8-10 ${mintResult.ok ? 'bg-ok c-g' : 'bg-err c-red'}`} role="alert">{mintResult.msg}</div>
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
        <div className="P mt-14 p-16">
          <div className="Lb">Mint History</div>
          <div className="d-flex flex-col-dir gap-6">
            {mintHistory.slice(0, 10).map(tx => (
              <div key={tx.id} className="d-flex ai-center gap-8 br-8 fs-72 p-8-10 bg-bg3">
                <span className="fs-90 text-center w-22">🪙</span>
                <div className="flex-1 min-w-0">
                  <div className="fw-700 c-w">
                    Minted {Number(tx.amountA || 0).toLocaleString()} {tx.tokenA}
                  </div>
                  <div className="fs-58 c-t4">{formatTimeAgo(tx.ts)}</div>
                </div>
                {tx.txHash && (
                  <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" className="fs-56 c-c2 no-decoration ws-nowrap">TX ↗</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info section */}
      <div className="P mt-14 p-16 fs-72 c-t3 lh-15">
        <div className="Lb">About Tokens</div>
        <p>Tokens deployed via <strong>Token Launcher</strong> appear in "My Tokens" automatically. Featured tokens are pre-deployed by the OPNet Hub team.</p>
        <p className="mt-6">
          <strong>Mintable tokens</strong> with public mint enabled allow anyone to mint directly from this page using their OP_WALLET.
        </p>
        <div className="mt-8 br-14 fs-62 c-t3 p-8 bg-info-b">
          {CURRENT_ENV !== 'mainnet' && <>Need {CURRENT_ENV} BTC? <a href={FAUCET} target="_blank" rel="noopener noreferrer" className="c-c2">Get from faucet →</a></>}
        </div>
      </div>
    </div>
  );
};

export default TokenGallery;
