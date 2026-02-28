import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { formatTxError } from '../txUtils';
import { fmtNum, hashColor, genLogo, timeAgo } from '../launchpad/types';

const LP_API = import.meta.env.VITE_LP_API || 'http://188.137.250.160:3457';

/* ─── Types ─── */
interface Order {
  id: string;
  type: 'sell' | 'buy';
  creator: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amount: number;
  amountFilled: number;
  pricePerToken: number;
  totalPrice: number;
  createdAt: number;
  status: 'active' | 'filled' | 'cancelled';
  fills: { id: string; filler: string; amount: number; price: number; timestamp: number }[];
}

interface MarketToken {
  address: string;
  symbol: string;
  name: string;
  sellCount: number;
  buyCount: number;
  totalVolume: number;
}

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box' as const,
};

/* ═══════════════════════════════════════════════════════════════
   MARKETPLACE — per-token orderbook with partial fills
   ═══════════════════════════════════════════════════════════════ */
const Marketplace: React.FC = () => {
  const { walletAddress, openConnectModal } = useWalletConnect();

  // View state: token list vs token detail
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenList, setTokenList] = useState<MarketToken[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create order form
  const [orderType, setOrderType] = useState<'sell' | 'buy'>('sell');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');

  // Fill form
  const [fillId, setFillId] = useState<string | null>(null);
  const [fillAmount, setFillAmount] = useState('');
  const [filling, setFilling] = useState(false);
  const [fillStep, setFillStep] = useState('');

  // Status messages
  const [msg, setMsg] = useState('');

  // Fetch token list
  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${LP_API}/market/tokens`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setTokenList((await res.json()).tokens || []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  // Fetch orders for selected token
  const fetchOrders = useCallback(async (tokenAddr?: string) => {
    const addr = tokenAddr || selectedToken;
    if (!addr) return;
    try {
      const url = `${LP_API}/market/orders?token=${encodeURIComponent(addr)}&status=active`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setOrders((await res.json()).orders || []);
    } catch { /* offline */ }
  }, [selectedToken]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);
  useEffect(() => { if (selectedToken) fetchOrders(); }, [selectedToken, fetchOrders]);

  // Filtered token list
  const filteredTokens = useMemo(() => {
    if (!search) return tokenList;
    const q = search.toLowerCase();
    return tokenList.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [tokenList, search]);

  // Currently selected token info
  const selInfo = tokenList.find(t => t.address === selectedToken);

  // Sell orders / buy orders for current token
  const sellOrders = orders.filter(o => o.type === 'sell' && o.status === 'active').sort((a, b) => a.pricePerToken - b.pricePerToken);
  const buyOrders = orders.filter(o => o.type === 'buy' && o.status === 'active').sort((a, b) => b.pricePerToken - a.pricePerToken);
  const myOrders = orders.filter(o => o.creator === walletAddress);

  // Create order
  const handleCreate = useCallback(async () => {
    if (!walletAddress) { openConnectModal(); return; }
    if (!selectedToken || !orderAmount || !orderPrice) return;
    const amt = parseFloat(orderAmount);
    const ppt = parseFloat(orderPrice);
    if (amt <= 0 || ppt <= 0) return;

    setCreating(true); setCreateStep('Posting order...');
    try {
      const res = await fetch(`${LP_API}/market/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: orderType, creator: walletAddress,
          tokenAddress: selectedToken,
          tokenSymbol: selInfo?.symbol || '',
          tokenName: selInfo?.name || '',
          amount: amt, pricePerToken: ppt,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed'); }
      setCreateStep('');
      setOrderAmount(''); setOrderPrice('');
      setMsg(`${orderType === 'sell' ? 'Sell' : 'Buy'} order created!`);
      setTimeout(() => setMsg(''), 3000);
      await fetchOrders();
      await fetchTokens();
    } catch (e) {
      setCreateStep(e instanceof Error ? e.message : 'Failed');
      setTimeout(() => setCreateStep(''), 3000);
    } finally { setCreating(false); }
  }, [walletAddress, selectedToken, orderAmount, orderPrice, orderType, selInfo, openConnectModal, fetchOrders, fetchTokens]);

  // Fill order (partial)
  const handleFill = useCallback(async (orderId: string, amount?: number) => {
    if (!walletAddress) { openConnectModal(); return; }
    setFilling(true); setFillStep('Filling order...');
    try {
      const body: Record<string, unknown> = { orderId, filler: walletAddress };
      if (amount && amount > 0) body.amount = amount;
      const res = await fetch(`${LP_API}/market/fill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed'); }
      setFillStep(''); setFillId(null); setFillAmount('');
      setMsg('Order filled!');
      setTimeout(() => setMsg(''), 3000);
      await fetchOrders();
    } catch (e) {
      setFillStep(formatTxError(e));
      setTimeout(() => setFillStep(''), 3000);
    } finally { setFilling(false); }
  }, [walletAddress, openConnectModal, fetchOrders]);

  // Cancel order
  const handleCancel = useCallback(async (orderId: string) => {
    if (!walletAddress) return;
    try {
      await fetch(`${LP_API}/market/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, creator: walletAddress }),
        signal: AbortSignal.timeout(5000),
      });
      await fetchOrders();
    } catch { /* ignore */ }
  }, [walletAddress, fetchOrders]);

  // Select token from search input (direct address entry)
  const handleSearchSelect = () => {
    if (search.startsWith('opt1sq') && search.length > 20) {
      setSelectedToken(search);
      // Add to token list if not present
      if (!tokenList.find(t => t.address === search)) {
        setTokenList(prev => [...prev, { address: search, symbol: search.slice(-6).toUpperCase(), name: 'OP20 Token', sellCount: 0, buyCount: 0, totalVolume: 0 }]);
      }
    }
  };

  /* ─── RENDER ─── */

  // ════════════════════════════════
  // TOKEN DETAIL VIEW (orderbook)
  // ════════════════════════════════
  if (selectedToken) {
    const [c1] = hashColor(selInfo?.symbol || '??');
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
          <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)', borderRadius: 10, fontSize: '.74rem', color: 'var(--g)', marginBottom: 12 }}>
            {msg}
          </div>
        )}

        {/* Two-column: Sell orders | Buy orders */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* SELL ORDERS (asks) */}
          <div className="P" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#ef4444', marginBottom: 10 }}>Sell Orders (Asks)</div>
            {sellOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--t4)', fontSize: '.72rem' }}>No sell orders</div>
            ) : sellOrders.map(o => {
              const remaining = o.amount - o.amountFilled;
              const pct = o.amount > 0 ? (o.amountFilled / o.amount) * 100 : 0;
              return (
                <div key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.68rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--t2)' }}>{fmtNum(remaining)} <span style={{ color: 'var(--t4)', fontSize: '.58rem' }}>/ {fmtNum(o.amount)}</span></span>
                    <span style={{ color: '#ef4444', fontFamily: 'var(--fm)', fontWeight: 700 }}>{o.pricePerToken.toFixed(2)} sat</span>
                  </div>
                  {pct > 0 && (
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.06)', marginBottom: 4 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: 'rgba(239,68,68,.4)', width: `${pct}%` }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--t4)', fontSize: '.56rem' }}>{o.creator.slice(0, 10)}... &middot; {timeAgo(o.createdAt)}</span>
                    {o.creator === walletAddress ? (
                      <button onClick={() => handleCancel(o.id)}
                        style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,.2)', background: 'transparent', color: '#ef4444', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Cancel</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {fillId === o.id ? (
                          <>
                            <input value={fillAmount} onChange={e => setFillAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder={`Max ${fmtNum(remaining)}`}
                              style={{ ...iStyle, width: 90, padding: '3px 6px', fontSize: '.6rem' }} />
                            <button onClick={() => handleFill(o.id, parseFloat(fillAmount) || remaining)} disabled={filling}
                              style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)', color: 'var(--g)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                              {filling ? '...' : 'OK'}
                            </button>
                            <button onClick={() => { setFillId(null); setFillAmount(''); }}
                              style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t4)', fontSize: '.58rem', cursor: 'pointer' }}>X</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => handleFill(o.id)} disabled={filling}
                              className="lbtn" style={{ padding: '3px 10px', fontSize: '.58rem' }}>Buy All</button>
                            <button onClick={() => setFillId(o.id)}
                              style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'rgba(255,255,255,.03)', color: 'var(--t3)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Partial</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* BUY ORDERS (bids) */}
          <div className="P" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--g)', marginBottom: 10 }}>Buy Orders (Bids)</div>
            {buyOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--t4)', fontSize: '.72rem' }}>No buy orders</div>
            ) : buyOrders.map(o => {
              const remaining = o.amount - o.amountFilled;
              const pct = o.amount > 0 ? (o.amountFilled / o.amount) * 100 : 0;
              return (
                <div key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.68rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--t2)' }}>Wants: {fmtNum(remaining)} <span style={{ color: 'var(--t4)', fontSize: '.58rem' }}>/ {fmtNum(o.amount)}</span></span>
                    <span style={{ color: 'var(--g)', fontFamily: 'var(--fm)', fontWeight: 700 }}>{o.pricePerToken.toFixed(2)} sat</span>
                  </div>
                  {pct > 0 && (
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.06)', marginBottom: 4 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: 'rgba(16,185,129,.4)', width: `${pct}%` }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--t4)', fontSize: '.56rem' }}>{o.creator.slice(0, 10)}... &middot; {timeAgo(o.createdAt)}</span>
                    {o.creator === walletAddress ? (
                      <button onClick={() => handleCancel(o.id)}
                        style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,.2)', background: 'transparent', color: '#ef4444', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Cancel</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {fillId === o.id ? (
                          <>
                            <input value={fillAmount} onChange={e => setFillAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder={`Max ${fmtNum(remaining)}`}
                              style={{ ...iStyle, width: 90, padding: '3px 6px', fontSize: '.6rem' }} />
                            <button onClick={() => handleFill(o.id, parseFloat(fillAmount) || remaining)} disabled={filling}
                              style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(247,147,26,.1)', border: '1px solid rgba(247,147,26,.2)', color: 'var(--o)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                              {filling ? '...' : 'OK'}
                            </button>
                            <button onClick={() => { setFillId(null); setFillAmount(''); }}
                              style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t4)', fontSize: '.58rem', cursor: 'pointer' }}>X</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => handleFill(o.id)} disabled={filling}
                              style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(247,147,26,.1)', border: '1px solid rgba(247,147,26,.2)', color: 'var(--o)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 600 }}>Sell All</button>
                            <button onClick={() => setFillId(o.id)}
                              style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'rgba(255,255,255,.03)', color: 'var(--t3)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Partial</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
              ? 'You list tokens for sale. Buyers fill your order (partially or fully).'
              : 'You post a bid. Token holders can sell into your order at your price.'}
          </div>
        </div>

        {/* My orders for this token */}
        {myOrders.length > 0 && (
          <div className="P" style={{ padding: 14 }}>
            <div className="Lb" style={{ marginBottom: 8 }}>My Orders ({myOrders.length})</div>
            {myOrders.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.66rem' }}>
                <div>
                  <span style={{ color: o.type === 'sell' ? '#ef4444' : 'var(--g)', fontWeight: 700, marginRight: 6 }}>{o.type.toUpperCase()}</span>
                  <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fmtNum(o.amountFilled)}/{fmtNum(o.amount)}</span>
                  <span style={{ color: 'var(--t4)', marginLeft: 6 }}>@ {o.pricePerToken} sat</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: '.52rem', fontWeight: 700,
                    background: o.status === 'active' ? 'rgba(16,185,129,.1)' : 'rgba(255,255,255,.05)',
                    color: o.status === 'active' ? 'var(--g)' : 'var(--t4)',
                  }}>{o.status}</span>
                  {o.status === 'active' && (
                    <button onClick={() => handleCancel(o.id)}
                      style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,.2)', background: 'transparent', color: '#ef4444', fontSize: '.52rem', cursor: 'pointer' }}>Cancel</button>
                  )}
                </div>
              </div>
            ))}
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
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--w)', marginBottom: 4 }}>Marketplace</h2>
        <p style={{ fontSize: '.74rem', color: 'var(--t3)', margin: 0 }}>
          P2P orderbook for OP20 tokens. Select a token to view and place orders.
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
          {filteredTokens.map(t => {
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
