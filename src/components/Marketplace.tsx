import React from 'react';
import { fmtNum, genLogo } from '../launchpad/types';
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
    loading, filteredTokens, search, setSearch, tokenSort, setTokenSort, handleSearchSelect,
    selectedToken, setSelectedToken, selInfo,
    setOrders, ordersLoading,
    sellOrders, buyOrders, myOrders,
    orderType, setOrderType, orderAmount, setOrderAmount, orderPrice, setOrderPrice,
    creating, createStep, handleCreate,
    fillId, setFillId, fillAmount, setFillAmount, filling, fillStep,
    handleFill, handleCancel,
    msg, lastTxId, tokenBalance,
  } = useMarketplace();

  /* ─── RENDER ─── */

  // ════════════════════════════════
  // TOKEN DETAIL VIEW (orderbook)
  // ════════════════════════════════
  if (selectedToken) {
    return (
      <div className="m-auto max-w-900">
        {/* Back button + header */}
        <div className="flex-center gap-12 mb-16">
          <button onClick={() => { setSelectedToken(null); setOrders([]); }}
            className="br-10 c-t3 fs-74 pointer ff-ui p-6-14 bd-bd bg-bg3">
            &larr; Back
          </button>
          <img src={genLogo(selInfo?.symbol || '??')} alt={`${selInfo?.symbol || 'Token'} logo`} className="w-36 h-36 br-50" />
          <div>
            <div className="fw-800 fs-88 c-w fs-110">{selInfo?.symbol || selectedToken.slice(-8)}</div>
            <div className="fs-62 c-t4 text-mono">{selectedToken}</div>
          </div>
          {walletAddress && tokenBalance !== null && (
            <div className="ml-auto br-10 p-6-14 bg-bg3 bd-bd">
              <div className="fs-62 c-t3">Your balance</div>
              <div className="fw-700 fs-86 c-w text-mono">{tokenBalance}</div>
            </div>
          )}
        </div>

        {msg && (
          <div className={`br-10 fs-74 mb-12 p-10-14 ${msg.startsWith('Error') || msg.startsWith('Revert') ? 'bg-err c-red' : 'bg-ok c-g'}`} role="alert" aria-live="polite">
            {msg}
            {lastTxId && <a href={getTxUrl(lastTxId)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: 'var(--ac)', textDecoration: 'underline' }}>View on OPScan</a>}
          </div>
        )}

        {ordersLoading && (
          <div className="br-10 fs-74 mb-12 p-10-14 bg-info-o c-o text-center">
            Loading orders from chain... ({sellOrders.length + buyOrders.length} found)
          </div>
        )}

        {/* Two-column: For Sale | Buy Requests — exchange-style tables */}
        <div className="d-grid gap-12 mb-16 grid-1-1">
          {/* FOR SALE — other people selling, you can buy */}
          <div className="P p-0-overflow-hidden">
            <div className="fw-700 fs-86 c-red d-flex ai-baseline gap-6 p-12-12-6">
              For Sale
              <span className="fs-62 fw-600 c-t2">you pay BTC, get tokens</span>
              <span className="ob-badge c-red ml-auto ob-badge-red">{sellOrders.length}</span>
            </div>
            {ordersLoading && sellOrders.length === 0 ? (
              <div className="ob-empty c-t3">Loading...</div>
            ) : sellOrders.length === 0 ? (
              <div className="ob-empty">
                <div className="c-t4 fs-74">No tokens for sale yet</div>
              </div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 70px 80px auto' }}>
                  <span>Amount</span><span className="ob-r">Price</span><span className="ob-r">Cost</span>
                  <span className="ob-r">Action</span>
                </div>
                {sellOrders.map((o: Order) => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 70px 80px auto' }}>
                      <span className="ob-mono c-w">
                        {fmtNum(remaining)} <span className="fs-xs c-t3">/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r fw-700 c-red">{o.pricePerToken} <span className="fs-xs fw-400 c-t3">sat</span></span>
                      <span className="ob-mono ob-r c-o">{fmtNum(totalCostSats)}</span>
                      <div className="ob-act">
                        {o.creator === senderHex ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : fillId === o.id ? (
                          <div className="flex-center gap-4">
                            <input value={fillAmount} onChange={e => setFillAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder={`${fmtNum(remaining)}`}
                              aria-label="Partial fill amount"
                              className="fs-64" style={{ ...iStyle, width: 80, padding: '3px 6px' }} />
                            <button className="ob-btn green" onClick={() => handleFill(o.id, parseFloat(fillAmount) || remaining)} disabled={filling}>
                              {filling ? '..' : 'OK'}
                            </button>
                            <button className="ob-btn" onClick={() => { setFillId(null); setFillAmount(''); }}>X</button>
                          </div>
                        ) : (
                          <div className="flex-center gap-4">
                            <button className="ob-btn green" onClick={() => handleFill(o.id)} disabled={filling}>
                              Buy tokens
                            </button>
                            <button className="ob-btn" onClick={() => setFillId(o.id)} title="Buy partial amount">Part</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BUY REQUESTS — other people want to buy, you can sell to them */}
          <div className="P p-0-overflow-hidden">
            <div className="fw-700 fs-86 c-g d-flex ai-baseline gap-6 p-12-12-6">
              Buy Requests
              <span className="fs-62 fw-600 c-t2">you send tokens, get BTC</span>
              <span className="ob-badge c-g ml-auto ob-badge-green">{buyOrders.length}</span>
            </div>
            {ordersLoading && buyOrders.length === 0 ? (
              <div className="ob-empty c-t3">Loading...</div>
            ) : buyOrders.length === 0 ? (
              <div className="ob-empty">
                <div className="c-t4 fs-74">No buy requests yet</div>
              </div>
            ) : (
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: '1fr 70px 80px auto' }}>
                  <span>Wants</span><span className="ob-r">Price</span><span className="ob-r">BTC locked</span>
                  <span className="ob-r">Action</span>
                </div>
                {buyOrders.map((o: Order) => {
                  const remaining = o.amount - o.amountFilled;
                  const totalCostSats = Math.ceil(remaining * o.pricePerToken);
                  const isMyBuyOrder = o.creator === senderHex;
                  return (
                    <div key={o.id} className="ob-row" style={{ gridTemplateColumns: '1fr 70px 80px auto' }}>
                      <span className="ob-mono c-w">
                        {fmtNum(remaining)} <span className="fs-xs c-t3">/ {fmtNum(o.amount)}</span>
                      </span>
                      <span className="ob-mono ob-r fw-700 c-g">{o.pricePerToken} <span className="fs-xs fw-400 c-t3">sat</span></span>
                      <span className="ob-mono ob-r c-o">{fmtNum(totalCostSats)}</span>
                      <div className="ob-act">
                        {isMyBuyOrder ? (
                          <button className="ob-btn danger" onClick={() => handleCancel(o.id)}>Cancel</button>
                        ) : (
                          <button className="ob-btn accent" onClick={() => handleFill(o.id)} disabled={filling}>
                            {filling ? '..' : 'Sell tokens'}
                          </button>
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
          <div className="br-10 fs-72 c-o mb-12 p-10-14 bg-info-o">
            {fillStep}
          </div>
        )}

        {/* Create order form */}
        <div className="P p-18 mb-16" role="form" aria-label="Place a marketplace order">
          <div className="Lb mb-10">Place Order</div>
          <div className="flex-center gap-6 mb-12">
            {(['sell', 'buy'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className="flex-1 br-10 pointer ff-ui fw-700 fs-76" style={{ padding: '8px', border: '1px solid ' + (orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.4)' : 'rgba(16,185,129,.4)') : 'var(--bd)'), background: orderType === t ? (t === 'sell' ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)') : 'transparent', color: orderType === t ? (t === 'sell' ? '#ef4444' : 'var(--g)') : 'var(--t3)' }}>
                {t === 'sell' ? 'Sell Tokens' : 'Buy Tokens (Bid)'}
              </button>
            ))}
          </div>
          <div className="flex-center gap-8 mb-10">
            <div className="flex-1">
              <label className="lbl-xs d-block">
                {orderType === 'sell' ? 'Amount to sell' : 'Amount you want'}
              </label>
              <input style={iStyle} type="text" inputMode="numeric" value={orderAmount}
                onChange={e => setOrderAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="100000"
                aria-label={orderType === 'sell' ? 'Amount to sell' : 'Amount you want'} />
            </div>
            <div className="flex-1">
              <label className="lbl-xs d-block">Price (sats/token)</label>
              <input style={iStyle} type="text" inputMode="decimal" value={orderPrice}
                onChange={e => setOrderPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.5"
                aria-label="Price in sats per token" />
            </div>
          </div>
          {orderAmount && orderPrice && (
            <div className="br-10 fs-68 c-t3 mb-12 p-8-12 bg-info-o">
              Total: <strong className="c-o text-mono">
                {fmtNum(Math.floor(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0')))} sats
              </strong>
              {' '}({(parseFloat(orderAmount || '0') * parseFloat(orderPrice || '0') / 1e8).toFixed(6)} BTC)
            </div>
          )}
          {createStep && <div className="fs-68 mb-8 text-center" style={{ color: createStep.includes('Failed') ? '#ef4444' : 'var(--o)' }}>{createStep}</div>}
          <button onClick={handleCreate} disabled={creating || !orderAmount || !orderPrice}
            className="lbtn w-full" style={{ opacity: creating ? 0.6 : 1 }}>
            {creating ? 'Creating...' : walletAddress ? `Place ${orderType === 'sell' ? 'Sell' : 'Buy'} Order` : 'Connect Wallet'}
          </button>
          <div className="mt-8 fs-2xs c-t4 text-center">
            {orderType === 'sell'
              ? 'Tokens are locked in the P2PMarket contract on-chain. Buyers pay BTC directly to you.'
              : 'Atomic: your BTC is locked on-chain. When a seller accepts, tokens go to you and BTC goes to them — all in one transaction.'}
          </div>
        </div>

        {/* My orders — table */}
        {myOrders.length > 0 && (
          <div className="P p-0-overflow-hidden">
            <div className="fw-700 fs-82 d-flex ai-baseline gap-6 p-12-12-6">
              My Orders
              <span className="ob-badge c-y ml-auto ob-badge-y">{myOrders.length}</span>
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
                  <span className="ob-mono c-w">{fmtNum(o.amountFilled)}/{fmtNum(o.amount)}</span>
                  <span className="ob-mono ob-r c-t2">{o.pricePerToken} <span className="fs-xs c-t3">sat</span></span>
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
  const sortArrow = (key: 'holders' | 'volume' | 'orders'): string =>
    tokenSort === key ? ' \u25BC' : '';

  return (
    <div className="max-w-900">
      <div className="mb-16">
        <h2 className="fw-800 fs-120 c-w mb-4">Marketplace <span className="fs-60 c-g fw-500">ON-CHAIN</span></h2>
        <p className="fs-74 c-t3 mt-0 mb-0">
          P2P orderbook for OP20 tokens. Orders are executed on-chain via{' '}
          <a href={getContractOpscanUrl(MARKET_ADDRESS)} target="_blank" rel="noopener" className="c-o no-decoration">P2PMarket contract</a>.
        </p>
      </div>

      <div className="flex-center gap-8 mb-14">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, symbol or paste contract address..."
          onKeyDown={e => e.key === 'Enter' && handleSearchSelect()}
          aria-label="Search tokens by name, symbol, or contract address"
          className="flex-1" style={{ ...iStyle }} />
        {search.startsWith('opt1sq') && search.length > 20 && (
          <button onClick={handleSearchSelect} className="lbtn fs-74 flex-shrink-0" style={{ padding: '10px 18px' }}>
            Open &rarr;
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center c-t4 fs-82 p-50">Loading tokens...</div>
      ) : filteredTokens.length === 0 ? (
        <div className="text-center p-50">
          <div className="fs-220 mb-10">&#x1F50D;</div>
          <div className="c-t4 fs-82 mb-6">No tokens found</div>
          <div className="c-t4 fs-66">Paste a contract address above to open its orderbook</div>
        </div>
      ) : (
        <div className="P p-0-overflow-hidden" role="list" aria-label="Available tokens">
          <div className="ob-hdr" style={{ gridTemplateColumns: '2fr 70px 70px 55px 55px' }}>
            <span>Token</span>
            <span className="ob-r pointer" onClick={() => setTokenSort('holders')}
              style={{ color: tokenSort === 'holders' ? 'var(--g)' : undefined, cursor: 'pointer' }}>
              Holders{sortArrow('holders')}
            </span>
            <span className="ob-r pointer" onClick={() => setTokenSort('volume')}
              style={{ color: tokenSort === 'volume' ? 'var(--g)' : undefined, cursor: 'pointer' }}>
              Volume{sortArrow('volume')}
            </span>
            <span className="ob-r pointer" onClick={() => setTokenSort('orders')}
              style={{ color: tokenSort === 'orders' ? 'var(--g)' : undefined, cursor: 'pointer' }}>
              Sells{sortArrow('orders')}
            </span>
            <span className="ob-r">Bids</span>
          </div>
          {filteredTokens.map((t: MarketToken) => (
            <div key={t.address} onClick={() => setSelectedToken(t.address)}
              className="ob-row pointer" role="listitem" tabIndex={0}
              aria-label={`${t.symbol} - ${t.name}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedToken(t.address); } }}
              style={{ gridTemplateColumns: '2fr 70px 70px 55px 55px' }}>
              <div className="flex-center gap-8">
                <img src={genLogo(t.symbol)} alt={`${t.symbol} logo`} className="w-28 h-28 br-50" />
                <div>
                  <span className="fw-700 c-w fs-80">{t.symbol}</span>
                  <span className="fs-62 c-t4 ml-6">{t.name}</span>
                </div>
              </div>
              <span className="ob-mono ob-r c-w">{t.holders > 0 ? fmtNum(t.holders) : '-'}</span>
              <span className="ob-mono ob-r c-o">{t.totalVolume > 0 ? fmtNum(t.totalVolume) : '-'}</span>
              <span className="ob-mono ob-r c-red">{t.sellCount || '-'}</span>
              <span className="ob-mono ob-r c-g">{t.buyCount || '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
