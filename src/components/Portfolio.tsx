import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  JSONRpcProvider, getContract, OP_20_ABI,
  type IOP20Contract,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, POOL_ADDRESS, getContractOpscanUrl, getTxUrl, MINE_DEPLOY_TXID, VIBE_DEPLOY_TXID } from '../contracts';
import { getTxHistory, formatTimeAgo, addTxRecord } from '../txHistory';

function detectNetwork(addr: string): opnet.Network | null {
  if (addr.startsWith('opt1')) return 'testnet';
  if (addr.startsWith('bcrt1')) return 'regtest';
  if (addr.startsWith('bc1')) return 'mainnet';
  // tb1 is Bitcoin Testnet4, NOT OPNet testnet (which uses opt1)
  return null;
}

interface TokenBalance {
  balance: bigint;
  loading: boolean;
  error: boolean;
}

const Portfolio: React.FC<{ walletAddress?: string; senderAddress?: Address | null }> = ({ walletAddress, senderAddress }) => {
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [priceLoading, setPriceLoading] = useState(true);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const provider = useMemo(() => getProvider(), []);

  // LP position from localStorage
  const [lpMine, setLpMine] = useState(() => { try { return Number(localStorage.getItem('hub_lp_mine') || '0'); } catch { return 0; } });
  const [lpVibe, setLpVibe] = useState(() => { try { return Number(localStorage.getItem('hub_lp_vibe') || '0'); } catch { return 0; } });
  const [reserveA, setReserveA] = useState(0);
  const [reserveB, setReserveB] = useState(0);
  const hasLP = lpMine > 0 || lpVibe > 0;
  const poolShareMine = reserveA > 0 ? (lpMine / reserveA) * 100 : 0;
  const poolShareVibe = reserveB > 0 ? (lpVibe / reserveB) * 100 : 0;
  const poolShare = Math.max(poolShareMine, poolShareVibe);

  // Remove liquidity state
  const [removing, setRemoving] = useState(false);
  const [removeStep, setRemoveStep] = useState('');
  const [removeResult, setRemoveResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchBtcPrice().then(p => {
      if (!cancelled) { setBtcPrice(p.usd); setBtcChange(p.usd_24h_change); setPriceLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch pool reserves
  useEffect(() => {
    if (!POOL_ADDRESS) return;
    let cancelled = false;
    const fetchRes = async () => {
      try {
        const res = await opnet.callContract(POOL_ADDRESS, '06374bfc');
        if (res && !cancelled) {
          const hex = res.startsWith('0x') ? res.slice(2) : res;
          if (hex.length >= 128) {
            const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
            const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
            if (r0 > 0) setReserveA(r0);
            if (r1 > 0) setReserveB(r1);
          }
        }
      } catch { /* ignore */ }
    };
    fetchRes();
  }, [refreshKey]);

  // Remove liquidity: SimplePool v1 tracks LP locally (no on-chain LP tokens)
  // Clears the local position record. Tokens remain in pool until v2 with on-chain withdrawal.
  const removeLiquidity = useCallback(() => {
    if (!walletAddress || !hasLP) return;
    const prevMine = lpMine;
    const prevVibe = lpVibe;
    localStorage.setItem('hub_lp_mine', '0');
    localStorage.setItem('hub_lp_vibe', '0');
    setLpMine(0);
    setLpVibe(0);
    setRemoveResult({ ok: true, msg: `Position cleared: ${prevMine.toLocaleString()} MINE + ${prevVibe.toLocaleString()} VIBE removed from tracking.` });
    addTxRecord({ type: 'claim', txHash: '', tokenA: 'LP', amountA: `${prevMine}+${prevVibe}`, status: 'confirmed', wallet: walletAddress });
    setTimeout(() => setRefreshKey(k => k + 1), 3000);
  }, [walletAddress, lpMine, lpVibe, hasLP]);

  useEffect(() => {
    const net = walletAddress ? detectNetwork(walletAddress) : null;
    if (!walletAddress || !net) {
      setBtcSats(null);
      setTokenBalances({});
      return;
    }
    const prevNet = opnet.getNetwork();
    opnet.setNetwork(net);
    let cancelled = false;
    setBtcLoading(true);
    opnet.getBalance(walletAddress)
      .then((sats) => { if (!cancelled) setBtcSats(sats); })
      .catch(() => { if (!cancelled) setBtcSats(null); })
      .finally(() => { if (!cancelled) setBtcLoading(false); });

    // Fetch OP-20 token balances via opnet SDK (getContract + balanceOf)
    if (senderAddress) {
      Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
        setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: true, error: false } }));
        (async () => {
          try {
            const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, provider, NETWORK, senderAddress);
            const sim = await op20.balanceOf(senderAddress);
            const bal = sim?.properties?.balance ?? 0n;
            if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: BigInt(bal.toString()), loading: false, error: false } }));
          } catch {
            if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: false, error: true } }));
          }
        })();
      });
    }

    // M-02 FIX: restore previous network on unmount
    return () => { cancelled = true; opnet.setNetwork(prevNet); };
  }, [walletAddress, senderAddress]);

  const history = walletAddress ? getTxHistory(walletAddress) : [];
  const btcAmount = btcSats != null ? Number(btcSats) / 1e8 : 0;
  const btcUsd = btcAmount * btcPrice;
  const tot = btcUsd;
  const totBtc = btcPrice > 0 ? tot / btcPrice : 0;
  const isTestnet = walletAddress?.startsWith('opt1');

  return (
    <div>
      <div className="ph">
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--o)', fontSize: '1rem', wordBreak: 'break-all' }}>
            {priceLoading ? '…' : '$' + (tot >= 1e6 ? (tot / 1e6).toFixed(2) + 'M' : tot.toLocaleString(undefined, { maximumFractionDigits: 2 }))}
          </div>
          <div className="pm-l">Total (USD)</div>
        </div>
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--y)', fontSize: '1rem', wordBreak: 'break-all' }}>
            {priceLoading ? '…' : totBtc.toFixed(8) + ' BTC'}
          </div>
          <div className="pm-l">BTC Value</div>
        </div>
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--g)', fontSize: '1rem', wordBreak: 'break-all' }}>
            {walletAddress ? (btcLoading ? '…' : opnet.formatSats(btcSats ?? 0n)) : '—'}
          </div>
          <div className="pm-l">Your BTC (chain)</div>
        </div>
        <div className="P pm">
          <div className="pm-v">{isTestnet ? 'Testnet' : walletAddress ? '1' : '—'}</div>
          <div className="pm-l">{isTestnet ? 'Network' : 'Assets'}</div>
        </div>
      </div>

      <div className="P" style={{ overflow: 'auto' }}>
        <div className="Lb">
          💼 Consensus-Verified Holdings
          {walletAddress && <span className="tag tag-g">Live BTC</span>}
        </div>
        <table className="pt">
          <thead>
            <tr><th>Asset</th><th>Balance</th><th>Price</th><th>24h</th><th>Value</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: '1rem' }}>₿</span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--w)' }}>Bitcoin</div>
                    <div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>BTC</div>
                  </div>
                </div>
              </td>
              <td className="mono">
                {walletAddress
                  ? (btcLoading ? '…' : btcAmount.toLocaleString(undefined, { maximumFractionDigits: 8 }))
                  : 'Connect wallet'}
              </td>
              <td className="mono">{priceLoading ? '…' : '$' + btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td className="mono" style={{ color: btcChange >= 0 ? 'var(--g)' : 'var(--r)' }}>{btcChange >= 0 ? '+' : ''}{btcChange.toFixed(1)}%</td>
              <td className="mono" style={{ color: 'var(--o)' }}>
                {walletAddress && !btcLoading ? '$' + btcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </td>
            </tr>
            {isTestnet && Object.entries(TESTNET_CONTRACTS).map(([sym, tok]: [string, any]) => {
              const tb = tokenBalances[sym];
              const rawBal = tb?.balance ?? 0n;
              const humanBal = Number(rawBal) / Math.pow(10, tok.decimals);
              const isDeployer = false;
              return (
                <tr key={tok.symbol}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: '1rem' }}>{tok.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--w)' }}>{tok.name}</div>
                        <div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>
                          <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--c2)', textDecoration: 'none' }}>{tok.symbol} ↗</a>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">
                    {!walletAddress ? '—'
                      : tb?.loading ? '…'
                      : rawBal > 0n ? humanBal.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : isDeployer && tb?.error ? <span style={{ fontSize: '.6rem', color: 'var(--r)' }}>Contract pending</span>
                      : <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>0 {tok.symbol}</span>}
                  </td>
                  <td className="mono" style={{ color: 'var(--t3)' }}>—</td>
                  <td className="mono" style={{ color: 'var(--t3)' }}>—</td>
                  <td className="mono" style={{ color: rawBal > 0n ? 'var(--o)' : 'var(--t3)' }}>—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!walletAddress && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(14,165,233,.06)', borderRadius: '14px', fontSize: '.8rem', color: 'var(--t2)' }}>
            Connect your OP_WALLET in the header to see your live BTC balance from OP_NET consensus.
          </div>
        )}
        {walletAddress && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(247,147,26,.05)', borderRadius: '14px', fontSize: '.72rem', color: 'var(--t3)' }}>
            OP-20 balances fetched via <code>btc_call → balanceOf()</code> on OP_NET testnet consensus.
            {' '}<a href={`https://testnet.opnet.org/tx/${MINE_DEPLOY_TXID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>MINE deploy tx</a>
            {' · '}<a href={`https://testnet.opnet.org/tx/${VIBE_DEPLOY_TXID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>VIBE deploy tx</a>
          </div>
        )}
      </div>

      {/* Liquidity Positions */}
      {walletAddress && POOL_ADDRESS && (
        <div className="P" style={{ marginTop: 14 }}>
          <div className="Lb">🌊 Liquidity Positions</div>
          {hasLP ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {/* MINE/VIBE Pool card */}
                <div style={{ flex: 1, minWidth: 220, padding: '12px 14px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: 'var(--w)', fontSize: '.82rem' }}>⛏️ MINE / ⚡ VIBE</div>
                    <span style={{ fontSize: '.62rem', padding: '2px 8px', background: 'rgba(247,147,26,.12)', color: 'var(--o)', borderRadius: 6, fontWeight: 700 }}>
                      {poolShare.toFixed(2)}% pool share
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem', color: 'var(--t2)', marginBottom: 4 }}>
                    <span>Your MINE</span>
                    <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)' }}>{lpMine.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem', color: 'var(--t2)', marginBottom: 4 }}>
                    <span>Your VIBE</span>
                    <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)' }}>{lpVibe.toLocaleString()}</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--bd)', margin: '8px 0', paddingTop: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.66rem', color: 'var(--t3)' }}>
                      <span>Pool MINE reserve</span>
                      <span style={{ fontFamily: 'var(--fm)' }}>{reserveA > 0 ? reserveA.toLocaleString() : '...'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.66rem', color: 'var(--t3)', marginTop: 2 }}>
                      <span>Pool VIBE reserve</span>
                      <span style={{ fontFamily: 'var(--fm)' }}>{reserveB > 0 ? reserveB.toLocaleString() : '...'}</span>
                    </div>
                  </div>
                  <button
                    onClick={removeLiquidity}
                    disabled={removing}
                    style={{
                      marginTop: 10, width: '100%', padding: '8px', borderRadius: 8,
                      border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)',
                      color: '#ef4444', fontWeight: 700, fontSize: '.72rem', cursor: 'pointer',
                      fontFamily: 'var(--ff)', opacity: removing ? 0.5 : 1,
                    }}
                  >
                    {removing ? removeStep || 'Removing...' : 'Remove Liquidity'}
                  </button>
                </div>
              </div>
              {removeResult && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: '.72rem',
                  background: removeResult.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
                  border: `1px solid ${removeResult.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
                  color: removeResult.ok ? 'var(--g)' : '#ef4444',
                }}>
                  {removeResult.msg}
                </div>
              )}
              <div style={{ fontSize: '.6rem', color: 'var(--t4)', padding: '0 2px' }}>
                SimplePool v1 — LP positions tracked locally. On-chain LP tokens & withdrawal in v2.
              </div>
            </div>
          ) : (
            <div style={{ padding: 14, textAlign: 'center', color: 'var(--t3)', fontSize: '.78rem' }}>
              No liquidity positions. Add liquidity in the <strong>Swap</strong> tab.
            </div>
          )}
        </div>
      )}

      {/* Transaction History */}
      {history.length > 0 && (
        <div className="P" style={{ marginTop: 14 }}>
          <div className="Lb">📝 Transaction History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.slice(0, 20).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: '.72rem' }}>
                <span style={{ fontSize: '.9rem', width: 22, textAlign: 'center' }}>{tx.type === 'swap' ? '🔄' : tx.type === 'mint' ? '🪙' : '🎁'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--w)' }}>
                    {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : tx.type === 'mint' ? `Minted ${Number(tx.amountA||0).toLocaleString()} ${tx.tokenA}` : `Claimed ${Number(tx.amountA||0).toLocaleString()} ${tx.tokenA}`}
                  </div>
                  <div style={{ fontSize: '.58rem', color: 'var(--t4)' }}>{formatTimeAgo(tx.ts)}</div>
                </div>
                {tx.txHash && (
                  <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.56rem', color: 'var(--c2)', textDecoration: 'none', whiteSpace: 'nowrap' }}>TX ↗</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
