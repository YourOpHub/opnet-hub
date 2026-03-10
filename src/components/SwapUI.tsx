import React from 'react';
import { CURRENT_ENV } from '../config';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS, getContractOpscanUrl } from '../contracts';
import LiquidityModal from './LiquidityModal';
import {
  useSwap,
  type Token,
  type UserPool,
  getTxUrl,
  formatTimeAgo,
} from '../hooks/useSwap';

const TokenIcon: React.FC<{ token: Token; size?: number }> = ({ token, size = 24 }) =>
  <span style={{ fontSize: size * 0.7 }}>{token.icon}</span>;

const selectStyle: React.CSSProperties = {
  background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: '14px',
  color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
  fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
  flexShrink: 0, minWidth: 120, maxWidth: 140, whiteSpace: 'nowrap',
  textOverflow: 'ellipsis', overflow: 'hidden', appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b95a9' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  paddingRight: '28px',
};

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box' as const,
};

const SwapUI: React.FC = () => {
  const {
    walletAddress, connected, openConnectModal,
    SWAP_TOKENS, heldTokens, motoPools,
    reserveA, reserveB, fetchReserves, poolReady,
    fromIdx, setFromIdx, toIdx, setToIdx, fromAmt, setFromAmt,
    slippage, setSlippage, swapping, swapStep, swapResult, setSwapResult,
    showSettings, setShowSettings,
    balances,
    from, to, fromVal, toVal,
    hasPool, rIn, rOut, isSimplePool, motoPool,
    priceImpact, rate, fee,
    fromBal, toBal, fmtBal,
    flip, doSwap,
    minting, mintResult, mintTokens,
    history,
    mainTab, setMainTab,
    userPools, removeUserPool, createPoolOpen, setCreatePoolOpen,
    poolTokenA, setPoolTokenA, poolTokenB, setPoolTokenB,
    poolSymA, setPoolSymA, poolSymB, setPoolSymB,
    deployingPool, poolDeployStep, poolDeployResult, createPool,
    showLiquidity, setShowLiquidity,
    lpUserMine,
    setBalRefreshKey,
  } = useSwap();

  return (
    <div>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* ── Main tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['swap', 'pools'] as const).map(t => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ padding: '9px 22px', borderRadius: 12, border: '1px solid ' + (mainTab === t ? 'rgba(247,147,26,.4)' : 'var(--bd)'),
                background: mainTab === t ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
                color: mainTab === t ? 'var(--o)' : 'var(--t3)',
                fontSize: '.8rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700, textTransform: 'capitalize' as const }}>
              {t === 'swap' ? 'Swap' : 'Pools'}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════
             POOLS TAB
           ══════════════════════════════════ */}
        {mainTab === 'pools' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>Liquidity Pools</div>
                <div style={{ fontSize: '.66rem', color: 'var(--t4)', marginTop: 2 }}>Create a pool for any OP20 token pair. Earn 0.3% fees on every swap. For BTC pools, use NativeSwap in the Liquidity modal.</div>
              </div>
              <button onClick={() => setCreatePoolOpen(v => !v)} className="lbtn" style={{ padding: '9px 16px', fontSize: '.74rem', flexShrink: 0 }}>
                + Create Pool
              </button>
            </div>

            {/* Create pool form */}
            {createPoolOpen && (
              <div className="P" style={{ padding: 18, marginBottom: 14 }}>
                <div className="Lb" style={{ marginBottom: 12 }}>New Liquidity Pool</div>
                {/* Quick select tokens — only tokens user holds */}
                {walletAddress && heldTokens.length > 0 ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '.54rem', color: 'var(--t4)', marginBottom: 4, fontWeight: 600 }}>Your tokens ({heldTokens.length})</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {heldTokens.map((t: Token) => (
                        <button key={t.address} onClick={() => {
                          if (!poolTokenA) { setPoolTokenA(t.address); setPoolSymA(t.symbol); }
                          else if (poolTokenA !== t.address && !poolTokenB) { setPoolTokenB(t.address); setPoolSymB(t.symbol); }
                        }} style={{
                          padding: '4px 10px', borderRadius: 8,
                          border: `1px solid ${poolTokenA === t.address || poolTokenB === t.address ? 'rgba(247,147,26,.3)' : 'rgba(255,255,255,.08)'}`,
                          background: poolTokenA === t.address || poolTokenB === t.address ? 'rgba(247,147,26,.08)' : 'rgba(255,255,255,.03)',
                          color: poolTokenA === t.address || poolTokenB === t.address ? 'var(--o)' : '#8b95a9',
                          cursor: 'pointer', fontSize: '.6rem', fontWeight: 600, fontFamily: 'var(--ff)',
                        }}>
                          <TokenIcon token={t} size={16} /> {t.symbol}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '12px', marginBottom: 8, textAlign: 'center', fontSize: '.66rem', color: 'var(--t4)',
                    background: 'rgba(255,255,255,.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,.04)' }}>
                    {!walletAddress ? 'Connect wallet to see your tokens' : 'Loading your tokens...'}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Token A Address</label>
                    <input style={iStyle} value={poolTokenA} onChange={e => setPoolTokenA(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Token B Address</label>
                    <input style={iStyle} value={poolTokenB} onChange={e => setPoolTokenB(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Symbol A (optional)</label>
                    <input style={iStyle} value={poolSymA} onChange={e => setPoolSymA(e.target.value)} placeholder="e.g. MINE" />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Symbol B (optional)</label>
                    <input style={iStyle} value={poolSymB} onChange={e => setPoolSymB(e.target.value)} placeholder="e.g. VIBE" />
                  </div>
                </div>

                {poolDeployResult && (
                  <div style={{ padding: '9px 12px', borderRadius: 10, fontSize: '.68rem', marginBottom: 10,
                    background: poolDeployResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                    color: poolDeployResult.ok ? 'var(--g)' : '#ef4444',
                    border: '1px solid ' + (poolDeployResult.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)') }}>
                    {poolDeployResult.msg}
                    {poolDeployResult.address && (
                      <a href={getContractOpscanUrl(poolDeployResult.address)} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', marginTop: 4, color: 'var(--c2)', fontSize: '.62rem' }}>View on Explorer →</a>
                    )}
                  </div>
                )}

                <button onClick={createPool} disabled={deployingPool || !poolTokenA || !poolTokenB}
                  className="lbtn" style={{ width: '100%', opacity: deployingPool ? 0.6 : 1 }}>
                  {deployingPool ? (poolDeployStep || 'Deploying...') : connected ? 'Deploy SimplePool' : 'Connect Wallet'}
                </button>
                <div style={{ marginTop: 8, fontSize: '.56rem', color: 'var(--t4)', textAlign: 'center' }}>
                  Deploys SimplePool.wasm on-chain. Costs ~100K sats gas. Earn 0.3% on all swaps in your pool.
                </div>
              </div>
            )}

            {/* System pool — always shown */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>System Pools</div>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '.84rem' }}>⛏️ MINE / ⚡ VIBE</span>
                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: '.52rem', background: 'rgba(16,185,129,.1)', color: 'var(--g)', fontWeight: 700 }}>LIVE</span>
                  </div>
                  <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>Fee: 0.3%</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: '.66rem' }}>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>MINE</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{reserveA.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>VIBE</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{reserveB.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>Rate</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600 }}>{reserveA > 0 ? (reserveB / reserveA).toFixed(1) : '—'}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <button onClick={() => { setMainTab('swap'); setShowLiquidity(true); }}
                    style={{ flex: 1, padding: '7px', borderRadius: 9, border: '1px solid rgba(14,165,233,.2)', background: 'rgba(14,165,233,.05)', color: '#0ea5e9', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 600 }}>
                    💧 Add Liquidity
                  </button>
                  <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, padding: '7px', borderRadius: 9, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t4)', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    OPScan ↗
                  </a>
                </div>
              </div>
            </div>

            {/* Motoswap discovered pools */}
            {motoPools.length > 0 && (() => {
              const active = motoPools.filter(p => p.reserve0 !== '0' && p.reserve1 !== '0');
              const empty = motoPools.filter(p => p.reserve0 === '0' || p.reserve1 === '0');
              return (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Motoswap Pools</div>
                  <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: '.48rem', background: 'rgba(139,92,246,.1)', color: '#a78bfa', fontWeight: 700 }}>{motoPools.length} found</span>
                </div>
                {active.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {active.map(pool => {
                      const r0 = Number(BigInt(pool.reserve0)) / Math.pow(10, pool.token0_decimals);
                      const r1 = Number(BigInt(pool.reserve1)) / Math.pow(10, pool.token1_decimals);
                      const poolRate = r0 > 0 ? (r1 / r0).toFixed(4) : '—';
                      return (
                        <div key={pool.pool_pubkey} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 700, fontSize: '.8rem' }}>{pool.token0_symbol} / {pool.token1_symbol}</span>
                              <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: '.48rem', background: 'rgba(16,185,129,.08)', color: 'var(--g)', fontWeight: 700 }}>LIVE</span>
                            </div>
                            <span style={{ fontSize: '.56rem', color: '#a78bfa', fontFamily: 'var(--fm)' }}>Motoswap</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: '.62rem', marginBottom: 6 }}>
                            <div style={{ textAlign: 'center', padding: '5px', background: 'rgba(255,255,255,.02)', borderRadius: 7 }}>
                              <div style={{ color: 'var(--t4)', marginBottom: 1, fontSize: '.52rem' }}>{pool.token0_symbol}</div>
                              <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{r0 > 1000 ? (r0 / 1000).toFixed(1) + 'K' : r0.toFixed(2)}</div>
                            </div>
                            <div style={{ textAlign: 'center', padding: '5px', background: 'rgba(255,255,255,.02)', borderRadius: 7 }}>
                              <div style={{ color: 'var(--t4)', marginBottom: 1, fontSize: '.52rem' }}>{pool.token1_symbol}</div>
                              <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{r1 > 1000 ? (r1 / 1000).toFixed(1) + 'K' : r1.toFixed(2)}</div>
                            </div>
                            <div style={{ textAlign: 'center', padding: '5px', background: 'rgba(255,255,255,.02)', borderRadius: 7 }}>
                              <div style={{ color: 'var(--t4)', marginBottom: 1, fontSize: '.52rem' }}>Rate</div>
                              <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600 }}>{poolRate}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '.66rem', color: 'var(--t4)', background: 'rgba(255,255,255,.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,.04)' }}>
                    {empty.length} pools discovered but none have liquidity yet
                  </div>
                )}
                {empty.length > 0 && active.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: '.54rem', color: 'var(--t4)', textAlign: 'center' }}>
                    + {empty.length} empty pools (no liquidity)
                  </div>
                )}
              </div>
              );
            })()}

            {/* User-created pools */}
            {userPools.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Your Pools</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {userPools.map((pool: UserPool) => (
                    <div key={pool.address} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: '.82rem' }}>{pool.symbolA} / {pool.symbolB}</span>
                        <span style={{ fontSize: '.56rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
                          {new Date(pool.deployedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '.6rem', color: 'var(--t4)', wordBreak: 'break-all', marginBottom: 8, fontFamily: 'var(--fm)' }}>
                        {pool.address}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a href={getContractOpscanUrl(pool.address)} target="_blank" rel="noopener noreferrer"
                          style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid var(--bd)', color: 'var(--t4)', fontSize: '.64rem', textAlign: 'center', textDecoration: 'none', fontFamily: 'var(--ff)' }}>
                          View on OPScan ↗
                        </a>
                        <button onClick={() => removeUserPool(pool.address)}
                          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)', color: '#ef4444', fontSize: '.64rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {userPools.length === 0 && !createPoolOpen && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--t4)', fontSize: '.78rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>💧</div>
                No user pools yet. Create the first one for your token!
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════
             SWAP TAB
           ══════════════════════════════════ */}
        {mainTab === 'swap' && (<>
        <div style={{
          padding: '24px 22px', position: 'relative', borderRadius: 22,
          background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.06)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '.95rem', fontWeight: 800, color: 'var(--w)', letterSpacing: '-.02em' }}>Swap</span>
              {connected && <span style={{ fontSize: '.5rem', background: 'rgba(16,185,129,.08)', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>LIVE</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => { setShowLiquidity(!showLiquidity); setShowSettings(false); }} style={{
                background: showLiquidity ? 'rgba(14,165,233,.1)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (showLiquidity ? 'rgba(14,165,233,.25)' : 'rgba(255,255,255,.06)'), borderRadius: 10,
                color: showLiquidity ? '#0ea5e9' : 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>💧</button>
              <button onClick={() => { setShowSettings(!showSettings); setShowLiquidity(false); }} style={{
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10,
                color: 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>⚙ {slippage}%</button>
            </div>
          </div>

          {showSettings && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Slippage Tolerance</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }} style={{
                    flex: 1, padding: '6px', borderRadius: '14px',
                    background: slippage === s ? 'rgba(247,147,26,.08)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${slippage === s ? 'rgba(247,147,26,.2)' : 'var(--bd)'}`,
                    color: slippage === s ? 'var(--o)' : 'var(--t2)', fontSize: '.75rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--ff)'
                  }}>{s}%</button>
                ))}
              </div>
            </div>
          )}

          {/* Liquidity Modal */}
          <LiquidityModal
            open={showLiquidity}
            onClose={() => setShowLiquidity(false)}
            reserveA={reserveA}
            reserveB={reserveB}
            balances={balances}
            onRefresh={() => { fetchReserves(); setBalRefreshKey(k => k + 1); }}
          />

          {/* From */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>From</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(fromBal, from.decimals)}</span>
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
                {SWAP_TOKENS.map((t: Token, i: number) => <option key={t.pubkey} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Flip */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0', position: 'relative', zIndex: 2 }}>
            <button onClick={flip} style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--o), var(--o2))',
              border: '3px solid rgba(10,10,18,.8)', color: '#000', fontSize: '.9rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .25s cubic-bezier(.4,0,.2,1)', fontWeight: 700,
              boxShadow: '0 2px 12px rgba(247,147,26,.2)',
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>To (estimated)</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(toBal, to.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, color: toVal > 0 ? 'var(--w)' : 'var(--t4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={selectStyle}>
                {SWAP_TOKENS.map((t: Token, i: number) => <option key={t.pubkey} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Rate info */}
          {fromVal > 0 && hasPool && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
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
              {isSimplePool
                ? `Pool: ${reserveA.toLocaleString()} MINE / ${reserveB.toLocaleString()} VIBE (SimplePool)`
                : motoPool
                  ? `Motoswap: ${rIn.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${from.symbol} / ${rOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to.symbol}`
                  : 'Pool active'
              }
            </div>
          )}

          {/* BTC Balance indicator */}
          {connected && balances.BTC != null && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 10, fontSize: '.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--t4)' }}>BTC Balance</span>
              <span style={{ fontFamily: 'var(--fm)', color: Number(balances.BTC) < 5000 ? 'var(--r)' : 'var(--t2)' }}>
                {(Number(balances.BTC) / 1e8).toFixed(6)} BTC ({Number(balances.BTC).toLocaleString()} sats)
                {Number(balances.BTC) < 5000 && <span style={{ color: 'var(--r)', marginLeft: 4 }}>· Need ~5K sats min</span>}
              </span>
            </div>
          )}

          {/* Swap / Connect button */}
          {connected ? (
            <button onClick={doSwap}
              disabled={!fromVal || fromVal <= 0 || swapping || !hasPool}
              style={{
                width: '100%', padding: '14px', marginTop: 10,
                background: fromVal > 0 && hasPool ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'rgba(30,30,50,.8)',
                border: 'none', borderRadius: '14px',
                color: fromVal > 0 && hasPool ? '#000' : 'var(--t4)', fontWeight: 700, fontSize: '.92rem',
                cursor: fromVal > 0 && hasPool ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--ff)', transition: 'all .2s',
                boxShadow: fromVal > 0 && hasPool ? '0 4px 16px rgba(247, 147, 26, .25)' : 'none',
                opacity: swapping ? 0.7 : 1
              }}>
              {swapping ? (swapStep || 'Processing...') : !hasPool ? 'No pool for this pair' : fromVal > 0 ? `Swap ${from.symbol} → ${to.symbol}${motoPool && !isSimplePool ? ' (Motoswap)' : ''}` : 'Enter an amount'}
            </button>
          ) : (
            <button onClick={openConnectModal} style={{
              width: '100%', padding: '14px', marginTop: 10,
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', borderRadius: '14px',
              color: '#fff', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', fontFamily: 'var(--ff)'
            }}>Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px',
              background: swapResult.type === 'error' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
              border: `1px solid ${swapResult.type === 'error' ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.15)'}`,
              borderRadius: '14px', fontSize: '.72rem' }}>
              {swapResult.type === 'success' && (
                <>
                  <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✓ Swap Executed On-Chain</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>Received: {swapResult.amtOut} {to.symbol}</div>
                  <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.58rem', marginTop: 4 }}>tx: {swapResult.hash}</div>
                  <a href={getTxUrl(swapResult.hash!)} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View on Explorer →</a>
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

        {/* Mint tokens */}
        <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: '.52rem', color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Mint {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)} Tokens</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(DEPLOYED_CONTRACTS).map(([sym]) => (
              <button key={sym} onClick={() => mintTokens(sym)} disabled={minting === sym}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: minting === sym ? 'wait' : 'pointer',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff',
                  fontSize: '.68rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", opacity: minting === sym ? .5 : 1,
                }}>
                {minting === sym ? '...' : `1K ${sym}`}
              </button>
            ))}
          </div>
          {mintResult && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, fontSize: '.65rem', wordBreak: 'break-all',
              background: mintResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
              color: mintResult.ok ? '#10b981' : '#ef4444' }}>
              {mintResult.msg}
            </div>
          )}
        </div>

        {/* Pool reserves + LP position compact */}
        <div style={{ marginTop: 10, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem' }}>
            <span style={{ color: '#4a5568' }}>Pool</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 600 }}>
              {reserveA.toLocaleString()} / {reserveB.toLocaleString()}
            </span>
          </div>
          {lpUserMine > 0 && reserveA > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
              <span style={{ color: '#4a5568' }}>Your LP</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#0ea5e9', fontWeight: 700 }}>
                {((lpUserMine / reserveA) * 100).toFixed(2)}%
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.58rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
            <span style={{ color: '#2d3548' }}>{poolReady ? 'Live' : 'Deploying...'}</span>
            <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
              style={{ color: '#4a5568', textDecoration: 'none' }}>OPScan ↗</a>
          </div>
        </div>

        {/* Recent tx — compact */}
        {history.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {history.slice(0, 5).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.65rem' }}>
                <span style={{ color: '#7a8494', fontWeight: 600 }}>
                  {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `+${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                </span>
                <span style={{ color: '#2d3548', fontSize: '.55rem' }}>{formatTimeAgo(tx.ts)}</span>
              </div>
            ))}
          </div>
        )}
        </>)} {/* end mainTab === 'swap' */}
      </div>
    </div>
  );
};

export default SwapUI;
