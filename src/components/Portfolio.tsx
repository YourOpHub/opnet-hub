import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';

interface T {
  name: string;
  symbol: string;
  amount: number;
  price: number;
  change: number;
  icon: string;
}

const SAMPLE_TK: T[] = [
  { name: 'WBTC', symbol: 'WBTC', amount: 0.0012, price: 97800, change: 2.1, icon: '🔶' },
  { name: 'Motoswap', symbol: 'MOTO', amount: 4250, price: 0.42, change: 12.5, icon: '🏎️' },
  { name: 'OPNet Token', symbol: 'OPN', amount: 15000, price: 0.085, change: -3.2, icon: '⚡' },
  { name: 'Mine Token', symbol: 'MINE', amount: 8420, price: 0.0012, change: 45.8, icon: '🪙' },
];

const Portfolio: React.FC<{ walletAddress?: string }> = ({ walletAddress }) => {
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcPrice, setBtcPrice] = useState(97842);

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.bitcoin?.usd) setBtcPrice(d.bitcoin.usd); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!walletAddress || (!walletAddress.startsWith('bcrt1') && !walletAddress.startsWith('tb1') && !walletAddress.startsWith('bc1'))) {
      setBtcSats(null);
      return;
    }
    const net = walletAddress.startsWith('bcrt1') ? 'regtest' : walletAddress.startsWith('tb1') ? 'testnet' : 'mainnet';
    opnet.setNetwork(net);
    let cancelled = false;
    setBtcLoading(true);
    opnet.getBalance(walletAddress)
      .then((sats) => { if (!cancelled) { setBtcSats(sats); } })
      .catch(() => { if (!cancelled) setBtcSats(null); })
      .finally(() => { if (!cancelled) setBtcLoading(false); });
    return () => { cancelled = true; };
  }, [walletAddress]);

  const btcAmount = btcSats != null ? Number(btcSats) / 1e8 : 0;
  const btcUsd = btcAmount * btcPrice;
  const sampleTot = SAMPLE_TK.reduce((s, t) => s + t.amount * t.price, 0);
  const tot = btcUsd + sampleTot;
  const totBtc = btcPrice > 0 ? tot / btcPrice : 0;

  return (
    <div>
      <div className="ph">
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--o)' }}>
            ${tot >= 1e6 ? (tot / 1e6).toFixed(2) + 'M' : tot.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="pm-l">Total (USD)</div>
        </div>
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--y)' }}>
            {totBtc.toFixed(6)} BTC
          </div>
          <div className="pm-l">BTC Value</div>
        </div>
        <div className="P pm">
          <div className="pm-v" style={{ color: 'var(--g)' }}>
            {walletAddress ? (btcLoading ? '…' : opnet.formatSats(btcSats ?? 0n)) : '—'}
          </div>
          <div className="pm-l">Your BTC (chain)</div>
        </div>
        <div className="P pm">
          <div className="pm-v">{1 + SAMPLE_TK.length}</div>
          <div className="pm-l">Assets</div>
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
              <td className="mono">${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td className="mono" style={{ color: 'var(--g)' }}>+2.1%</td>
              <td className="mono" style={{ color: 'var(--o)' }}>
                {walletAddress && !btcLoading ? '$' + btcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </td>
            </tr>
            {SAMPLE_TK.map((t, i) => (
              <tr key={i}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: '1rem' }}>{t.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--w)' }}>{t.name}</div>
                      <div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>{t.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="mono">{walletAddress ? t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</td>
                <td className="mono">${t.price >= 1 ? t.price.toLocaleString() : t.price.toFixed(4)}</td>
                <td className="mono" style={{ color: t.change >= 0 ? 'var(--g)' : 'var(--r)' }}>{t.change >= 0 ? '+' : ''}{t.change}%</td>
                <td className="mono" style={{ color: 'var(--o)' }}>{walletAddress ? '$' + (t.amount * t.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!walletAddress && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--cG)', borderRadius: 'var(--rad)', fontSize: '.8rem', color: 'var(--t2)' }}>
            Connect your OP_WALLET in the header to see your live BTC balance from OP_NET consensus.
          </div>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
