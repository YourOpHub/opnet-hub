import React, { useState, useCallback } from 'react';
import { useOps, type OpEntry } from '../contexts/OpsContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

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

const OpsPanel: React.FC = () => {
  const { activeOps, historyOps, activeCount, dismissOp } = useOps();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const closePanel = useCallback(() => setOpen(false), []);
  const trapRef = useFocusTrap(open, closePanel);

  return (
    <>
      {/* FAB */}
      <button className="ops-fab" aria-label={`Operations panel${activeCount > 0 ? ` — ${activeCount} active` : ''}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span>{'\u{1F514}'}</span>
        {activeCount > 0 && <span className="ops-badge" aria-hidden="true">{activeCount}</span>}
      </button>

      {/* Overlay */}
      {open && <div className="ops-overlay" aria-hidden="true" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div ref={trapRef} className={`ops-panel ${open ? 'ops-open' : ''}`} role="dialog" aria-modal="true" aria-label="Operations panel" aria-hidden={!open}>
        <div className="qp-head">
          <div className="fw-700 fs-88">Operations</div>
          <button className="qp-close" aria-label="Close operations panel" onClick={() => setOpen(false)}>{'\u2715'}</button>
        </div>

        <div className="ops-filter-bar">
          <button
            className={`${!showHistory ? 'btn-p' : 'btn-s'} fs-68 p-5-12`}
            onClick={() => setShowHistory(false)}>
            Active ({activeOps.length})
          </button>
          <button
            className={`${showHistory ? 'btn-p' : 'btn-s'} fs-68 p-5-12`}
            onClick={() => setShowHistory(true)}>
            History ({historyOps.length})
          </button>
        </div>

        <div className="ops-list" role="list" aria-label="Operation entries">
          {!showHistory ? (
            activeOps.length === 0 ? (
              <div className="ops-empty">
                No active operations
              </div>
            ) : (
              activeOps.map(op => <OpCard key={op.id} op={op} />)
            )
          ) : (
            historyOps.length === 0 ? (
              <div className="ops-empty">
                No history yet
              </div>
            ) : (
              historyOps.map(op => (
                <OpCard key={op.id} op={op} onDismiss={() => dismissOp(op.id)} />
              ))
            )
          )}
        </div>
      </div>
    </>
  );
};

export default React.memo(OpsPanel);
