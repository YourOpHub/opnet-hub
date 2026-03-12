import React, { useState, useCallback, useEffect } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { useOps, type OpEntry } from '../contexts/OpsContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';
import { getTxUrl } from '../contracts';

const MARKET_LABELS: Record<string, { label: string; color: string }> = {
  fractalswap: { label: 'FractalSwap', color: '#8b5cf6' },
  p2p: { label: 'P2P Market', color: '#f59e0b' },
  mint: { label: 'Mint', color: '#22c55e' },
  swap: { label: 'Swap', color: '#3b82f6' },
  stake: { label: 'Staking', color: '#eab308' },
  liquidity: { label: 'Liquidity', color: '#06b6d4' },
  transfer: { label: 'Transfer', color: '#f97316' },
  split: { label: 'UTXO Split', color: '#a855f7' },
  deploy: { label: 'Deploy', color: '#ec4899' },
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active: { bg: 'rgba(59,130,246,.12)', color: '#3b82f6' },
  completed: { bg: 'rgba(34,197,94,.12)', color: '#22c55e' },
  failed: { bg: 'rgba(239,68,68,.12)', color: '#ef4444' },
};

const TX_TYPE_STYLES: Record<string, { label: string; color: string; icon: string }> = {
  swap: { label: 'Swap', color: '#3b82f6', icon: '\u21C4' },
  mint: { label: 'Mint', color: '#22c55e', icon: '\u2728' },
  claim: { label: 'Claim', color: '#eab308', icon: '\u{1F3C6}' },
};

const OpCard: React.FC<{ op: OpEntry; onDismiss?: () => void }> = ({ op, onDismiss }) => {
  const m = MARKET_LABELS[op.market] || { label: op.market, color: 'var(--t2)' };
  const s = STATUS_STYLES[op.status] ?? STATUS_STYLES['active'] ?? { bg: 'rgba(59,130,246,.12)', color: '#3b82f6' };
  const isActive = op.status === 'active';

  return (
    <div className="op-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            padding: '2px 6px', borderRadius: 4, fontSize: '.56rem', fontWeight: 700,
            background: m.color + '20', color: m.color, flexShrink: 0,
          }}>{m.label}</span>
          <span style={{ fontSize: '.68rem', color: 'var(--t3)', flexShrink: 0 }}>#{op.orderId}</span>
          {op.direction && (
            <span style={{ fontSize: '.58rem', color: 'var(--t3)', textTransform: 'uppercase' }}>{op.direction}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{
            padding: '2px 6px', borderRadius: 4, fontSize: '.54rem', fontWeight: 700,
            background: s.bg, color: s.color,
          }}>{op.status}</span>
          {!isActive && onDismiss && (
            <button onClick={onDismiss} aria-label="Dismiss operation" style={{
              background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer',
              fontSize: '.68rem', padding: '0 2px', lineHeight: 1,
            }}>{'\u2715'}</button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '.66rem' }}>
        {isActive && <span style={{ animation: 'spin 2s linear infinite', fontSize: '.72rem' }}>{'\u23F3'}</span>}
        <span style={{ color: isActive ? '#3b82f6' : 'var(--t3)', fontWeight: isActive ? 600 : 400 }}>
          {op.step || 'Processing...'}
        </span>
      </div>
      {op.error && (
        <div style={{ fontSize: '.6rem', color: '#ef4444', marginTop: 2 }}>{op.error}</div>
      )}
      <div style={{ fontSize: '.54rem', color: 'var(--t4)', marginTop: 2 }}>
        {op.role && <span style={{ marginRight: 6 }}>{op.role}</span>}
        {new Date(op.updatedAt).toLocaleTimeString()}
      </div>
    </div>
  );
};

