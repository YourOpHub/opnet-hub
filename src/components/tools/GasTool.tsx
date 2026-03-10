import React, { useState, useEffect, useCallback } from 'react';
import * as opnet from '../../opnet';
import { cardS, rowS, labelS, valueS, monoSm, copyBtnS, parseHex } from './toolStyles';

const GasTool = React.memo(function GasTool() {
  const [network, setNetwork] = useState<opnet.Network>(opnet.getNetwork());
  const [gas, setGas] = useState<opnet.GasParams | null>(null);
  const [mempool, setMempool] = useState<{ count?: number; opnetCount?: number; sizeBytes?: number } | null>(null);
  const [pendingTxs, setPendingTxs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const prev = opnet.getNetwork();
    opnet.setNetwork(network);
    return () => { opnet.setNetwork(prev); };
  }, [network]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, m, pt] = await Promise.all([
        opnet.getGasParameters(),
        opnet.getMempoolInfo().catch(() => null),
        opnet.getLatestPendingTxs(10).catch(() => []),
      ]);
      setGas(g || null);
      setMempool(m || null);
      if (Array.isArray(pt)) setPendingTxs(pt.slice(0, 10));
    } catch (e) { console.warn('[TokenTools] Failed to fetch gas/mempool data:', e); setGas(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 15000); return () => clearInterval(iv); }, [network, refresh]);

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['regtest', 'testnet', 'mainnet'] as const).map(n => (
            <button key={n} className={`fbn ${network === n ? 'on' : ''}`} style={{ padding: '4px 12px', fontSize: '.65rem' }} onClick={() => setNetwork(n)}>{n}</button>
          ))}
        </div>
        <button onClick={refresh} style={{ ...copyBtnS, padding: '4px 10px' }}>{loading ? '⏳' : '🔄'}</button>
      </div>
      {gas ? (
        <div>
          {[
            ['Block Height', gas.blockNumber ? parseHex(gas.blockNumber) : '—', 'var(--o)'],
            ['Base Gas', gas.baseGas ? parseHex(gas.baseGas) : '—', 'var(--c)'],
            ['Gas/Sat', gas.gasPerSat ? parseHex(gas.gasPerSat) : '—', 'var(--p)'],
            ['Conservative Fee', `${gas.bitcoin?.conservative ?? '—'} sat/vB`, '#fff'],
          ].map(([k, v, c]) => (
            <div key={k} style={rowS}><span style={labelS}>{k}</span><span style={{ ...valueS, color: c as string }}>{v}</span></div>
          ))}
          {gas.bitcoin?.recommended && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              {[
                ['Low', gas.bitcoin.recommended.low, 'var(--g)'],
                ['Medium', gas.bitcoin.recommended.medium, 'var(--o)'],
                ['High', gas.bitcoin.recommended.high, 'var(--r)'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: 'center', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 10 }}>
                  <div style={{ ...monoSm, fontWeight: 700, color: c as string }}>{v}</div>
                  <div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>{l} sat/vB</div>
                </div>
              ))}
            </div>
          )}
          {mempool && (
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(14,165,233,.04)', borderRadius: 10 }}>
              <div style={{ fontSize: '.65rem', color: 'var(--c)', fontWeight: 700, marginBottom: 4 }}>Mempool</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {mempool.count != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{mempool.count}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Pending TXs</div></div>}
                {mempool.opnetCount != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700, color: 'var(--o)' }}>{mempool.opnetCount}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>OPNet TXs</div></div>}
                {mempool.sizeBytes != null && <div style={{ textAlign: 'center' }}><div style={{ ...monoSm, fontWeight: 700 }}>{(mempool.sizeBytes / 1024 / 1024).toFixed(1)} MB</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Size</div></div>}
              </div>
            </div>
          )}
          {pendingTxs.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(245,158,11,.04)', borderRadius: 10 }}>
              <div style={{ fontSize: '.65rem', color: 'var(--y)', fontWeight: 700, marginBottom: 6 }}>Pending Transactions ({pendingTxs.length})</div>
              {pendingTxs.map((tx, i) => {
                const hash = String(tx.hash || tx.id || tx.transactionId || `tx-${i}`);
                const from = String(tx.from || tx.sender || '').slice(0, 16);
                const to = String(tx.to || tx.recipient || '').slice(0, 16);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.58rem' }}>
                    <span style={{ ...monoSm, color: 'var(--c)', fontSize: '.55rem' }}>{hash.slice(0, 14)}...</span>
                    <span style={{ color: 'var(--t3)' }}>{from ? `${from}...` : ''} {to ? `→ ${to}...` : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)' }}>{loading ? '⏳ Loading…' : 'Failed to load gas parameters'}</div>
      )}
    </div>
  );
});

export default GasTool;
