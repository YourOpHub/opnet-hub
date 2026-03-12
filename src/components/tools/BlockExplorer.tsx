import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../../logger';
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
    const ac = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const h = await opnet.getBlockHeight().catch((e) => { logger.warn('[BlockExplorer] Block height fetch error:', e); return 0; });
        if (ac.signal.aborted) return;
        if (h > 0) {
          setLatestHeight(h);
          setBlockNum(String(h));
          const blocks: Array<{ num: number; txCount: number; hash: string }> = [];
          for (let i = h; i > Math.max(0, h - 15); i--) {
            if (ac.signal.aborted) return;
            const b = await opnet.getBlockByNumber(i, false).catch((e) => { logger.warn('[BlockExplorer] Block fetch error:', e); return null; });
            if (b) {
              const txs = Array.isArray(b.transactions) ? (b.transactions as unknown[]).length : 0;
              blocks.push({ num: i, txCount: txs, hash: String((b.hash as string | undefined) ?? (b.blockHash as string | undefined) ?? '') });
            }
          }
          if (!ac.signal.aborted) setRecentBlocks(blocks);
        }
        if (ac.signal.aborted) return;
        const mp = await opnet.getMempoolInfo().catch((e) => { logger.warn('[BlockExplorer] Mempool info fetch error:', e); return null; });
        if (!ac.signal.aborted && mp) setMempool(mp);
      } catch (e) {
        if (!ac.signal.aborted) logger.warn('[BlockExplorer] Load failed:', e);
      }
    };
    void load();
    const iv = setInterval(() => { if (!ac.signal.aborted) void load(); }, 30000);
    return () => { ac.abort(); clearInterval(iv); };
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
    <div style={cardS} role="region" aria-label="Block explorer">
      {/* Visual block chain */}
      {recentBlocks.length > 0 && (
        <div className="be-chain-area">
          <div className="be-chain-label">Block Chain</div>
          <div className="be-chain-row">
            {/* Mempool (next block) */}
            {mempool && (
              <>
                <div style={{
                  minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center',
                  background: 'rgba(245,158,11,.08)', border: '1px dashed rgba(245,158,11,.3)',
                  cursor: 'default', transition: '.2s',
                }}>
                  <div className="fs-50 c-y fw-600 mb-2">PENDING</div>
                  <div className="fw-700 c-y fs-70" style={{ ...monoSm }}>{mempool.opnetCount ?? mempool.count ?? '?'}</div>
                  <div style={{ fontSize: '.45rem', color: 'var(--t4)' }}>txs</div>
                </div>
                <div className="c-t4 fs-80" style={{ padding: '0 2px' }}>...</div>
              </>
            )}
            {recentBlocks.map((b, i) => {
              const isLatest = i === 0;
              const selected = blockNum === String(b.num);
              const barH = Math.max(20, Math.min(60, b.txCount * 8 + 20));
              return (
                <div key={b.num} onClick={() => { setBlockNum(String(b.num)); setBlock(null); setTimeout(() => { setLoading(true); opnet.getBlockByNumber(b.num, true).then(bl => { if (bl) setBlock(bl); }).catch((e) => { logger.warn('[BlockExplorer] Block fetch error:', e); }).finally(() => setLoading(false)); }, 0); }}
                  style={{
                    minWidth: 72, padding: '8px 6px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                    background: selected ? 'rgba(247,147,26,.12)' : isLatest ? 'rgba(16,185,129,.06)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${selected ? 'rgba(247,147,26,.3)' : isLatest ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)'}`,
                    transition: '.2s',
                  }}>
                  <div className="fs-50 fw-600 mb-2" style={{ color: isLatest ? 'var(--g)' : 'var(--t4)' }}>
                    {isLatest ? 'LATEST' : `#${b.num.toLocaleString()}`}
                  </div>
                  <div style={{
                    width: '100%', height: barH, borderRadius: 4, marginBottom: 4,
                    background: `linear-gradient(180deg, ${isLatest ? 'rgba(16,185,129,.3)' : 'rgba(14,165,233,.2)'}, transparent)`,
                  }} />
                  <div className="fw-700 c-white fs-70" style={{ ...monoSm }}>
                    {isLatest ? `#${b.num.toLocaleString()}` : `${b.txCount}`}
                  </div>
                  <div className="c-t4" style={{ fontSize: '.45rem' }}>{b.txCount} txs</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="be-nav-row">
        <button aria-label="Previous block" onClick={() => { const n = Math.max(0, parseInt(blockNum) - 1); setBlockNum(String(n)); setBlock(null); }} style={copyBtnS} className="fs-75 p-6-10">&lt;</button>
        <input style={{ ...inputS, flex: 1 }} className="text-center" type="number" aria-label="Block number" value={blockNum} onChange={e => setBlockNum(e.target.value)} placeholder="Block number" onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button aria-label="Next block" onClick={() => { const n = parseInt(blockNum) + 1; if (n <= latestHeight) { setBlockNum(String(n)); setBlock(null); } }} style={copyBtnS} className="fs-75 p-6-10">&gt;</button>
        <button style={btnS} onClick={lookup} disabled={loading}>{loading ? '...' : 'Fetch'}</button>
      </div>
      {latestHeight > 0 && (
        <div className="be-quick-btns">
          <button onClick={() => { setBlockNum(String(latestHeight)); setBlock(null); }} style={copyBtnS} className="p-3-10">Latest (#{latestHeight.toLocaleString()})</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 10)); setBlock(null); }} style={copyBtnS} className="p-3-10">-10</button>
          <button onClick={() => { setBlockNum(String(latestHeight - 100)); setBlock(null); }} style={copyBtnS} className="p-3-10">-100</button>
        </div>
      )}
      {err && <div role="alert" className="fs-72 c-r mb-8">{err}</div>}
      {block && (
        <div>
          {Object.entries(block).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => (
            <React.Fragment key={k}>{renderVal(k, v)}</React.Fragment>
          ))}
          {Array.isArray(block.transactions) && (
            <div className="mt-8">
              <div className="fs-68 c-c fw-700 mb-4">Transactions ({(block.transactions as Array<unknown>).length})</div>
              {(block.transactions as Array<Record<string, string>>).slice(0, 20).map((tx, i) => {
                const txHash = String(tx.hash ?? tx.id ?? i);
                const txFrom = tx.from ? String(tx.from) : '';
                return (
                  <div key={i} className="fs-60" style={{ ...rowS }}>
                    <span className="c-c fs-58" style={{ ...monoSm }}>{txHash.slice(0, 16)}...</span>
                    {txFrom && <span className="c-t3 fs-55" style={{ ...monoSm }}>from: {txFrom.slice(0, 10)}...</span>}
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
