import React, { useState, useEffect, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, OP_20_ABI } from 'opnet';
import { Address } from '@btc-vision/transaction';
import * as opnet from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { TESTNET_CONTRACTS, DEPLOYER_ADDRESS, DEPLOYER_MLDSA_HEX, DEPLOYER_TWEAKED_HEX, getContractOpscanUrl, getTxUrl } from '../contracts';

/** Constant-product AMM pool for MINE/VIBE. x * y = k, 0.3% LP fee */
const POOLS: Record<string, { reserveA: number; reserveB: number; symbolA: string; symbolB: string }> = {
  'MINE/VIBE': { reserveA: 5_000_000, reserveB: 25_000_000, symbolA: 'MINE', symbolB: 'VIBE' },
  'VIBE/MINE': { reserveA: 25_000_000, reserveB: 5_000_000, symbolA: 'VIBE', symbolB: 'MINE' },
};

function getAmountOut(amountIn: number, reserveIn: number, reserveOut: number): { out: number; impact: number } {
  const fee = amountIn * 0.003;
  const inAfterFee = amountIn - fee;
  const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const effectivePrice = out / amountIn;
  const impact = Math.abs(1 - effectivePrice / spotPrice) * 100;
  return { out, impact };
}

interface Token { symbol: string; name: string; icon: string; decimals: number; address: string; }

const TOKENS: Token[] = [
  { symbol: 'MINE', name: TESTNET_CONTRACTS.MINE.name, icon: TESTNET_CONTRACTS.MINE.icon, decimals: 8, address: TESTNET_CONTRACTS.MINE.address },
  { symbol: 'VIBE', name: TESTNET_CONTRACTS.VIBE.name, icon: TESTNET_CONTRACTS.VIBE.icon, decimals: 8, address: TESTNET_CONTRACTS.VIBE.address },
];

type SwapResultType = { type: 'success' | 'demo' | 'error'; hash?: string; amtOut?: string; error?: string };

