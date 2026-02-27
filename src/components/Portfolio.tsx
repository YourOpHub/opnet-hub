import React, { useState, useEffect, useMemo } from 'react';
import { networks } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import {
  JSONRpcProvider, getContract, OP_20_ABI,
  type IOP20Contract,
} from 'opnet';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, getContractOpscanUrl, getTxUrl, MINE_DEPLOY_TXID, VIBE_DEPLOY_TXID } from '../contracts';
import { getTxHistory, formatTimeAgo } from '../txHistory';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

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
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

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

    // Fetch OP-20 token balances via opnet SDK (getContract + balanceOf)
    const senderAddr = Address.fromString(walletAddress);
    Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
      setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: true, error: false } }));
      (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
          const sim = await op20.balanceOf(senderAddr as any);
          const bal = sim?.properties?.balance ?? 0n;
          if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: BigInt(bal.toString()), loading: false, error: false } }));
        } catch {
          if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: false, error: true } }));
        }
      })();
    });

    return () => { cancelled = true; };
  }, [walletAddress]);

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
            {isTestnet && Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
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
