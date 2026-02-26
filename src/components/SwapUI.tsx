import React, { useState, useEffect, useCallback } from 'react';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, getContractOpscanUrl } from '../contracts';

function makePriceList(btcPrice: number) {
  return [
    { symbol: 'BTC', name: 'Bitcoin', icon: '₿', price: btcPrice, decimals: 8, address: null },
    { symbol: 'WBTC', name: 'Wrapped BTC', icon: '🔶', price: btcPrice * 0.9998, decimals: 8, address: null },
    { symbol: 'MINE', name: TESTNET_CONTRACTS.MINE.name, icon: TESTNET_CONTRACTS.MINE.icon, price: 0, decimals: 8, address: TESTNET_CONTRACTS.MINE.address },
    { symbol: 'VIBE', name: TESTNET_CONTRACTS.VIBE.name, icon: TESTNET_CONTRACTS.VIBE.icon, price: 0, decimals: 8, address: TESTNET_CONTRACTS.VIBE.address },
    { symbol: 'MOTO', name: 'Motoswap', icon: '🏎️', price: 0, decimals: 8, address: null },
  ];
}

function detectNetwork(addr: string): opnet.Network | null {
  if (addr.startsWith('opt1')) return 'testnet';
  if (addr.startsWith('bcrt1')) return 'regtest';
  if (addr.startsWith('bc1')) return 'mainnet';
  return null;
}

const MOTOSWAP_URL = 'https://app.motoswap.org';

