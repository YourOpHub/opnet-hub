import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logger } from '../logger';
import {
  getContract, OP_20_ABI,
  type IOP20Contract, type CallResult, type BaseContractProperties,
} from 'opnet';
import { POOL_LP_ABI } from '../abis';
import { type Address } from '@btc-vision/transaction';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS, getContractOpscanUrl, getTxUrl, MINE_DEPLOY_TXID, VIBE_DEPLOY_TXID, type ContractTokenInfo } from '../contracts';
import { getTxHistory, formatTimeAgo } from '../txHistory';


interface IPoolLPContract extends BaseContractProperties {
  liquidityOf(account: unknown): Promise<CallResult>;
}

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

  // LP position — on-chain via liquidityOf(), fallback to localStorage
  const [lpMine, setLpMine] = useState(0);
  const [lpVibe, setLpVibe] = useState(0);
  const [lpLoading, setLpLoading] = useState(false);
  const [lpOnChain, setLpOnChain] = useState(false); // true = fetched from chain
  const [reserveA, setReserveA] = useState(0);
  const [reserveB, setReserveB] = useState(0);
  const hasLP = lpMine > 0 || lpVibe > 0;
  const poolShareMine = reserveA > 0 ? (lpMine / reserveA) * 100 : 0;
  const poolShareVibe = reserveB > 0 ? (lpVibe / reserveB) * 100 : 0;
  const poolShare = Math.max(poolShareMine, poolShareVibe);

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
    const cancelled = false;
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
      } catch (e) { logger.warn('[Portfolio] Pool reserves fetch failed:', e); }
    };
    fetchRes();
  }, [refreshKey]);

  // Fetch LP position on-chain via liquidityOf(senderAddress)
  useEffect(() => {
    if (!senderAddress || !POOL_ADDRESS) {
      // Fallback to localStorage when wallet not connected
      try {
        const m = Number(localStorage.getItem('hub_lp_mine') || '0');
        const v = Number(localStorage.getItem('hub_lp_vibe') || '0');
        setLpMine(m);
        setLpVibe(v);
        setLpOnChain(false);
      } catch (e) { logger.warn('[Portfolio] LP localStorage fallback failed:', e); }
      return;
    }
    let cancelled = false;
    setLpLoading(true);
    (async () => {
      try {
        const poolContract = getContract<IPoolLPContract>(POOL_ADDRESS, POOL_LP_ABI, provider, NETWORK, senderAddress);
        const res = await poolContract.liquidityOf(senderAddress) as CallResult;
        if (cancelled) return;
        if (!res.revert && res.properties) {
          const props = res.properties as Record<string, unknown>;
          const a = Number(props.amountA ?? 0n) / 1e8;
          const b = Number(props.amountB ?? 0n) / 1e8;
          setLpMine(a);
          setLpVibe(b);
          setLpOnChain(true);
        } else {
          // On-chain call reverted — fallback to localStorage
          try {
            const m = Number(localStorage.getItem('hub_lp_mine') || '0');
            const v = Number(localStorage.getItem('hub_lp_vibe') || '0');
            setLpMine(m);
            setLpVibe(v);
            setLpOnChain(false);
          } catch (e) { logger.warn('[Portfolio] LP localStorage fallback failed:', e); }
        }
      } catch (e) {
        // Network error — fallback to localStorage
        logger.warn('[Portfolio] LP on-chain fetch failed:', e);
        if (!cancelled) {
          try {
            const m = Number(localStorage.getItem('hub_lp_mine') || '0');
            const v = Number(localStorage.getItem('hub_lp_vibe') || '0');
            setLpMine(m);
            setLpVibe(v);
            setLpOnChain(false);
          } catch (e2) { logger.warn('[Portfolio] LP localStorage fallback failed:', e2); }
        }
      } finally {
        if (!cancelled) setLpLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [senderAddress, provider, refreshKey]);

  // Refresh LP position (triggers on-chain re-fetch)
  const refreshLP = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

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
      Object.entries(DEPLOYED_CONTRACTS).forEach(([sym, tok]) => {
        setTokenBalances(prev => ({ ...prev, [sym]: { balance: 0n, loading: true, error: false } }));
        (async () => {
          try {
            const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, provider, NETWORK, senderAddress);
            const sim = await op20.balanceOf(senderAddress);
            const bal = sim?.properties?.balance ?? 0n;
            if (!cancelled) setTokenBalances(prev => ({ ...prev, [sym]: { balance: BigInt(bal.toString()), loading: false, error: false } }));
          } catch (e) {
            logger.warn(`[Portfolio] Failed to fetch ${sym} balance:`, e);
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
          <div className="pm-v fs-lg c-o word-break">
            {priceLoading ? '…' : '$' + (tot >= 1e6 ? (tot / 1e6).toFixed(2) + 'M' : tot.toLocaleString(undefined, { maximumFractionDigits: 2 }))}
          </div>
          <div className="pm-l">Total (USD)</div>
        </div>
        <div className="P pm">
          <div className="pm-v fs-lg word-break c-y">
            {priceLoading ? '…' : totBtc.toFixed(8) + ' BTC'}
          </div>
          <div className="pm-l">BTC Value</div>
        </div>
        <div className="P pm">
          <div className="pm-v fs-lg c-g word-break">
            {walletAddress ? (btcLoading ? '…' : opnet.formatSats(btcSats ?? 0n)) : '—'}
          </div>
          <div className="pm-l">Your BTC (chain)</div>
        </div>
        <div className="P pm">
          <div className="pm-v">{isTestnet ? CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1) : walletAddress ? '1' : '—'}</div>
          <div className="pm-l">{isTestnet ? 'Network' : 'Assets'}</div>
        </div>
      </div>

      <div className="P overflow-auto">
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
                <div className="asset-row">
                  <span className="fs-lg">₿</span>
                  <div>
                    <div className="asset-name">Bitcoin</div>
                    <div className="asset-sym">BTC</div>
                  </div>
                </div>
              </td>
              <td className="mono">
                {walletAddress
                  ? (btcLoading ? '…' : btcAmount.toLocaleString(undefined, { maximumFractionDigits: 8 }))
                  : 'Connect wallet'}
              </td>
              <td className="mono">{priceLoading ? '…' : '$' + btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td className={`mono ${btcChange >= 0 ? 'c-g' : 'c-r'}`}>{btcChange >= 0 ? '+' : ''}{btcChange.toFixed(1)}%</td>
              <td className="mono c-o">
                {walletAddress && !btcLoading ? '$' + btcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </td>
            </tr>
            {Object.entries(DEPLOYED_CONTRACTS).map(([sym, tok]: [string, ContractTokenInfo]) => {
              const tb = tokenBalances[sym];
              const rawBal = tb?.balance ?? 0n;
              const humanBal = Number(rawBal) / Math.pow(10, tok.decimals);
              const isDeployer = false;
              return (
                <tr key={tok.symbol}>
                  <td>
                    <div className="asset-row">
                      <span className="fs-lg">{tok.icon}</span>
                      <div>
                        <div className="asset-name">{tok.name}</div>
                        <div className="asset-sym">
                          <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                            className="c-c2 no-decoration">{tok.symbol} ↗</a>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">
                    {!walletAddress ? '—'
                      : tb?.loading ? '…'
                      : rawBal > 0n ? humanBal.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : isDeployer && tb?.error ? <span className="fs-xs c-r">Contract pending</span>
                      : <span className="fs-xs c-t4">0 {tok.symbol}</span>}
                  </td>
                  <td className="mono c-t3">—</td>
                  <td className="mono c-t3">—</td>
                  <td className={`mono ${rawBal > 0n ? 'c-o' : 'c-t3'}`}>—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!walletAddress && (
          <div className="empty-state-card mt-16">
            <div className="empty-state-icon">🔐</div>
            <div className="empty-state-title">Connect Wallet to View Portfolio</div>
            <div className="empty-state-desc">
              Link your OP_WALLET to see live BTC balance, OP-20 token holdings,
              and liquidity positions — all verified through OP_NET consensus.
            </div>
          </div>
        )}
        {walletAddress && (
          <div className="deploy-info">
            OP-20 balances fetched via <code>btc_call → balanceOf()</code> on OP_NET consensus.
            {' '}<a href={getTxUrl(MINE_DEPLOY_TXID)} target="_blank" rel="noopener noreferrer" className="c-c2">MINE deploy tx</a>
            {' · '}<a href={getTxUrl(VIBE_DEPLOY_TXID)} target="_blank" rel="noopener noreferrer" className="c-c2">VIBE deploy tx</a>
          </div>
        )}
      </div>

      {/* Liquidity Positions */}
      {walletAddress && POOL_ADDRESS && (
        <div className="P mt-12">
          <div className="Lb flex-center gap-8">
            🌊 Liquidity Positions
            {lpOnChain && <span className="tag tag-g fs-xs">On-Chain</span>}
            {!lpOnChain && hasLP && <span className="tag fs-xs lp-cached-tag">Cached</span>}
          </div>
          {lpLoading ? (
            <div className="lp-empty">Loading LP position...</div>
          ) : hasLP ? (
            <div className="flex-col gap-10">
              <div className="flex-center gap-10 flex-wrap">
                <div className="lp-card">
                  <div className="flex-between mb-8">
                    <div className="fw-700 c-w fs-md">MINE / VIBE</div>
                    <span className="lp-share-tag">{poolShare.toFixed(2)}% pool share</span>
                  </div>
                  <div className="lp-stat-row">
                    <span>Your MINE</span>
                    <span className="mono c-w">{lpMine.toLocaleString()}</span>
                  </div>
                  <div className="lp-stat-row">
                    <span>Your VIBE</span>
                    <span className="mono c-w">{lpVibe.toLocaleString()}</span>
                  </div>
                  <div className="lp-divider">
                    <div className="lp-reserve-row">
                      <span>Pool MINE reserve</span>
                      <span className="mono">{reserveA > 0 ? reserveA.toLocaleString() : '...'}</span>
                    </div>
                    <div className="lp-reserve-row mt-4">
                      <span>Pool VIBE reserve</span>
                      <span className="mono">{reserveB > 0 ? reserveB.toLocaleString() : '...'}</span>
                    </div>
                  </div>
                  <button onClick={refreshLP} disabled={lpLoading} className={`lp-refresh-btn ${lpLoading ? 'op-50' : ''}`}>
                    {lpLoading ? 'Refreshing...' : 'Refresh Position'}
                  </button>
                </div>
              </div>
              <div className="fs-xs c-t4">
                SimplePool v4 — LP position queried via <code>liquidityOf()</code> on-chain.
                {!lpOnChain && ' (fallback: cached data)'}
              </div>
            </div>
          ) : (
            <div className="lp-empty">
              No liquidity positions. Add liquidity in the <strong>Swap</strong> tab.
            </div>
          )}
        </div>
      )}

      {/* Transaction History */}
      {history.length > 0 && (
        <div className="P mt-12">
          <div className="Lb">📝 Transaction History</div>
          <div className="flex-col gap-4">
            {history.slice(0, 20).map(tx => (
              <div key={tx.id} className="tx-row">
                <span className="tx-icon">{tx.type === 'swap' ? '🔄' : tx.type === 'mint' ? '🪙' : '🎁'}</span>
                <div className="tx-info">
                  <div className="fw-700 c-w">
                    {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : tx.type === 'mint' ? `Minted ${Number(tx.amountA||0).toLocaleString()} ${tx.tokenA}` : `Claimed ${Number(tx.amountA||0).toLocaleString()} ${tx.tokenA}`}
                  </div>
                  <div className="fs-xs c-t4">{formatTimeAgo(tx.ts)}</div>
                </div>
                {tx.txHash && (
                  <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" className="tx-link">TX ↗</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(Portfolio);
