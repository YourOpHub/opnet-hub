import React, { useState, useEffect, useCallback } from 'react';
import * as opnet from '../../opnet';
import { cardS, inputS, btnS, rowS, labelS, valueS, monoSm, copyBtnS, parseHex } from './toolStyles';
import CopyBtn from './CopyBtn';

const BlockExplorer = React.memo(function BlockExplorer() {
  const [blockNum, setBlockNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [block, setBlock] = useState<Record<string, unknown> | null>(null);
  const [latestHeight, setLatestHeight] = useState(0);
  const [recentBlocks, setRecentBlocks] = useState<Array<{ num: number; txCount: number; hash: string }>>([]);
  const [err, setErr] = useState('');
  const [mempool, setMempool] = useState<{ count?: number; opnetCount?: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const h = await opnet.getBlockHeight().catch(() => 0);
      if (h > 0) {
        setLatestHeight(h);
        setBlockNum(String(h));
        // Load last 8 blocks for visual chain
        const blocks: Array<{ num: number; txCount: number; hash: string }> = [];
        for (let i = h; i > Math.max(0, h - 15); i--) {
          const b = await opnet.getBlockByNumber(i, false).catch(() => null);
          if (b) {
            const txs = Array.isArray(b.transactions) ? (b.transactions as unknown[]).length : 0;
            blocks.push({ num: i, txCount: txs, hash: String(b.hash || b.blockHash || '') });
          }
        }
        setRecentBlocks(blocks);
      }
      const mp = await opnet.getMempoolInfo().catch(() => null);
      if (mp) setMempool(mp);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  const lookup = useCallback(async () => {
    if (!blockNum.trim()) return;
    setErr(''); setBlock(null); setLoading(true);
    try {
      const num = parseInt(blockNum.trim());
      if (isNaN(num) || num < 0) { setErr('Invalid block number'); return; }
      const b = await opnet.getBlockByNumber(num, true);
      if (!b) { setErr('Block not found'); return; }
      setBlock(b);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lookup failed'); }
    finally { setLoading(false); }
  }, [blockNum]);

  const renderVal = (k: string, v: unknown): React.ReactNode => {
    if (v === null || v === undefined) return null;
    const sv = String(v);
    return (
      <div key={k} style={rowS}>
        <span style={labelS}>{k}</span>
        <span style={valueS}>
          {sv.length > 50 ? sv.slice(0, 20) + '...' + sv.slice(-16) : sv.startsWith('0x') && sv.length > 10 ? parseHex(sv) + ` (${sv.slice(0, 10)}...)` : sv}
          {sv.length > 10 && <CopyBtn text={sv} />}
        </span>
      </div>
    );
  };

  return (
    <div style={cardS}>
      {/* Visual block chain */}
      {recentBlocks.length > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 0' }}>
          <div style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Block Chain</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
            {/* Mempool (next block) */}
            {mempool && (
              <>
                <div style={{
                  minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center',
                  background: 'rgba(245,158,11,.08)', border: '1px dashed rgba(245,158,11,.3)',
                  cursor: 'default', transition: '.2s',
                }}>
                  <div style={{ fontSize: '.5rem', color: 'var(--y)', fontWeight: 600, marginBottom: 2 }}>PENDING</div>
                  <div style={{ ...monoSm, fontWeight: 700, color: 'var(--y)', fontSize: '.7rem' }}>{mempool.opnetCount ?? mempool.count ?? '?'}</div>
                  <div style={{ fontSize: '.45rem', color: 'var(--t4)' }}>txs</div>
                </div>
                <div style={{ color: 'var(--t4)', fontSize: '.8rem', padding: '0 2px' }}>...</div>
              </>
            )}
            {recentBlocks.map((b, i) => {
              const isLatest = i === 0;
              const selected = blockNum === String(b.num);
              const barH = Math.max(20, Math.min(60, b.txCount * 8 + 20));
              return (
                <div key={b.num} onClick={() => { setBlockNum(String(b.num)); setBlock(null); setTimeout(() => { setLoading(true); opnet.getBlockByNumber(b.num, true).then(bl => { if (bl) setBlock(bl); }).catch(() => {}).finally(() => setLoading(false)); }, 0); }}
                  style={{
                    minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                    background: selected ? 'rgba(247,147,26,.12)' : isLatest ? 'rgba(16,185,129,.06)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${selected ? 'rgba(247,147,26,.3)' : isLatest ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)'}`,
                    transition: '.2s',
                  }}>
                  <div style={{ fontSize: '.5rem', color: isLatest ? 'var(--g)' : 'var(--t4)', fontWeight: 600, marginBottom: 2 }}>
                    {isLatest ? 'LATEST' : `#${b.num.toLocaleString()}`}
                  </div>
                  <div style={{
                    width: '100%', height: barH, borderRadius: 4, marginBottom: 4,
                    background: `linear-gradient(180deg, ${isLatest ? 'rgba(16,185,129,.3)' : 'rgba(14,165,233,.2)'}, transparent)`,
                  }} />
                  <div style={{ ...monoSm, fontWeight: 700, color: '#fff', fontSize: '.7rem' }}>
                    {isLatest ? `#${b.num.toLocaleString()}` : `${b.txCount}`}
                  </div>
                  <div style={{ fontSize: '.45rem', color: 'var(--t4)' }}>{b.txCount} txs</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button onClick={() => { const n = Math.max(0, parseInt(blockNum) - 1); setBlockNum(String(n)); setBlock(null); }} style={{ ...copyBtnS, fontSize: '.75rem', padding: '6px 10px' }}>&lt;</button>
        <input style={{ ...inputS, flex: 1, textAlign: 'center' }} type="number" value={blockNum} onChange={e => setBlockNum(e.target.value)} placeholder="Block number" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button onClick={() => { const n = parseInt(blockNum) + 1; if (n <= latestHeight) { setBlockNum(String(n)); setBlock(null); } }} style={{ ...copyBtnS, fontSize: '.75rem', padding: '6px 10px' }}>&gt;</button>
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Fetch'}</button>
      </div>
      {latestHeight > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => { setBlockNum(String(latestHeight)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>Latest (#{latestHeight.toLocaleString()})</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 10)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>-10</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 100)); setBlock(null); }} style={{ ...copyBtnS, padding: '3px 10px' }}>-100</button>
        </div>
      )}
      {err && <div style={{ fontSize: '.72rem', color: 'var(--r)', marginBottom: 8 }}>{err}</div>}
      {block && (
        <div>
          {Object.entries(block).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => (
            <React.Fragment key={k}>{renderVal(k, v)}</React.Fragment>
          ))}
          {Array.isArray(block.transactions) && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '.68rem', color: 'var(--c)', fontWeight: 700, marginBottom: 4 }}>Transactions ({(block.transactions as Array<unknown>).length})</div>
              {(block.transactions as Array<Record<string, string>>).slice(0, 20).map((tx, i) => {
                const txHash = String(tx.hash ?? tx.id ?? i);
                const txFrom = tx.from ? String(tx.from) : '';
                return (
                  <div key={i} style={{ ...rowS, fontSize: '.6rem' }}>
                    <span style={{ ...monoSm, color: 'var(--c)', fontSize: '.58rem' }}>{txHash.slice(0, 16)}...</span>
                    {txFrom && <span style={{ ...monoSm, color: 'var(--t3)', fontSize: '.55rem' }}>from: {txFrom.slice(0, 10)}...</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default BlockExplorer;
