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
  token.iconImg
    ? <img src={token.iconImg} alt={token.symbol} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <span style={{ fontSize: size * 0.7 }}>{token.icon}</span>;

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
    SWAP_TOKENS, heldTokens, heldTokensLoaded, motoPools,
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
      <div className="max-w-560">
        {/* ── Main tabs ── */}
        <div className="flex-center gap-4 mb-12">
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
            <div className="flex-between mb-14">
              <div>
                <div className="fw-800 fs-lg c-w">Liquidity Pools</div>
                <div className="fs-66 c-t4 mt-2">Create a pool for any OP20 token pair. Earn 0.3% fees on every swap. For BTC pools, use NativeSwap in the Liquidity modal.</div>
              </div>
              <button onClick={() => setCreatePoolOpen(v => !v)} className="lbtn fs-74 flex-shrink-0" style={{ padding: '9px 16px' }}>
                + Create Pool
              </button>
            </div>

            {/* Create pool form */}
            {createPoolOpen && (
              <div className="P p-18 mb-14">
                <div className="Lb mb-12">New Liquidity Pool</div>
                {/* Quick select tokens — only tokens user holds */}
                {walletAddress && heldTokensLoaded && heldTokens.length > 0 ? (
                  <div className="mb-8">
                    <div className="fs-2xs c-t4 mb-4 fw-600">Your tokens ({heldTokens.length})</div>
                    <div className="flex-center flex-wrap gap-4">
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
                  <div className="p-12 mb-8 text-center fs-66 c-t4 br-10 bd-w4" style={{ background: 'rgba(255,255,255,.02)' }}>
                    {!walletAddress ? 'Connect wallet to see your tokens' : !heldTokensLoaded ? 'Loading your tokens...' : 'No tokens found — enter addresses manually below'}
                  </div>
                )}

                <div className="grid-2col gap-10 mb-10">
                  <div>
                    <label className="lbl-xs d-block">Token A Address</label>
                    <input style={iStyle} value={poolTokenA} onChange={e => setPoolTokenA(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label className="lbl-xs d-block">Token B Address</label>
                    <input style={iStyle} value={poolTokenB} onChange={e => setPoolTokenB(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label className="lbl-xs d-block">Symbol A (optional)</label>
                    <input style={iStyle} value={poolSymA} onChange={e => setPoolSymA(e.target.value)} placeholder="e.g. MINE" />
                  </div>
                  <div>
                    <label className="lbl-xs d-block">Symbol B (optional)</label>
                    <input style={iStyle} value={poolSymB} onChange={e => setPoolSymB(e.target.value)} placeholder="e.g. VIBE" />
                  </div>
                </div>

                {poolDeployResult && (
                  <div className={`fs-68 mb-10 ${poolDeployResult.ok ? 'cc-result-ok' : 'cc-result-err'}`}>
                    {poolDeployResult.msg}
                    {poolDeployResult.address && (
                      <a href={getContractOpscanUrl(poolDeployResult.address)} target="_blank" rel="noopener noreferrer"
                        className="d-block mt-4 c-c2 fs-62">View on Explorer →</a>
                    )}
                  </div>
                )}

                <button onClick={createPool} disabled={deployingPool || !poolTokenA || !poolTokenB}
                  className="lbtn w-full" style={{ opacity: deployingPool ? 0.6 : 1 }}>
                  {deployingPool ? (poolDeployStep || 'Deploying...') : connected ? 'Deploy SimplePool' : 'Connect Wallet'}
                </button>
                <div className="mt-8 fs-2xs c-t4 text-center">
                  Deploys SimplePool.wasm on-chain. Costs ~100K sats gas. Earn 0.3% on all swaps in your pool.
                </div>
              </div>
            )}

            {/* System pool — always shown */}
            <div className="mb-8">
              <div className="lbl-xs mb-6">System Pools</div>
              <div className="bg3-bd-r14 p-14">
                <div className="flex-between mb-8">
                  <div className="flex-center gap-8">
                    <img src="/icons/token-mine.png" alt="MINE" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                    <img src="/icons/token-vibe.png" alt="VIBE" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', marginLeft: -6 }} />
                    <span className="fw-700 fs-84">MINE / VIBE</span>
                    <span className="tag-live-sm">LIVE</span>
                  </div>
                  <span className="fs-62 c-t4 text-mono">Fee: 0.3%</span>
                </div>
                <div className="grid-3col gap-8 fs-66">
                  <div className="pool-cell">
                    <div className="c-t4 mb-4">MINE</div>
                    <div className="mono-t2">{reserveA.toLocaleString()}</div>
                  </div>
                  <div className="pool-cell">
                    <div className="c-t4 mb-4">VIBE</div>
                    <div className="mono-t2">{reserveB.toLocaleString()}</div>
                  </div>
                  <div className="pool-cell">
                    <div className="c-t4 mb-4">Rate</div>
                    <div className="text-mono c-o fw-600">{reserveA > 0 ? (reserveB / reserveA).toFixed(1) : '—'}</div>
                  </div>
                </div>
                <div className="mt-8 flex-center gap-6">
                  <button onClick={() => { setMainTab('swap'); setShowLiquidity(true); }}
                    className="pool-add-btn">
                    💧 Add Liquidity
                  </button>
                  <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
                    className="pool-view-btn">
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
              <div className="mt-12">
                <div className="flex-center gap-6 mb-6">
                  <div className="lbl-xs">Motoswap Pools</div>
                  <span className="tag-count tag-purple">{motoPools.length} found</span>
                </div>
                {active.length > 0 ? (
                  <div className="flex-col-gap6">
                    {active.map(pool => {
                      const r0 = Number(BigInt(pool.reserve0)) / Math.pow(10, pool.token0_decimals);
                      const r1 = Number(BigInt(pool.reserve1)) / Math.pow(10, pool.token1_decimals);
                      const poolRate = r0 > 0 ? (r1 / r0).toFixed(4) : '—';
                      return (
                        <div key={pool.pool_pubkey} className="bg3-bd-r14 p-12">
                          <div className="flex-between mb-6">
                            <div className="flex-center gap-6">
                              <span className="fw-700 fs-80">{pool.token0_symbol} / {pool.token1_symbol}</span>
                              <span className="tag-moto">LIVE</span>
                            </div>
                            <span className="fs-56 text-mono c-p">Motoswap</span>
                          </div>
                          <div className="grid-3col gap-6 fs-62 mb-6">
                            <div className="text-center pool-cell-sm">
                              <div className="c-t4 mb-4 fs-2xs">{pool.token0_symbol}</div>
                              <div className="mono-t2">{r0 > 1000 ? (r0 / 1000).toFixed(1) + 'K' : r0.toFixed(2)}</div>
                            </div>
                            <div className="text-center pool-cell-sm">
                              <div className="c-t4 mb-4 fs-2xs">{pool.token1_symbol}</div>
                              <div className="mono-t2">{r1 > 1000 ? (r1 / 1000).toFixed(1) + 'K' : r1.toFixed(2)}</div>
                            </div>
                            <div className="text-center pool-cell-sm">
                              <div className="c-t4 mb-4 fs-2xs">Rate</div>
                              <div className="text-mono c-o fw-600">{poolRate}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center fs-66 c-t4 p-12 br-10 bd-w4" style={{ background: 'rgba(255,255,255,.02)' }}>
                    {empty.length} pools discovered but none have liquidity yet
                  </div>
                )}
                {empty.length > 0 && active.length > 0 && (
                  <div className="mt-6 fs-2xs c-t4 text-center">
                    + {empty.length} empty pools (no liquidity)
                  </div>
                )}
              </div>
              );
            })()}

            {/* User-created pools */}
            {userPools.length > 0 && (
              <div className="mt-12">
                <div className="lbl-xs mb-6">Your Pools</div>
                <div className="flex-col-gap8">
                  {userPools.map((pool: UserPool) => (
                    <div key={pool.address} className="bg3-bd-r14 p-14">
                      <div className="flex-between mb-6">
                        <span className="fw-700 fs-82">{pool.symbolA} / {pool.symbolB}</span>
                        <span className="fs-xxs c-t4 text-mono">
                          {new Date(pool.deployedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="fs-xs c-t4 word-break mb-8 text-mono">
                        {pool.address}
                      </div>
                      <div className="flex-center gap-6">
                        <a href={getContractOpscanUrl(pool.address)} target="_blank" rel="noopener noreferrer"
                          className="pool-view-btn">
                          View on OPScan ↗
                        </a>
                        <button onClick={() => removeUserPool(pool.address)}
                          className="pool-remove-btn">
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {userPools.length === 0 && !createPoolOpen && (
              <div className="text-center c-t4 fs-78 p-30-20">
                <div className="empty-icon">💧</div>
                No user pools yet. Create the first one for your token!
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════
             SWAP TAB
           ══════════════════════════════════ */}
        {mainTab === 'swap' && (<>
        <div className="swap-panel" role="form" aria-label="Token swap">
          <div className="flex-between mb-16">
            <div className="flex-center gap-8">
              <span className="swap-title">Swap</span>
              {connected && <span className="tag-live">LIVE</span>}
            </div>
            <div className="flex-center gap-6">
              <button onClick={() => { setShowLiquidity(!showLiquidity); setShowSettings(false); }}
                className={`swap-icon-btn ${showLiquidity ? 'active' : ''}`} aria-label="Toggle liquidity panel" aria-expanded={showLiquidity}>💧</button>
              <button onClick={() => { setShowSettings(!showSettings); setShowLiquidity(false); }}
                className="swap-icon-btn" aria-label={`Slippage settings, currently ${slippage}%`} aria-expanded={showSettings}>⚙ {slippage}%</button>
            </div>
          </div>

          {showSettings && (
            <div className="mb-12 bg3-rounded bd">
              <div className="fs-65 c-t3 mb-6 fw-600">Slippage Tolerance</div>
              <div className="flex-center gap-6">
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }}
                    className="slip-btn"
                    style={{
                      background: slippage === s ? 'rgba(247,147,26,.08)' : 'rgba(255,255,255,.04)',
                      border: `1px solid ${slippage === s ? 'rgba(247,147,26,.2)' : 'var(--bd)'}`,
                      color: slippage === s ? 'var(--o)' : 'var(--t2)',
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
            onRefresh={() => { void fetchReserves(); setBalRefreshKey(k => k + 1); }}
          />

          {/* From */}
          <div className="cc-panel mb-4">
            <div className="flex-between mb-8">
              <span className="fs-62 c-t4 fw-600">From</span>
              <span className="fs-62 c-t4">Balance: {fmtBal(fromBal, from.decimals)}</span>
            </div>
            <div className="flex-center gap-8">
              <input type="text" inputMode="decimal" value={fromAmt}
                onChange={e => { setFromAmt(e.target.value); setSwapResult(null); }}
                placeholder="0.0" className="swap-big-input"
                aria-label={`Amount of ${from.symbol} to swap`}
              />
              {fromBal != null && fromBal > 0n && (
                <button onClick={() => setFromAmt((Number(fromBal) / Math.pow(10, from.decimals)).toString())}
                  className="swap-max-btn" aria-label={`Use maximum ${from.symbol} balance`}>MAX</button>
              )}
              <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={selectStyle} aria-label="Select token to swap from">
                {SWAP_TOKENS.map((t: Token, i: number) => <option key={t.pubkey} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Flip */}
          <div className="flex-jc-center z-2 m-n6-0">
            <button onClick={flip} className="swap-flip-btn" aria-label="Swap token direction"
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div className="cc-panel mt-4">
            <div className="flex-between mb-8">
              <span className="fs-62 c-t4 fw-600">To (estimated)</span>
              <span className="fs-62 c-t4">Balance: {fmtBal(toBal, to.decimals)}</span>
            </div>
            <div className="flex-center gap-8">
              <div className="swap-out-val" style={{ color: toVal > 0 ? 'var(--w)' : 'var(--t4)' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={selectStyle} aria-label="Select token to receive">
                {SWAP_TOKENS.map((t: Token, i: number) => <option key={t.pubkey} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Rate info */}
          {fromVal > 0 && hasPool && (
            <div className="mt-12 bg3-rounded fs-72 bd">
              <div className="flex-between mb-4">
                <span className="c-t3">Rate</span>
                <span className="c-t2 text-mono">1 {from.symbol} = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {to.symbol}</span>
              </div>
              <div className="flex-between mb-4">
                <span className="c-t3">LP Fee (0.3%)</span>
                <span className="c-t2 text-mono">{fee.toFixed(4)} {from.symbol}</span>
              </div>
              <div className="flex-between mb-4">
                <span className="c-t3">Price Impact</span>
                <span className="text-mono" style={{ color: priceImpact > 1 ? 'var(--r)' : 'var(--g)' }}>{priceImpact.toFixed(2)}%</span>
              </div>
              <div className="flex-between">
                <span className="c-t3">Min. Received</span>
                <span className="c-t2 text-mono">{(toVal * (1 - slippage / 100)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span>
              </div>
            </div>
          )}

          {/* Pool badge */}
          {hasPool && (
            <div className="mt-8 flex-center gap-6 fs-xs c-t4">
              <span className="dot-live dot-green w-5 h-5" />
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
            <div className="btc-bar">
              <span className="c-t4">BTC Balance</span>
              <span className="text-mono" style={{ color: Number(balances.BTC) < 5000 ? 'var(--r)' : 'var(--t2)' }}>
                {(Number(balances.BTC) / 1e8).toFixed(6)} BTC ({Number(balances.BTC).toLocaleString()} sats)
                {Number(balances.BTC) < 5000 && <span className="c-r ml-4">· Need ~5K sats min</span>}
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
            <button onClick={openConnectModal} className="swap-connect-btn">Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div className={swapResult.type === 'error' ? 'result-err' : swapResult.type === 'pending' ? 'result-pending' : 'result-ok'} role="alert" aria-live="assertive">
              {swapResult.type === 'pending' && (
                <>
                  <div className="c-y fw-700 mb-4">TX Broadcast — Awaiting Confirmation</div>
                  <div className="c-t2 fs-70">Expected: ~{swapResult.amtOut} {to.symbol}</div>
                  {swapResult.hash && (
                    <a href={getTxUrl(swapResult.hash)} target="_blank" rel="noopener noreferrer"
                      className="c-c2 fs-65 mt-4 d-block no-decoration fw-600">View TX on OPScan ↗</a>
                  )}
                </>
              )}
              {swapResult.type === 'success' && (
                <>
                  <div className="c-g fw-700 mb-4">Swap Confirmed On-Chain</div>
                  <div className="c-t2 fs-70">Received: {swapResult.amtOut} {to.symbol}</div>
                  {swapResult.hash && (
                    <a href={getTxUrl(swapResult.hash)} target="_blank" rel="noopener noreferrer"
                      className="c-c2 fs-65 mt-4 d-block no-decoration fw-600">View TX on OPScan ↗</a>
                  )}
                </>
              )}
              {swapResult.type === 'error' && (
                <>
                  <div className="c-r fw-700 mb-4">Transaction Failed</div>
                  <div className="c-t2 fs-70">{swapResult.error}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Mint tokens */}
        <div className="cc-panel-sm mt-14">
          <div className="flex-center gap-8 mb-10">
            <span className="liq-label ls-06">Mint {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)} Tokens</span>
          </div>
          <div className="flex-center gap-8">
            {Object.entries(DEPLOYED_CONTRACTS).map(([sym]) => (
              <button key={sym} onClick={() => mintTokens(sym)} disabled={minting === sym}
                className="mint-btn" style={{ cursor: minting === sym ? 'wait' : 'pointer', opacity: minting === sym ? .5 : 1 }}>
                {minting === sym ? '...' : `1K ${sym}`}
              </button>
            ))}
          </div>
          {mintResult && (
            <div className={`mt-8 p-10 br-10 fs-65 word-break ${mintResult.ok ? 'cc-result-ok' : 'cc-result-err'}`} role="alert">
              {mintResult.msg}
              {mintResult.txHash && (
                <a href={getTxUrl(mintResult.txHash)} target="_blank" rel="noopener noreferrer"
                  className="ml-6 c-c2 no-decoration fw-600">View TX ↗</a>
              )}
            </div>
          )}
        </div>

        {/* Pool reserves + LP position compact */}
        <div className="cc-panel-sm mt-10">
          <div className="flex-between fs-sm">
            <span className="pool-stat-label">Pool</span>
            <span className="text-mono c-w fw-600">
              {reserveA.toLocaleString()} / {reserveB.toLocaleString()}
            </span>
          </div>
          {lpUserMine > 0 && reserveA > 0 && (
            <div className="flex-between fs-sm mt-6 pt-6 bd-b">
              <span className="pool-stat-label">Your LP</span>
              <span className="text-mono fw-700 c-sky">
                {((lpUserMine / reserveA) * 100).toFixed(2)}%
              </span>
            </div>
          )}
          <div className="flex-between fs-xxs mt-6 pt-6 bd-b">
            <span className="pool-stat-label">{poolReady ? 'Live' : 'Deploying...'}</span>
            <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
              className="pool-stat-label no-underline">OPScan ↗</a>
          </div>
        </div>

        {/* Recent tx — compact */}
        {history.length > 0 && (
          <div className="mt-10">
            {history.slice(0, 5).map(tx => (
              <div key={tx.id} className="flex-between bd-b fs-65 p-6-0">
                <span className="fw-600" style={{ color: '#7a8494' }}>
                  {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `+${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                </span>
                <span className="fs-55 c-t4">{formatTimeAgo(tx.ts)}</span>
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