const TxCard: React.FC<{ tx: TxRecord }> = ({ tx }) => {
  const t = TX_TYPE_STYLES[tx.type] || { label: tx.type, color: 'var(--t2)', icon: '\u{1F4CB}' };
  const desc = tx.type === 'swap'
    ? `${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA || ''} \u2192 ${Number(tx.amountB || 0).toLocaleString()} ${tx.tokenB || ''}`
    : `${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA || ''}`;

  return (
    <div className="op-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: '.82rem', flexShrink: 0 }}>{t.icon}</span>
          <span style={{
            padding: '2px 6px', borderRadius: 4, fontSize: '.56rem', fontWeight: 700,
            background: t.color + '20', color: t.color, flexShrink: 0,
          }}>{t.label}</span>
        </div>
        <span style={{ fontSize: '.54rem', color: 'var(--t4)', flexShrink: 0 }}>
          {formatTimeAgo(tx.ts)}
        </span>
      </div>
      <div style={{ fontSize: '.68rem', color: 'var(--w)', marginTop: 4, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
        {desc}
      </div>
      {tx.txHash && (
        <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '.58rem', color: 'var(--c2)', marginTop: 3, display: 'inline-block', textDecoration: 'none' }}>
          {tx.txHash.slice(0, 16)}... ↗
        </a>
      )}
    </div>
  );
};

type Tab = 'active' | 'history' | 'activity';

const OpsPanel: React.FC = () => {
  const { walletAddress } = useWalletConnect();
  const { activeOps, historyOps, activeCount, dismissOp } = useOps();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const closePanel = useCallback(() => setOpen(false), []);
  const trapRef = useFocusTrap(open, closePanel);

  // TX history from localStorage
  const [txHistory, setTxHistory] = useState<TxRecord[]>([]);
  useEffect(() => {
    if (open && walletAddress) {
      setTxHistory(getTxHistory(walletAddress));
    }
  }, [open, walletAddress]);

  // Auto-switch to active tab when new ops appear
  useEffect(() => {
    if (activeCount > 0 && tab !== 'active') setTab('active');
  }, [activeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalBadge = activeCount + txHistory.length;

  return (
    <>
      {/* FAB */}
      <button className="ops-fab" aria-label={`Activity${activeCount > 0 ? ` — ${activeCount} active` : ''}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span>{'\u{1F514}'}</span>
        {activeCount > 0 && <span className="ops-badge" aria-hidden="true">{activeCount}</span>}
        {activeCount === 0 && totalBadge > 0 && (
          <span className="ops-badge-dot" aria-hidden="true" />
        )}
      </button>

      {/* Overlay */}
      {open && <div className="ops-overlay" aria-hidden="true" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div ref={trapRef} className={`ops-panel ${open ? 'ops-open' : ''}`} role="dialog" aria-modal="true" aria-label="Activity dashboard" aria-hidden={!open}>
        <div className="qp-head">
          <div className="fw-700 fs-88">Activity</div>
          <button className="qp-close" aria-label="Close activity panel" onClick={() => setOpen(false)}>{'\u2715'}</button>
        </div>

        <div className="ops-filter-bar">
          <button
            className={`${tab === 'active' ? 'btn-p' : 'btn-s'} fs-68 p-5-12`}
            onClick={() => setTab('active')}>
            Active ({activeOps.length})
          </button>
          <button
            className={`${tab === 'history' ? 'btn-p' : 'btn-s'} fs-68 p-5-12`}
            onClick={() => setTab('history')}>
            Ops ({historyOps.length})
          </button>
          <button
            className={`${tab === 'activity' ? 'btn-p' : 'btn-s'} fs-68 p-5-12`}
            onClick={() => setTab('activity')}>
            TX Log ({txHistory.length})
          </button>
        </div>

        <div className="ops-list" role="list" aria-label="Activity entries">
          {tab === 'active' && (
            activeOps.length === 0 ? (
              <div className="ops-empty">
                No active operations
              </div>
            ) : (
              activeOps.map(op => <OpCard key={op.id} op={op} />)
            )
          )}
          {tab === 'history' && (
            historyOps.length === 0 ? (
              <div className="ops-empty">
                No completed operations yet
              </div>
            ) : (
              historyOps.map(op => (
                <OpCard key={op.id} op={op} onDismiss={() => dismissOp(op.id)} />
              ))
            )
          )}
          {tab === 'activity' && (
            !walletAddress ? (
              <div className="ops-empty">
                Connect wallet to see TX history
              </div>
            ) : txHistory.length === 0 ? (
              <div className="ops-empty">
                No transactions yet
              </div>
            ) : (
              txHistory.slice(0, 50).map(tx => <TxCard key={tx.id} tx={tx} />)
            )
          )}
        </div>
      </div>
    </>
  );
};

export default React.memo(OpsPanel);
