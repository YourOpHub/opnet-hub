import React, { useState, useEffect } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, DEPLOYER_ADDRESS, DEPLOYER_MLDSA_HEX, DEPLOYER_TWEAKED_HEX, getContractOpscanUrl, MINE_DEPLOY_TXID, VIBE_DEPLOY_TXID } from '../contracts';

function detectNetwork(addr: string): opnet.Network | null {
  if (addr.startsWith('opt1')) return 'testnet';
  if (addr.startsWith('bcrt1')) return 'regtest';
  if (addr.startsWith('bc1')) return 'mainnet';
  if (addr.startsWith('tb1')) return 'testnet';
  return null;
}

interface TokenBalance {
  balance: bigint;
  loading: boolean;
  error: boolean;
}

const Portfolio: React.FC<{ walletAddress?: string }> = ({ walletAddress }) => {
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [priceLoading, setPriceLoading] = useState(true);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});

  useEffect(() => {
    let cancelled = false;
    fetchBtcPrice().then(p => {
      if (!cancelled) { setBtcPrice(p.usd); setBtcChange(p.usd_24h_change); setPriceLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const net = walletAddress ? detectNetwork(walletAddress) : null;
    if (!walletAddress || !net) {
      setBtcSats(null);
      setTokenBalances({});
      return;
    }
    opnet.setNetwork(net);
    let cancelled = false;
    setBtcLoading(true);
    opnet.getBalance(walletAddress)
      .then((sats) => { if (!cancelled) setBtcSats(sats); })
      .catch(() => { if (!cancelled) setBtcSats(null); })
      .finally(() => { if (!cancelled) setBtcLoading(false); });

    // Fetch OP-20 token balances via btc_call balanceOf
    const isDeployer = walletAddress === DEPLOYER_ADDRESS;
    const mldsaHex = isDeployer ? DEPLOYER_MLDSA_HEX : undefined;
    const tweakedHex = isDeployer ? DEPLOYER_TWEAKED_HEX : undefined;

    const tokenEntries = Object.entries(TESTNET_CONTRACTS);
    tokenEntries.forEach(([sym, tok]) => {
      setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: true, error: false } }));
      const fetchBal = mldsaHex
        ? opnet.getTokenBalance(tok.address, mldsaHex, tweakedHex)
        : Promise.resolve(0n);
      fetchBal
        .then(bal => { if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: bal, loading: false, error: false } })); })
        .catch(() => { if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: false, error: true } })); });
    });

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
            {isTestnet && Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
              const tb = tokenBalances[sym];
              const rawBal = tb?.balance ?? 0n;
              const humanBal = Number(rawBal) / Math.pow(10, tok.decimals);
              const isDeployer = walletAddress === DEPLOYER_ADDRESS;
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
          <div style={{ marginTop: 12, padding: 12, background: 'var(--cG)', borderRadius: 'var(--rad)', fontSize: '.8rem', color: 'var(--t2)' }}>
            Connect your OP_WALLET in the header to see your live BTC balance from OP_NET consensus.
          </div>
        )}
        {walletAddress && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(247,147,26,.05)', borderRadius: 'var(--rad)', fontSize: '.72rem', color: 'var(--t3)' }}>
            OP-20 balances fetched via <code>btc_call → balanceOf()</code> on OP_NET testnet consensus.
            {' '}<a href={`https://testnet.opnet.org/tx/${MINE_DEPLOY_TXID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>MINE deploy tx</a>
            {' · '}<a href={`https://testnet.opnet.org/tx/${VIBE_DEPLOY_TXID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>VIBE deploy tx</a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
