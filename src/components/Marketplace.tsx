import React from 'react';
import { fmtNum, hashColor, genLogo } from '../launchpad/types';
import {
  useMarketplace,
  type Order,
  type MarketToken,
  getContractOpscanUrl,
  getTxUrl,
  MARKET_ADDRESS,
} from '../hooks/useMarketplace';

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box' as const,
};

/* ═══════════════════════════════════════════════════════════════
   MARKETPLACE — per-token orderbook with partial fills
   ═══════════════════════════════════════════════════════════════ */
const Marketplace: React.FC = () => {
  const {
    walletAddress, senderHex,
    loading, filteredTokens, search, setSearch, handleSearchSelect,
    selectedToken, setSelectedToken, selInfo,
    setOrders,
    sellOrders, buyOrders, myOrders,
    orderType, setOrderType, orderAmount, setOrderAmount, orderPrice, setOrderPrice,
    creating, createStep, handleCreate,
    fillId, setFillId, fillAmount, setFillAmount, filling, fillStep,
    handleFill, handleExecuteBuyOrder, handleCancel,
    msg, lastTxId,
  } = useMarketplace();

  /* ─── RENDER ─── */

  // ════════════════════════════════
  // TOKEN DETAIL VIEW (orderbook)
  // ════════════════════════════════
  if (selectedToken) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Back button + header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => { setSelectedToken(null); setOrders([]); }}
            style={{ padding: '6px 14px', borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t3)', fontSize: '.74rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            &larr; Back
          </button>
          <img src={genLogo(selInfo?.symbol || '??')} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--w)' }}>{selInfo?.symbol || selectedToken.slice(-8)}</div>
            <div style={{ fontSize: '.64rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>{selectedToken}</div>
          </div>
        </div>

        {msg && (
          <div style={{ padding: '10px 14px', background: msg.startsWith('Error') || msg.startsWith('Revert') ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)', border: `1px solid ${msg.startsWith('Error') || msg.startsWith('Revert') ? 'rgba(239,68,68,.15)' : 'rgba(16,185,129,.15)'}`, borderRadius: 10, fontSize: '.74rem', color: msg.startsWith('Error') || msg.startsWith('Revert') ? '#ef4444' : 'var(--g)', marginBottom: 12 }}>
            {msg}
            {lastTxId && <a href={getTxUrl(lastTxId)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: 'var(--ac)', textDecoration: 'underline' }}>View on OPScan</a>}
          </div>
        )}

        {/* Two-column: Sell orders | Buy orders — exchange-style tables */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* SELL ORDERS (asks) */}
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#ef4444', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              Sell Orders
              <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>Asks</span>
              <span className="ob-badge" style={{ background: 'rgba(239,68,68,.1)', color: '#ef4444', marginLeft: 'auto' }}>{sellOrders.length}</span>
            </div>
            {sellOrders.length === 0 ? (
              <div className="ob-empty">
                <div style={{ fontSize: '1.4rem', marginBottom: 6, opacity: .4 }}>📋</div>
                No sell orders yet — be the first to create one!
              </div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 70px 90px 40px auto' }}>
                  <span>Amount</span><span className="ob-r">Price</span><span className="ob-r">Total</span>
                  <span className="ob-r">Fill</span><span className="ob-r">Action</span>
                </div>
                {sellOrders.map((o: Order) => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  const pct = o.amount > 0 ? Math.round((o.amountFilled / o.amount) * 100) : 0;
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 70px 90px 40px auto' }}>
                      <span className="ob-mono" style={{ color: 'var(--t1)' }}>
                        {fmtNum(remaining)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r" style={{ color: '#ef4444', fontWeight: 700 }}>{o.pricePerToken}</span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--o)' }}>{fmtNum(totalCostSats)}</span>
                      <span className="ob-r" style={{ position: 'relative' }}>
                        <span style={{ color: 'var(--t2)' }}>{pct}%</span>
                        {pct > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1, background: 'rgba(255,255,255,.08)' }}>
                          <div style={{ height: '100%', borderRadius: 1, background: 'rgba(239,68,68,.5)', width: `${pct}%` }} />
                        </div>}
                      </span>
                      <div className="ob-act">
                        {o.creator === senderHex ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : fillId === o.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input value={fillAmount} onChange={e => setFillAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder={`${fmtNum(remaining)}`}
                              style={{ ...iStyle, width: 80, padding: '3px 6px', fontSize: '.64rem' }} />
                            <button className="ob-btn green" onClick={() => handleFill(o.id, parseFloat(fillAmount) || remaining)} disabled={filling}>
                              {filling ? '..' : 'OK'}
                            </button>
                            <button className="ob-btn" onClick={() => { setFillId(null); setFillAmount(''); }}>X</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="ob-btn green" onClick={() => handleFill(o.id)} disabled={filling}>Buy</button>
                            <button className="ob-btn" onClick={() => setFillId(o.id)}>Partial</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BUY ORDERS (bids) */}
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: 'var(--g)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              Buy Orders
              <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>Bids</span>
              <span className="ob-badge" style={{ background: 'rgba(16,185,129,.1)', color: 'var(--g)', marginLeft: 'auto' }}>{buyOrders.length}</span>
            </div>
            {buyOrders.length === 0 ? (
              <div className="ob-empty">
                <div style={{ fontSize: '1.4rem', marginBottom: 6, opacity: .4 }}>📋</div>
                No buy orders yet — be the first to create one!
              </div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 70px 90px 60px auto' }}>
                  <span>Wants</span><span className="ob-r">Price</span><span className="ob-r">Pays</span>
                  <span>Status</span><span className="ob-r">Action</span>
                </div>
                {buyOrders.map((o: Order) => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  const isMyBuyOrder = o.creator === senderHex;
                  const isAccepted = o.status === 'accepted';
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 70px 90px 60px auto' }}>
                      <span className="ob-mono" style={{ color: 'var(--t1)' }}>
                        {fmtNum(remaining)} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--g)', fontWeight: 700 }}>{o.pricePerToken}</span>
                      <span className="ob-mono ob-r" style={{ color: 'var(--o)' }}>{fmtNum(totalCostSats)}</span>
                      <span>
                        {isAccepted
                          ? <span className="ob-badge" style={{ background: 'rgba(247,147,26,.15)', color: 'var(--o)' }}>ACCEPTED</span>
                          : <span className="ob-badge" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--g)' }}>OPEN</span>}
                      </span>
                      <div className="ob-act">
                        {isAccepted && isMyBuyOrder ? (
                          <>
                            <button className="ob-btn accent" onClick={() => handleExecuteBuyOrder(o.id)} disabled={filling}>
                              {filling ? '..' : `Pay ${fmtNum(totalCostSats)}`}
                            </button>
                            <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>X</button>
                          </>
                        ) : isMyBuyOrder || (isAccepted && o.seller === senderHex) ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : !isAccepted ? (
                          <button className="ob-btn accent" onClick={() => handleFill(o.id)} disabled={filling}>
                            {filling ? '..' : 'Accept'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '.62rem', color: 'var(--t3)' }}>Awaiting pay</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {fillStep && (
          <div style={{ padding: '10px 14px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.15)', borderRadius: 10, fontSize: '.72rem', color: 'var(--o)', marginBottom: 12 }}>
            {fillStep}
          </div>
        )}

        {/* Create order form */}
        <div className="P" style={{ padding: 18, marginBottom: 16 }}>
          <div className="Lb" style={{ marginBottom: 10 }}>Place Order</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['sell', 'buy'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                style={{
                  flex: 1, padding: '8px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700, fontSize: '.76rem',
                  border: '1px solid ' + (orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.4)' : 'rgba(16,185,129,.4)') : 'var(--bd)'),
                  background: orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)') : 'transparent',
                  color: orderType === t ? (t === 'sell' ? '#ef4444' : 'var(--g)') : 'var(--t3)',
                }}>
                {t === 'sell' ? 'Sell Tokens' : 'Buy Tokens (Bid)'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>
                {orderType === 'sell' ? 'Amount to sell' : 'Amount you want'}
              </label>
              <input style={iStyle} type="text" inputMode="numeric" value={orderAmount}
                onChange={e => setOrderAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="100000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Price (sats/token)</label>
              <input style={iStyle} type="text" inputMode="decimal" value={orderPrice}
                onChange={e => setOrderPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.5" />
            </div>
          </div>
          {orderAmount && orderPrice && (
            <div style={{ padding: '8px 12px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 10, fontSize: '.68rem', color: 'var(--t3)', marginBottom: 12 }}>
              Total: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {fmtNum(Math.floor(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0')))} sats
              </strong>
              {' '}({(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0') / 1e8).toFixed(6)} BTC)
            </div>
          )}
          {createStep && <div style={{ fontSize: '.68rem', color: createStep.includes('Failed') ? '#ef4444' : 'var(--o)', marginBottom: 8, textAlign: 'center' }}>{createStep}</div>}
          <button onClick={handleCreate} disabled={creating || !orderAmount || !orderPrice}
            className="lbtn" style={{ width: '100%', opacity: creating ? 0.6 : 1 }}>
            {creating ? 'Creating...' : walletAddress ? `Place ${orderType === 'sell' ? 'Sell' : 'Buy'} Order` : 'Connect Wallet'}
          </button>
          <div style={{ marginTop: 8, fontSize: '.54rem', color: 'var(--t4)', textAlign: 'center' }}>
            {orderType === 'sell'
              ? 'Tokens are locked in the P2PMarket contract on-chain. Buyers pay BTC directly to you.'
              : 'Trustless 3-step: 1) You post buy intent → 2) Seller locks tokens in contract → 3) You pay BTC and receive tokens automatically.'}
          </div>
        </div>

        {/* My orders — table */}
        {myOrders.length > 0 && (
          <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.82rem', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              My Orders
              <span className="ob-badge" style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', marginLeft: 'auto' }}>{myOrders.length}</span>
            </div>
            <div className="ob-scroll">
              <div className="ob-hdr" style={{ gridTemplateColumns: '55px 1fr 80px 65px auto' }}>
                <span>Type</span><span>Filled</span><span className="ob-r">Price</span>
                <span>Status</span><span className="ob-r">Action</span>
              </div>
              {myOrders.map((o: Order) => (
                <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '55px 1fr 80px 65px auto' }}>
                  <span>
                    <span className="ob-badge" style={{
                      background: o.type === 'sell' ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)',
                      color: o.type === 'sell' ? '#ef4444' : 'var(--g)',
                    }}>{o.type.toUpperCase()}</span>
                  </span>
                  <span className="ob-mono" style={{ color: 'var(--t1)' }}>{fmtNum(o.amountFilled)}/{fmtNum(o.amount)}</span>
                  <span className="ob-mono ob-r" style={{ color: 'var(--t2)' }}>{o.pricePerToken} <span style={{ fontSize: '.6rem', color: 'var(--t3)' }}>sat</span></span>
                  <span>
                    <span className="ob-badge" style={{
                      background: o.status === 'active' ? 'rgba(16,185,129,.12)' : 'rgba(255,255,255,.06)',
                      color: o.status === 'active' ? 'var(--g)' : 'var(--t3)',
                    }}>{o.status}</span>
                  </span>
                  <div className="ob-act">
                    {o.status === 'active' && (
                      <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════
  // TOKEN LIST VIEW
  // ════════════════════════════════
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--w)', marginBottom: 4 }}>Marketplace <span style={{ fontSize: '.6rem', color: 'var(--g)', fontWeight: 500 }}>ON-CHAIN</span></h2>
        <p style={{ fontSize: '.74rem', color: 'var(--t3)', margin: 0 }}>
          P2P orderbook for OP20 tokens. Orders are executed on-chain via{' '}
          <a href={getContractOpscanUrl(MARKET_ADDRESS)} target="_blank" rel="noopener" style={{ color: 'var(--o)', textDecoration: 'none' }}>P2PMarket contract</a>.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, symbol or paste contract address..."
          onKeyDown={e => e.key === 'Enter' && handleSearchSelect()}
          style={{ ...iStyle, flex: 1 }} />
        {search.startsWith('opt1sq') && search.length > 20 && (
          <button onClick={handleSearchSelect} className="lbtn" style={{ padding: '10px 18px', fontSize: '.74rem', flexShrink: 0 }}>
            Open &rarr;
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--t4)', fontSize: '.82rem' }}>Loading tokens...</div>
      ) : filteredTokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>&#x1F50D;</div>
          <div style={{ color: 'var(--t4)', fontSize: '.82rem', marginBottom: 6 }}>No tokens found</div>
          <div style={{ color: 'var(--t4)', fontSize: '.66rem' }}>Paste a contract address above to open its orderbook</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {filteredTokens.map((t: MarketToken) => {
            const [c1] = hashColor(t.symbol);
            return (
              <div key={t.address} onClick={() => setSelectedToken(t.address)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 16,
                  cursor: 'pointer', transition: 'border-color .15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = c1)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--bd)')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <img src={genLogo(t.symbol)} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--w)' }}>{t.symbol}</div>
                    <div style={{ fontSize: '.62rem', color: 'var(--t4)' }}>{t.name}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.64rem', color: 'var(--t3)' }}>
                  <span>Sells: <strong style={{ color: '#ef4444' }}>{t.sellCount}</strong></span>
                  <span>Bids: <strong style={{ color: 'var(--g)' }}>{t.buyCount}</strong></span>
                  <span>Vol: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>{fmtNum(t.totalVolume)}</strong></span>
                </div>
                <div style={{ fontSize: '.52rem', color: 'var(--t4)', fontFamily: 'var(--fm)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.address}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