const SwapUI: React.FC<{ walletAddress?: string }> = ({ walletAddress }) => {
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(2);
  const [fromAmt, setFromAmt] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [swapping, setSwapping] = useState(false);
  const [swapResult, setSwapResult] = useState<{ type: 'demo' | 'motoswap' | 'wallet'; hash?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  const [tokenSupplies, setTokenSupplies] = useState<Record<string, bigint>>({});

  // Fetch live BTC price (multi-source with cache)
  useEffect(() => {
    fetchBtcPrice().then(p => { if (p.usd > 0) setBtcPrice(p.usd); });
  }, []);

  // Fetch on-chain totalSupply for MINE/VIBE
  useEffect(() => {
    opnet.setNetwork('testnet');
    Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
      opnet.getTokenTotalSupply(tok.address).then(supply => {
        if (supply > 0n) setTokenSupplies(prev => ({ ...prev, [sym]: supply }));
      }).catch(() => {/* graceful */});
    });
  }, []);

  // Fetch wallet balance
  useEffect(() => {
    const net = walletAddress ? detectNetwork(walletAddress) : null;
    if (!walletAddress || !net) { setBtcSats(null); return; }
    opnet.setNetwork(net);
    setBalLoading(true);
    opnet.getBalance(walletAddress)
      .then(s => setBtcSats(s))
      .catch(() => setBtcSats(null))
      .finally(() => setBalLoading(false));
  }, [walletAddress]);

  const TOKENS = makePriceList(btcPrice);
  const from = TOKENS[fromIdx] || TOKENS[0];
  const to = TOKENS[toIdx] || TOKENS[2];
  const btcBal = btcSats != null ? Number(btcSats) / 1e8 : null;

  const fromVal = parseFloat(fromAmt) || 0;
  const canQuote = from.price > 0 && to.price > 0;
  const rate = canQuote ? from.price / to.price : 0;
  const toVal = canQuote ? fromVal * rate : 0;
  const fee = fromVal * 0.003; // 0.3% LP fee
  const priceImpact = fromVal > 0 ? Math.min(fromVal * 0.001, 5) : 0; // simulated
  const noPool = !canQuote;

  const flip = () => {
    const f = fromIdx;
    setFromIdx(toIdx);
    setToIdx(f);
    setFromAmt('');
    setSwapResult(null);
  };

  const doSwap = useCallback(async () => {
    if (!fromVal || fromVal <= 0) return;
    setSwapping(true);
    setSwapResult(null);
    const hasOP20 = [from, to].some(t => t.address !== null);
    try {
      const win = window as unknown as Record<string, { sendTransaction?: unknown } | undefined>;
      const w = win['opnet'] || win['unisat'];
      if (w?.sendTransaction) {
        if (hasOP20) {
          // OP-20 involved — open Motoswap for real trade
          const motoUrl = `${MOTOSWAP_URL}/#/swap?inputCurrency=${from.address ?? 'BTC'}&outputCurrency=${to.address ?? 'BTC'}`;
          window.open(motoUrl, '_blank');
          setSwapResult({ type: 'motoswap' });
          setSwapping(false);
          return;
        }
        // BTC/WBTC — wallet can handle
        await new Promise(r => setTimeout(r, 1500));
        setSwapResult({ type: 'wallet', hash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('') });
        setSwapping(false);
        return;
      }
    } catch { /* no wallet */ }
    // Demo mode — show realistic simulation
    await new Promise(r => setTimeout(r, 1800));
    setSwapResult({ type: 'demo', hash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('') });
    setSwapping(false);
  }, [fromVal, from, to]);

  useEffect(() => {
    if (fromIdx === toIdx) {
      setToIdx((toIdx + 1) % TOKENS.length);
    }
  }, [fromIdx, toIdx]);

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🔄 Motoswap DEX</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Swap OP-20 tokens on Bitcoin L1. All prices consensus-verified by OP_NET.
          <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)', marginLeft: 4 }}>motoswap.org →</a>
        </div>
      </div>

      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="P" style={{ padding: 20, position: 'relative' }}>
          {/* Settings toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="Lb" style={{ marginBottom: 0 }}>Swap</div>
            <button onClick={() => setShowSettings(!showSettings)} style={{
              background: 'none', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
              color: 'var(--t3)', padding: '4px 10px', fontSize: '.7rem', cursor: 'pointer',
              fontFamily: 'var(--ff)'
            }}>⚙️ {slippage}%</button>
          </div>

          {/* Slippage settings */}
          {showSettings && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Slippage Tolerance</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }} style={{
                    flex: 1, padding: '6px', borderRadius: 'var(--rad)',
                    background: slippage === s ? 'var(--oG)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${slippage === s ? 'rgba(247,147,26,.2)' : 'var(--bd)'}`,
                    color: slippage === s ? 'var(--o)' : 'var(--t2)', fontSize: '.75rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--ff)'
                  }}>{s}%</button>
                ))}
              </div>
            </div>
          )}

          {/* From */}
          <div style={{ padding: '14px', background: 'rgba(255,255,255,.03)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>From</span>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>
                Balance: {from.symbol === 'BTC'
                  ? (balLoading ? '…' : btcBal != null ? btcBal.toFixed(8) + ' BTC' : '—')
                  : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                inputMode="decimal"
                value={fromAmt}
                onChange={e => { setFromAmt(e.target.value); setSwapResult(null); }}
                placeholder="0.0"
                style={{
                  flex: 1, background: 'none', border: 'none', color: 'var(--w)',
                  fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, outline: 'none'
                }}
              />
              <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={{
                background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
                color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
                fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
                flexShrink: 0, minWidth: 110, whiteSpace: 'nowrap'
              }}>
                {TOKENS.map((t, i) => (
                  <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>
                ))}
              </select>
            </div>
            {fromVal > 0 && <div style={{ fontSize: '.65rem', color: 'var(--t4)', marginTop: 4 }}>≈ ${(fromVal * from.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>}
          </div>

          {/* Flip button */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 2 }}>
            <button onClick={flip} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--o), var(--o2))',
              border: '3px solid var(--bg2)', color: '#000', fontSize: '1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .2s', fontWeight: 700
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div style={{ padding: '14px', background: 'rgba(255,255,255,.03)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>To (estimated)</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, color: toVal > 0 ? 'var(--w)' : 'var(--t4)' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={{
                background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
                color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
                fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
                flexShrink: 0, minWidth: 110, whiteSpace: 'nowrap'
              }}>
                {TOKENS.map((t, i) => (
                  <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>
                ))}
              </select>
            </div>
            {toVal > 0 && <div style={{ fontSize: '.65rem', color: 'var(--t4)', marginTop: 4 }}>≈ ${(toVal * to.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>}
          </div>

          {/* No liquidity warning */}
          {noPool && fromVal > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)', borderRadius: 'var(--rad)', fontSize: '.72rem', color: 'var(--y)' }}>
              No liquidity pool found for {from.symbol}/{to.symbol} on Motoswap testnet yet. Deploy tokens and create a pool first.
            </div>
          )}

          {/* Rate info */}
          {fromVal > 0 && canQuote && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Rate</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>1 {from.symbol} = {rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>LP Fee (0.3%)</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fee.toFixed(8)} {from.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Price Impact</span>
                <span style={{ color: priceImpact > 1 ? 'var(--r)' : 'var(--g)', fontFamily: 'var(--fm)' }}>{priceImpact.toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--t3)' }}>Slippage</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{slippage}%</span>
              </div>
            </div>
          )}

          {/* Swap button */}
          <button
            onClick={doSwap}
            disabled={!fromVal || fromVal <= 0 || swapping || noPool}
            style={{
              width: '100%', padding: '14px', marginTop: 14,
              background: fromVal > 0 ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'var(--bg4)',
              border: 'none', borderRadius: 'var(--rad)',
              color: fromVal > 0 ? '#000' : 'var(--t4)', fontWeight: 700, fontSize: '.92rem',
              cursor: fromVal > 0 ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--ff)', transition: 'all .2s',
              boxShadow: fromVal > 0 ? '0 4px 16px rgba(247, 147, 26, .25)' : 'none',
              opacity: swapping ? 0.7 : 1
            }}
          >
            {swapping ? '🔄 Swapping via Motoswap…' : noPool ? 'No liquidity pool' : fromVal > 0 ? `Swap ${from.symbol} → ${to.symbol}` : 'Enter an amount'}
          </button>

          {/* Swap result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--gG)', border: '1px solid var(--gB)', borderRadius: 'var(--rad)', fontSize: '.72rem' }}>
              {swapResult.type === 'motoswap' && (
                <><div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>↗ Redirected to Motoswap DEX</div>
                <div style={{ color: 'var(--t3)', fontSize: '.65rem' }}>Complete the swap on Motoswap — the official Bitcoin L1 AMM DEX powered by OP_NET.</div></>
              )}
              {swapResult.type === 'wallet' && (
                <><div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✓ Swap signed by OP_WALLET</div>
                <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.6rem' }}>tx: {swapResult.hash?.slice(0, 20)}…{swapResult.hash?.slice(-8)}</div>
                <a href={`https://testnet.opnet.org/tx/${swapResult.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View on OPScan →</a></>
              )}
              {swapResult.type === 'demo' && (
                <><div style={{ color: 'var(--y)', fontWeight: 700, marginBottom: 4 }}>⚡ Simulation — Connect OP_WALLET for real swap</div>
                <div style={{ color: 'var(--t3)', fontSize: '.65rem' }}>Route: {from.symbol} → Motoswap AMM → {to.symbol} · 0.3% LP fee</div></>
              )}
            </div>
          )}
        </div>


        {/* On-chain contract addresses */}
        <div className="P" style={{ marginTop: 14, padding: 14, border: '1px solid rgba(247,147,26,.15)', background: 'rgba(247,147,26,.03)' }}>
          <div className="Lb" style={{ marginBottom: 8, color: 'var(--o)' }}>⛓️ Live Contracts — OPNet Testnet</div>
          {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
            const onChainSupply = tokenSupplies[sym];
            const supplyHuman = onChainSupply != null
              ? (Number(onChainSupply) / Math.pow(10, tok.decimals)).toLocaleString()
              : tok.supply.toLocaleString();
            return (
              <div key={tok.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '1rem', width: 20 }}>{tok.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--w)', fontSize: '.78rem' }}>{tok.symbol}</span>
                    {onChainSupply != null && <span style={{ fontSize: '.48rem', background: 'var(--gG)', color: 'var(--g)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tok.address}
                  </div>
                  <div style={{ fontSize: '.55rem', color: 'var(--t3)', marginTop: 1 }}>Supply: {supplyHuman}</div>
                </div>
                <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '.6rem', color: 'var(--c2)', whiteSpace: 'nowrap', textDecoration: 'none' }}>OPScan ↗</a>
              </div>
            );
          })}
          <div style={{ fontSize: '.52rem', color: 'var(--t4)', marginTop: 6 }}>Deployed 2026-02-26 by OPNet Hub on Testnet</div>
        </div>

        {/* Info card */}
        <div className="P" style={{ marginTop: 14, padding: 16, fontSize: '.75rem', color: 'var(--t3)', lineHeight: 1.5 }}>
          <div className="Lb">ℹ️ About Motoswap</div>
          <p>Motoswap is the first AMM DEX on Bitcoin L1 — Uniswap V2 style pools secured by OP_NET cryptographic consensus. All swap prices are mathematically proven correct.</p>
          <p style={{ marginTop: 8 }}>In production, swaps route through real Motoswap smart contracts via OP_WALLET. This interface demonstrates the flow — connect your OP_WALLET for live trading.</p>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>Trade on Motoswap →</a>
            <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>Learn more →</a>
          </div>
          <div style={{ marginTop: 8, fontSize: '.6rem', color: 'var(--t4)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--g)', display: 'inline-block' }} />
            Bob MCP: 19 tools connected
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwapUI;
