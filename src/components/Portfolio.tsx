import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';

function detectNetwork(addr: string): opnet.Network | null {
  if (addr.startsWith('opt1')) return 'testnet';
  if (addr.startsWith('bcrt1')) return 'regtest';
  if (addr.startsWith('bc1')) return 'mainnet';
  if (addr.startsWith('tb1')) return 'testnet';
  return null;
}

const Portfolio: React.FC<{ walletAddress?: string }> = ({ walletAddress }) => {
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [btcChange, setBtcChange] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.bitcoin?.usd) {
          setBtcPrice(d.bitcoin.usd);
          setBtcChange(d.bitcoin.usd_24h_change ?? 0);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const net = walletAddress ? detectNetwork(walletAddress) : null;
    if (!walletAddress || !net) {
      setBtcSats(null);
      return;
    }
    opnet.setNetwork(net);
    let cancelled = false;
    setBtcLoading(true);
    opnet.getBalance(walletAddress)
      .then((sats) => { if (!cancelled) setBtcSats(sats); })
      .catch(() => { if (!cancelled) setBtcSats(null); })
      .finally(() => { if (!cancelled) setBtcLoading(false); });
    return () => { cancelled = true; };
  }, [walletAddress]);

  const btcAmount = btcSats != null ? Number(btcSats) / 1e8 : 0;
  const btcUsd = btcAmount * btcPrice;
  const tot = btcUsd;
  const totBtc = btcPrice > 0 ? tot / btcPrice : 0;
  const isTestnet = walletAddress?.startsWith('opt1');

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
              <td className="mono">${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td className="mono" style={{ color: btcChange >= 0 ? 'var(--g)' : 'var(--r)' }}>{btcChange >= 0 ? '+' : ''}{btcChange.toFixed(1)}%</td>
              <td className="mono" style={{ color: 'var(--o)' }}>
                {walletAddress && !btcLoading ? '$' + btcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </td>
            </tr>
            {walletAddress && isTestnet && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '18px 12px', color: 'var(--t3)', fontSize: '.75rem' }}>
                  <div style={{ marginBottom: 6 }}>OP-20 token balances will appear here once tokens are deployed.</div>
                  <div style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Deploy $MINE via OP_WALLET → Token Launcher tab, then balances will load from chain.</div>
                </td>
              </tr>
            )}
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