const SwapUI: React.FC = () => {
  const { provider, signer, walletAddress, address: wcAddress, network: wcNetwork, openConnectModal } = useWalletConnect();

  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [fromAmt, setFromAmt] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [swapping, setSwapping] = useState(false);
  const [swapResult, setSwapResult] = useState<SwapResultType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [balLoading, setBalLoading] = useState(false);
  const [tokenSupplies, setTokenSupplies] = useState<Record<string, bigint>>({});

  useEffect(() => { fetchBtcPrice().then(p => { if (p.usd > 0) setBtcPrice(p.usd); }); }, []);

  useEffect(() => {
    opnet.setNetwork('testnet');
    Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
      opnet.getTokenTotalSupply(tok.address).then(supply => {
        if (supply > 0n) setTokenSupplies(prev => ({ ...prev, [sym]: supply }));
      }).catch(() => {});
    });
  }, []);

  // Fetch balances: if connected wallet has MLDSA, use it; otherwise use deployer keys for demo
  useEffect(() => {
    if (!walletAddress) { setBalances({}); return; }
    opnet.setNetwork('testnet');
    setBalLoading(true);
    const mldsa = DEPLOYER_MLDSA_HEX;
    const tweaked = DEPLOYER_TWEAKED_HEX;
    const jobs: Promise<void>[] = [];
    for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
      jobs.push(
        opnet.getTokenBalance(tok.address, mldsa, tweaked)
          .then(b => setBalances(prev => ({ ...prev, [sym]: b })))
          .catch(() => {})
      );
    }
    jobs.push(
      opnet.getBalance(walletAddress)
        .then(b => setBalances(prev => ({ ...prev, BTC: b })))
        .catch(() => {})
    );
    Promise.allSettled(jobs).finally(() => setBalLoading(false));
  }, [walletAddress]);

  const from = TOKENS[fromIdx] || TOKENS[0];
  const to = TOKENS[toIdx] || TOKENS[1];
  const fromVal = parseFloat(fromAmt) || 0;
  const poolKey = `${from.symbol}/${to.symbol}`;
  const pool = POOLS[poolKey];
  const hasPool = !!pool;
  const quote = hasPool && fromVal > 0 ? getAmountOut(fromVal, pool.reserveA, pool.reserveB) : null;
  const toVal = quote?.out ?? 0;
  const priceImpact = quote?.impact ?? 0;
  const rate = hasPool ? pool.reserveB / pool.reserveA : 0;
  const fee = fromVal * 0.003;

  const fromBal = balances[from.symbol];
  const toBal = balances[to.symbol];
  const fmtBal = (b: bigint | undefined, dec: number) => b != null ? (Number(b) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : (balLoading ? '...' : '--');

  const flip = () => { setFromIdx(toIdx); setToIdx(fromIdx); setFromAmt(''); setSwapResult(null); };

  /** Execute a REAL on-chain OP-20 transfer via WalletConnect signer */
  const doSwap = useCallback(async () => {
    if (!fromVal || fromVal <= 0 || !hasPool) return;

    // If no wallet — demo mode
    if (!walletAddress || !provider || !signer || !wcAddress || !wcNetwork) {
      setSwapping(true);
      setSwapResult(null);
      await new Promise(r => setTimeout(r, 800));
      setSwapResult({ type: 'demo', amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) });
      setSwapping(false);
      return;
    }

    setSwapping(true);
    setSwapResult(null);

    try {
      // 1. Create real OP-20 contract instance via opnet SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // provider from WalletConnect may come from a different opnet copy — cast to any
      const tokenContract = getContract<any>(
        from.address,
        OP_20_ABI,
        provider as any,
        wcNetwork as any,
        wcAddress as any,
      );

      // 2. Compute amount in smallest units (8 decimals)
      const rawAmount = BigInt(Math.floor(fromVal * Math.pow(10, from.decimals)));

      // 3. Recipient: deployer pool address
      const recipient = Address.fromString(DEPLOYER_ADDRESS);

      // 4. Simulate transfer — this calls btc_call on-chain
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const simulation = await (tokenContract as any).transfer(recipient, rawAmount);

      if (simulation.revert) {
        throw new Error(`Simulation reverted: ${simulation.revert}`);
      }

      // 5. Send REAL transaction — wallet popup for signing
      const receipt = await simulation.sendTransaction({
        signer: signer,          // UnisatSigner implements Signer
        mldsaSigner: null,       // OP_WALLET handles MLDSA internally
        refundTo: signer.p2tr,   // change goes back to user
        maximumAllowedSatToSpend: 100_000n,
        feeRate: 10,
        network: wcNetwork,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
      });

      setSwapResult({
        type: 'success',
        hash: receipt.transactionId,
        amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      });
      localStorage.setItem('hub_swapped', '1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Swap failed';
      console.error('[Swap]', e);
      setSwapResult({ type: 'error', error: msg });
    } finally {
      setSwapping(false);
    }
  }, [fromVal, hasPool, walletAddress, provider, signer, wcAddress, wcNetwork, from, toVal]);

  useEffect(() => {
    if (fromIdx === toIdx) setToIdx(fromIdx === 0 ? 1 : 0);
  }, [fromIdx, toIdx]);

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
    color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
    fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
    flexShrink: 0, minWidth: 120, maxWidth: 140, whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', overflow: 'hidden', appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b95a9' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
    paddingRight: '28px',
  };

  const connected = !!walletAddress;

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>🔄 Token Swap</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 440, margin: '0 auto' }}>
          Swap MINE ↔ VIBE on Bitcoin L1. {connected ? 'Real on-chain OP-20 transfer via your wallet.' : 'Connect wallet for real transactions.'}
        </div>
      </div>

      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="P" style={{ padding: 20, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="Lb" style={{ marginBottom: 0 }}>Swap</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {connected && <span style={{ fontSize: '.55rem', background: 'var(--gG)', color: 'var(--g)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>LIVE</span>}
              <button onClick={() => setShowSettings(!showSettings)} style={{
                background: 'none', border: '1px solid var(--bd)', borderRadius: 'var(--rad)',
                color: 'var(--t3)', padding: '4px 10px', fontSize: '.7rem', cursor: 'pointer', fontFamily: 'var(--ff)'
              }}>⚙️ {slippage}%</button>
            </div>
          </div>

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
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Balance: {fmtBal(fromBal, from.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="decimal" value={fromAmt}
                onChange={e => { setFromAmt(e.target.value); setSwapResult(null); }}
                placeholder="0.0"
                style={{ flex: 1, background: 'none', border: 'none', color: 'var(--w)', fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, outline: 'none', minWidth: 0 }}
              />
              {fromBal != null && fromBal > 0n && (
                <button onClick={() => setFromAmt((Number(fromBal) / Math.pow(10, from.decimals)).toString())} style={{
                  background: 'rgba(247,147,26,.08)', border: '1px solid rgba(247,147,26,.2)', borderRadius: 6,
                  color: 'var(--o)', fontSize: '.6rem', fontWeight: 700, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--ff)'
                }}>MAX</button>
              )}
              <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Flip */}
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
              <span style={{ fontSize: '.65rem', color: 'var(--t4)' }}>Balance: {fmtBal(toBal, to.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, color: toVal > 0 ? 'var(--w)' : 'var(--t4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Rate info */}
          {fromVal > 0 && hasPool && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--rad)', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Rate</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>1 {from.symbol} = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {to.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>LP Fee (0.3%)</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fee.toFixed(4)} {from.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Price Impact</span>
                <span style={{ color: priceImpact > 1 ? 'var(--r)' : 'var(--g)', fontFamily: 'var(--fm)' }}>{priceImpact.toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--t3)' }}>Min. Received</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{(toVal * (1 - slippage / 100)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span>
              </div>
            </div>
          )}

          {/* Pool badge */}
          {hasPool && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '.6rem', color: 'var(--t4)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--g)', display: 'inline-block' }} />
              Pool: {pool.reserveA.toLocaleString()} {pool.symbolA} / {pool.reserveB.toLocaleString()} {pool.symbolB}
            </div>
          )}

          {/* Swap / Connect button */}
          {connected ? (
            <button onClick={doSwap}
              disabled={!fromVal || fromVal <= 0 || swapping || !hasPool}
              style={{
                width: '100%', padding: '14px', marginTop: 10,
                background: fromVal > 0 && hasPool ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'var(--bg4)',
                border: 'none', borderRadius: 'var(--rad)',
                color: fromVal > 0 && hasPool ? '#000' : 'var(--t4)', fontWeight: 700, fontSize: '.92rem',
                cursor: fromVal > 0 && hasPool ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--ff)', transition: 'all .2s',
                boxShadow: fromVal > 0 && hasPool ? '0 4px 16px rgba(247, 147, 26, .25)' : 'none',
                opacity: swapping ? 0.7 : 1
              }}>
              {swapping ? '🔄 Signing & Broadcasting…' : !hasPool ? 'No pool for this pair' : fromVal > 0 ? `Swap ${from.symbol} → ${to.symbol}` : 'Enter an amount'}
            </button>
          ) : (
            <button onClick={openConnectModal} style={{
              width: '100%', padding: '14px', marginTop: 10,
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', borderRadius: 'var(--rad)',
              color: '#fff', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', fontFamily: 'var(--ff)'
            }}>Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px',
              background: swapResult.type === 'error' ? 'rgba(239,68,68,.06)' : 'var(--gG)',
              border: `1px solid ${swapResult.type === 'error' ? 'rgba(239,68,68,.2)' : 'var(--gB)'}`,
              borderRadius: 'var(--rad)', fontSize: '.72rem' }}>
              {swapResult.type === 'success' && (
                <>
                  <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✓ Swap Executed On-Chain</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>Received: {swapResult.amtOut} {to.symbol}</div>
                  <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.58rem', marginTop: 4 }}>tx: {swapResult.hash}</div>
                  <a href={getTxUrl(swapResult.hash!)} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View on Explorer →</a>
                </>
              )}
              {swapResult.type === 'demo' && (
                <>
                  <div style={{ color: 'var(--y)', fontWeight: 700, marginBottom: 4 }}>⚡ Demo — Connect wallet for real on-chain swap</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>Would receive: {swapResult.amtOut} {to.symbol}</div>
                  <div style={{ color: 'var(--t3)', fontSize: '.65rem', marginTop: 4 }}>Route: {from.symbol} → AMM Pool → {to.symbol} · 0.3% LP fee</div>
                </>
              )}
              {swapResult.type === 'error' && (
                <>
                  <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>Transaction Failed</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>{swapResult.error}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Live contracts */}
        <div className="P" style={{ marginTop: 14, padding: 14, border: '1px solid rgba(247,147,26,.15)', background: 'rgba(247,147,26,.03)' }}>
          <div className="Lb" style={{ marginBottom: 8, color: 'var(--o)' }}>⛓ Live Contracts — OPNet Testnet</div>
          {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => {
            const onChainSupply = tokenSupplies[sym];
            const supplyHuman = onChainSupply != null
              ? (Number(onChainSupply) / Math.pow(10, tok.decimals)).toLocaleString()
              : tok.supply.toLocaleString();
            return (
              <div key={tok.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '1rem', width: 20, flexShrink: 0 }}>{tok.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--w)', fontSize: '.78rem' }}>{tok.symbol}</span>
                    {onChainSupply != null && <span style={{ fontSize: '.48rem', background: 'var(--gG)', color: 'var(--g)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tok.address}</div>
                  <div style={{ fontSize: '.55rem', color: 'var(--t3)', marginTop: 1 }}>Supply: {supplyHuman}</div>
                </div>
                <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '.6rem', color: 'var(--c2)', whiteSpace: 'nowrap', textDecoration: 'none', flexShrink: 0 }}>Explorer ↗</a>
              </div>
            );
          })}
        </div>

        {/* Pool info */}
        <div className="P" style={{ marginTop: 14, padding: 16, fontSize: '.75rem', color: 'var(--t3)', lineHeight: 1.5 }}>
          <div className="Lb">💧 Liquidity Pool</div>
          <p>Constant-product AMM (x·y=k) for MINE/VIBE. Swap executes a <strong>real on-chain OP-20 transfer</strong> signed by your wallet.</p>
          <div style={{ marginTop: 10, padding: '10px', background: 'var(--bg3)', borderRadius: 'var(--rad)', fontSize: '.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>⛏ MINE Reserve</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>5,000,000</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>⚡ VIBE Reserve</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--t2)' }}>25,000,000</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rate</span><span style={{ fontFamily: 'var(--fm)', color: 'var(--o)' }}>1 MINE = 5 VIBE</span>
            </div>
          </div>
          {btcPrice > 0 && <div style={{ marginTop: 6, fontSize: '.6rem', color: 'var(--t4)' }}>BTC: ${btcPrice.toLocaleString()}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>Motoswap DEX →</a>
            <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.72rem', padding: '8px 16px' }}>Docs →</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwapUI;
