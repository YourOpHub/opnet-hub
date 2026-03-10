import React, { useState, useEffect, useCallback } from 'react';
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
    opnet.getLatestPendingTxs(5).then(r => setPending(r)).catch(() => {});
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
    if (depth > 3) return <span style={{ ...monoSm, color: 'var(--t4)' }}>[nested]</span>;
    return Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => (
      <div key={k} style={{ ...rowS, paddingLeft: depth * 12 }}>
        <span style={labelS}>{k}</span>
        {typeof v === 'object' && !Array.isArray(v) ? (
          <div style={{ width: '60%' }}>{renderObj(v as Record<string, unknown>, depth + 1)}</div>
        ) : Array.isArray(v) ? (
          <span style={{ ...valueS, fontSize: '.6rem' }}>[{v.length} items]</span>
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
    <div style={cardS}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...inputS, flex: 1 }} value={txHash} onChange={e => setTxHash(e.target.value)} placeholder="OPNet transaction hash" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Lookup'}</button>
      </div>
      {err && (
        <div style={{ fontSize: '.72rem', marginBottom: 8, padding: '8px 12px', borderRadius: 10 , background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.12)', color: 'var(--y)' }}>
          {err}
          {txHash.trim().length === 64 && (
            <a href={`https://mempool.space/signet/tx/${txHash.trim()}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', marginTop: 4, color: 'var(--c)', fontSize: '.65rem' }}>
              Check on Mempool.space (Signet) ↗
            </a>
          )}
        </div>
      )}
      {tx && (
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--o)', fontWeight: 700, marginBottom: 6 }}>Transaction</div>
          {renderObj(tx)}
        </div>
      )}
      {receipt && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--g)', fontWeight: 700, marginBottom: 6 }}>Receipt</div>
          {renderObj(receipt)}
        </div>
      )}
      {/* Recent pending TXs from mempool */}
      {!tx && !receipt && !err && pending.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--c)', fontWeight: 700, marginBottom: 6 }}>Recent Pending TXs (Mempool)</div>
          {pending.map((p, i) => {
            const hash = String(p.hash || p.id || p.transactionId || '');
            return (
              <div key={i} style={{ ...rowS, cursor: 'pointer' }} onClick={() => { setTxHash(hash); }}>
                <span style={{ ...monoSm, color: 'var(--c)', flex: 1 }}>{hash.slice(0, 20)}...{hash.slice(-8)}</span>
                <span style={{ ...monoSm, color: 'var(--t4)', fontSize: '.55rem' }}>{p.from ? String(p.from).slice(0, 10) + '...' : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default TXLookup;
