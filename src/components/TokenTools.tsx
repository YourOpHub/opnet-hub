import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';

const TokenTools: React.FC = () => {
  const [network, setNetwork] = useState<opnet.Network>(opnet.getNetwork());
  const [ba, setBa] = useState('1');
  const [bp, setBp] = useState(97842);
  const bn = parseFloat(ba) || 0;
  const sv = bn * 1e8;
  const uv = bn * bp;

  const [ta, setTa] = useState('');
  const [tr, setTr] = useState<{ n: string; std: string; dec: number; sup: string; isContract: boolean } | null>(null);
  const [tl, setTl] = useState(false);
  const [terr, setTerr] = useState('');

  const [wa, setWa] = useState('');
  const [wr, setWr] = useState<{ btc: string; sats: string } | null>(null);
  const [wl, setWl] = useState(false);
  const [werr, setWerr] = useState('');

  const [gas, setGas] = useState<opnet.GasParams | null>(null);
  const [mempool, setMempool] = useState<{ count?: number; sizeBytes?: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('hub_tools_used', '1');
  }, []);

  useEffect(() => {
    opnet.setNetwork(network);
  }, [network]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [g, m] = await Promise.all([
          opnet.getGasParameters(),
          opnet.getMempoolInfo().catch(() => null),
        ]);
        if (!cancelled) {
          setGas(g || null);
          setMempool(m || null);
        }
      } catch {
        if (!cancelled) setGas(null);
      }
    })();
    return () => { cancelled = true; };
  }, [network]);

  const onBa = (v: string) => {
    setBa(v);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.bitcoin?.usd) setBp(d.bitcoin.usd); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const lookup = async () => {
    if (!ta.trim()) return;
    setTerr('');
    setTr(null);
    setTl(true);
    try {
      const addr = ta.trim();
      const [code, info] = await Promise.all([
        opnet.getCode(addr, true),
        opnet.getOP20Info(addr),
      ]);
      const isContract = !!code && !!(code as { bytecode?: string }).bytecode;
      if (!isContract) {
        setTr({
          n: '—',
          std: 'Not a contract',
          dec: 0,
          sup: '—',
          isContract: false,
        });
        setTerr('No contract bytecode at this address.');
        return;
      }
      if (info) {
        const sup = info.totalSupply && info.totalSupply !== '0' ? formatBigNum(info.totalSupply) : info.totalSupply;
        setTr({
          n: info.name,
          std: 'OP-20',
          dec: info.decimals,
          sup: sup || info.totalSupply,
          isContract: true,
        });
        setTerr('');
      } else {
        setTr({
          n: 'Unknown',
          std: 'Contract (not OP-20 or storage unreadable)',
          dec: 0,
          sup: '—',
          isContract: true,
        });
        setTerr('Could not read OP-20 storage. Address may be a different contract type.');
      }
    } catch (e) {
      setTerr(e instanceof Error ? e.message : 'Lookup failed');
      setTr(null);
    } finally {
      setTl(false);
    }
  };

  const check = async () => {
    if (!wa.trim()) return;
    setWerr('');
    setWr(null);
    setWl(true);
    try {
      const addr = wa.trim();
      const balance = await opnet.getBalance(addr);
      const sats = balance.toString();
      const btc = (Number(balance) / 1e8).toFixed(8);
      setWr({ btc, sats });
    } catch (e) {
      setWerr(e instanceof Error ? e.message : 'Inspect failed');
      setWr(null);
    } finally {
      setWl(false);
    }
  };

  function formatBigNum(s: string): string {
    const n = BigInt(s);
    if (n >= 1e18) return (Number(n) / 1e18).toFixed(2) + 'e+18';
    if (n >= 1e15) return (Number(n) / 1e15).toFixed(2) + 'e+15';
    if (n >= 1e12) return (Number(n) / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (Number(n) / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (Number(n) / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (Number(n) / 1e3).toFixed(2) + 'K';
    return n.toString();
  }

  return (
    <div className="tg">
      <div className="Pg" style={{ marginBottom: 8, padding: '10px 14px' }}>
        <div className="Lb" style={{ marginBottom: 6 }}>🌐 Network</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['regtest', 'testnet', 'mainnet'] as const).map((n) => (
            <button
              key={n}
              className={`fbn ${network === n ? 'on' : ''}`}
              onClick={() => setNetwork(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="Pg">
        <div className="Lb">💱 BTC ↔ Sats ↔ USD</div>
        <div className="ir">
          <input
            className="ti"
            type="number"
            step="any"
            value={ba}
            onChange={(e) => onBa(e.target.value)}
            placeholder="BTC"
          />
          <span style={{ alignSelf: 'center', color: 'var(--t3)', fontWeight: 700, fontSize: '.82rem' }}>BTC</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="cr">
            <div className="cr-b">
              {sv >= 1e6 ? (sv / 1e6).toFixed(2) + 'M' : sv.toLocaleString()}
            </div>
            <div className="cr-l">Satoshis</div>
          </div>
          <div className="cr">
            <div className="cr-b" style={{ color: 'var(--g)' }}>
              ${uv >= 1e6 ? (uv / 1e6).toFixed(2) + 'M' : uv.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="cr-l">USD</div>
          </div>
        </div>
      </div>

      <div className="Pg">
        <div className="Lb">🔍 OP-20 Token Explorer <span className="tag tag-g">Live RPC</span></div>
        <div className="ir">
          <input
            className="ti"
            value={ta}
            onChange={(e) => setTa(e.target.value)}
            placeholder="Contract address (P2OP / bcrt1p... / tb1p...)"
          />
          <button className="tb" onClick={lookup} disabled={tl}>
            {tl ? '…' : 'Explore'}
          </button>
        </div>
        {terr && <div style={{ fontSize: '.75rem', color: 'var(--r)', marginTop: 6 }}>{terr}</div>}
        {tr && (
          <div className="rb">
            <div className="rr">
              <span className="rk">Name</span>
              <span className="rv" style={{ color: 'var(--o)' }}>{tr.n}</span>
            </div>
            <div className="rr">
              <span className="rk">Standard</span>
              <span className="rv" style={{ color: 'var(--c)' }}>{tr.std}</span>
            </div>
            <div className="rr">
              <span className="rk">Decimals</span>
              <span className="rv">{tr.dec}</span>
            </div>
            <div className="rr">
              <span className="rk">Total supply</span>
              <span className="rv">{tr.sup}</span>
            </div>
          </div>
        )}
      </div>

      <div className="Pg">
        <div className="Lb">💰 Wallet Inspector <span className="tag tag-g">Live RPC</span></div>
        <div className="ir">
          <input
            className="ti"
            value={wa}
            onChange={(e) => setWa(e.target.value)}
            placeholder="Address (bcrt1... / tb1... / bc1...)"
          />
          <button className="tb" onClick={check} disabled={wl}>
            {wl ? '…' : 'Inspect'}
          </button>
        </div>
        {werr && <div style={{ fontSize: '.75rem', color: 'var(--r)', marginTop: 6 }}>{werr}</div>}
        {wr && (
          <div className="rb">
            <div className="rr">
              <span className="rk">BTC</span>
              <span className="rv" style={{ color: 'var(--o)' }}>{wr.btc} ₿</span>
            </div>
            <div className="rr">
              <span className="rk">Satoshis</span>
              <span className="rv">{Number(wr.sats).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <div className="Pg">
        <div className="Lb">⛽ Gas &amp; Mempool <span className="tag tag-g">Live RPC</span></div>
        {gas ? (
          <div className="rb">
            <div className="rr">
              <span className="rk">Block</span>
              <span className="rv">{gas.blockNumber ? parseHex(gas.blockNumber) : '—'}</span>
            </div>
            <div className="rr">
              <span className="rk">Conservative fee</span>
              <span className="rv">{gas.bitcoin?.conservative ?? '—'} sat/vB</span>
            </div>
            {gas.bitcoin?.recommended && (
              <>
                <div className="rr">
                  <span className="rk">Low / Medium / High</span>
                  <span className="rv" style={{ color: 'var(--o)' }}>
                    {gas.bitcoin.recommended.low} / {gas.bitcoin.recommended.medium} / {gas.bitcoin.recommended.high} sat/vB
                  </span>
                </div>
              </>
            )}
            {mempool && (mempool.sizeBytes != null || mempool.count != null) && (
              <div className="rr">
                <span className="rk">Mempool</span>
                <span className="rv">
                  {mempool.count != null ? `${mempool.count} tx` : ''}
                  {mempool.sizeBytes != null ? ` · ${(mempool.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--t3)', fontSize: '.85rem' }}>Loading gas parameters from OP_NET…</div>
        )}
      </div>
    </div>
  );
};

function parseHex(s: string): string {
  if (typeof s !== 'string') return '—';
  if (s.startsWith('0x')) return Number(BigInt(s)).toLocaleString();
  return s;
}

export default TokenTools;
