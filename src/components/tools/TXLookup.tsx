import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../../logger';
import * as opnet from '../../opnet';
import { cardS, inputS, btnS, rowS, labelS, valueS, monoSm } from './toolStyles';
import CopyBtn from './CopyBtn';

const TXLookup = React.memo(function TXLookup() {
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<Record<string, unknown> | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);

  // Load recent pending txs on mount
  useEffect(() => {
    opnet.getLatestPendingTxs(5).then(r => setPending(r)).catch((e) => { logger.warn('[TXLookup] Pending txs fetch error:', e); });
  }, []);

  const lookup = useCallback(async () => {
    const h = txHash.trim();
    if (!h) return;
    setErr(''); setTx(null); setReceipt(null); setLoading(true);
    try {
      // Try OPNet RPC first
      const [t, r] = await Promise.all([
        opnet.getTransaction(h),
        opnet.getTransactionReceipt(h),
      ]);
      if (t || r) {
        setTx(t);
        setReceipt(r);
      } else {
        // Not found in OPNet — might be a plain Bitcoin TX
        setErr(`Transaction not found in OPNet. This may be a regular Bitcoin TX. Check on a Bitcoin explorer.`);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, [txHash]);

  const renderObj = (obj: Record<string, unknown>, depth = 0): React.ReactNode => {
    if (depth > 3) return <span className="c-t4" style={{ ...monoSm }}>[nested]</span>;
    return Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => (
      <div key={k} style={{ ...rowS, paddingLeft: depth * 12 }}>
        <span style={labelS}>{k}</span>
        {typeof v === 'object' && !Array.isArray(v) ? (
          <div style={{ width: '60%' }}>{renderObj(v as Record<string, unknown>, depth + 1)}</div>
        ) : Array.isArray(v) ? (
          <span className="fs-60" style={{ ...valueS }}>[{v.length} items]</span>
        ) : (
          <span style={valueS}>
            {String(v).length > 40 ? String(v).slice(0, 20) + '...' + String(v).slice(-16) : String(v)}
            {String(v).length > 10 && <CopyBtn text={String(v)} />}
          </span>
        )}
      </div>
    ));
  };

  return (
    <div style={cardS} role="region" aria-label="Transaction lookup">
      <div className="d-flex gap-8 mb-10">
        <input style={{ ...inputS, flex: 1 }} aria-label="OPNet transaction hash" value={txHash} onChange={e => setTxHash(e.target.value)} placeholder="OPNet transaction hash" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Lookup'}</button>
      </div>
      {err && (
        <div role="alert" className="fs-72 mb-8 p-8-12 br-10 c-y" style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.12)' }}>
          {err}
          {txHash.trim().length === 64 && (
            <a href={`https://mempool.space/signet/tx/${txHash.trim()}`} target="_blank" rel="noopener noreferrer"
              className="d-block mt-4 c-c fs-65">
              Check on Mempool.space (Signet) ↗
            </a>
          )}
        </div>
      )}
      {tx && (
        <div>
          <div className="fs-68 c-o fw-700 mb-6">Transaction</div>
          {renderObj(tx)}
        </div>
      )}
      {receipt && (
        <div className="mt-10">
          <div className="fs-68 c-g fw-700 mb-6">Receipt</div>
          {renderObj(receipt)}
        </div>
      )}
      {/* Recent pending TXs from mempool */}
      {!tx && !receipt && !err && pending.length > 0 && (
        <div className="mt-10">
          <div className="fs-68 c-c fw-700 mb-6">Recent Pending TXs (Mempool)</div>
          {pending.map((p, i) => {
            const hash = String(p.hash ?? p.id ?? p.transactionId ?? '');
            return (
              <div key={i} style={{ ...rowS, cursor: 'pointer' }} onClick={() => { setTxHash(hash); }}>
                <span className="c-c flex-1" style={{ ...monoSm }}>{hash.slice(0, 20)}...{hash.slice(-8)}</span>
                <span className="c-t4 fs-55" style={{ ...monoSm }}>{p.from != null ? String(p.from).slice(0, 10) + '...' : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default TXLookup;
