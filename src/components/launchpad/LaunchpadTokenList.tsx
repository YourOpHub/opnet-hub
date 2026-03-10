import React, { useState, useCallback, useMemo } from 'react';
import { logger } from '../../logger';
import { getContract, type CallResult, type IOP20Contract } from 'opnet';
import { LAUNCHPAD_ABI } from '../../abis';
import { getProvider } from '../../contractCache';
import { NETWORK } from '../../config';
import type { LaunchToken } from '../../launchpad/types';
import { getProgress, isGraduated, hashColor, genLogo, GRADUATION_PCT } from '../../launchpad/types';
import { addToken } from '../../launchpad/store';
import { registerToken } from '../../launchpad/api';

type SortMode = 'hot1h' | 'hot8h' | 'hot24h' | 'newest' | 'holders';

/* ── Token list item ── */
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
      <img src={imgSrc} alt={`${token.symbol} logo`} className="w-40 h-40 br-50 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex-between">
          <span className="fw-700 fs-88 c-w truncate">{token.symbol}</span>
          <div className="flex-center gap-4">
            {isPending && <span className="c-y fw-700 fs-50">PENDING</span>}
            {!isPending && isReal && <span className="w-6 h-6 br-50 flex-shrink-0" style={{ background: 'var(--g)' }} />}
            {grad && <span className="c-g fw-700 fs-50">GRAD</span>}
          </div>
        </div>
        <div className="fs-sm c-t4 truncate">{token.name}</div>
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

export interface LaunchpadTokenListProps {
  tokens: LaunchToken[];
  selected: LaunchToken | null;
  onSelect: (token: LaunchToken) => void;
  onTokensChange: (tokens: LaunchToken[]) => void;
  onDeployOpen: () => void;
  onMintStep: (msg: string) => void;
  useServer: boolean;
}

const LaunchpadTokenList: React.FC<LaunchpadTokenListProps> = ({
  tokens, selected, onSelect, onTokensChange, onDeployOpen, onMintStep, useServer,
}) => {
  const provider = useMemo(() => getProvider(), []);

  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('hot24h');
  const [addAddr, setAddAddr] = useState('');
  const [adding, setAdding] = useState(false);

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

  // Add contract by address
  const handleAddContract = useCallback(async () => {
    if (!addAddr.trim()) return;
    const addr = addAddr.trim();
    const existing = tokens.find(t => t.address === addr);
    if (existing) {
      onSelect(existing);
      setAddAddr('');
      return;
    }
    setAdding(true);
    try {
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
      onTokensChange(updated);
      onSelect(token);
      setAddAddr('');
      if (useServer) registerToken(token).catch((e) => { logger.warn('[LaunchpadTokenList] registerToken error:', e); });
    } catch (e) {
      onMintStep(e instanceof Error ? e.message : 'Invalid contract');
      setTimeout(() => onMintStep(''), 3000);
    } finally {
      setAdding(false);
    }
  }, [addAddr, tokens, provider, useServer, onSelect, onTokensChange, onMintStep]);

  return (
    <div className="lp-sidebar">
      <div className="p-14-14-10 bd-b-bd">
        <div className="d-flex jc-between ai-center mb-10">
          <span className="fw-800 fs-100 c-w">Contracts</span>
          <span className="fs-66 c-t4 text-mono br-6 p-2-8" style={{ background: 'rgba(255,255,255,.05)' }}>{tokens.length}</span>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or address..."
          aria-label="Search contracts by name or address"
          className="w-full br-12 c-w fs-82 ff-ui outline-none mb-8 p-10-14 bg-bg3 bd-bd box-border" />
        <div className="d-flex gap-4" role="tablist" aria-label="Sort mode">
          {([['hot1h', '1H Hot'], ['hot8h', '8H Hot'], ['hot24h', '24H Hot'], ['newest', 'Newest'], ['holders', 'Holders']] as [SortMode, string][]).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={sortMode === m} onClick={() => setSortMode(m)}
              className="flex-1 br-8 fs-66 pointer ff-ui fw-700" style={{ padding: '6px 2px', border: '1px solid ' + (sortMode === m ? 'rgba(247,147,26,.5)' : 'var(--bd)'), background: sortMode === m ? 'rgba(247,147,26,.15)' : 'rgba(255,255,255,.03)', color: sortMode === m ? 'var(--o)' : 'var(--t3)', transition: 'all .15s' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Token list */}
      <div className="lp-sidebar-list" role="list" aria-label="Token contracts">
        {filtered.map(t => (
          <TokenListItem key={t.address} token={t} active={selected?.address === t.address} onClick={() => onSelect(t)} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center c-t4 p-20 fs-70">No contracts found</div>
        )}
      </div>

      {/* Add contract */}
      <div className="p-8-10 bd-t-bd">
        <div className="d-flex gap-4 mb-6">
          <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="opt1sq... address"
            aria-label="Add contract by address"
            onKeyDown={e => e.key === 'Enter' && handleAddContract()}
            className="flex-1 br-8 c-w fs-60 text-mono outline-none p-6-8 bg-bg3 bd-bd" />
          <button onClick={handleAddContract} disabled={adding} aria-label="Add contract"
            className="br-8 c-o fs-60 pointer ff-ui fw-700 p-6-10" style={{ background: 'rgba(247,147,26,.15)', border: '1px solid rgba(247,147,26,.3)' }}>
            {adding ? '...' : '+'}
          </button>
        </div>
        <button onClick={onDeployOpen} className="lbtn w-full fs-70 p-8">
          Deploy New Contract
        </button>
      </div>
    </div>
  );
};

export default React.memo(LaunchpadTokenList);
