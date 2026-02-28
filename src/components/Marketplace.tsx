import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { buildTxParams, withRetry, formatTxError } from '../txUtils';
import { fmtNum, hashColor, genLogo, timeAgo } from '../launchpad/types';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';
const LP_API = import.meta.env.VITE_LP_API || 'http://188.137.250.160:3457';

const OP20_ABI: BitcoinInterfaceAbi = [
  { name: 'transfer', inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }, { name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [], type: BitcoinAbiTypes.Function },
  { name: 'balanceOf', inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'totalSupply', inputs: [], outputs: [{ name: 'supply', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'allowance', inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }, { name: 'spender', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'remaining', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'approve', inputs: [{ name: 'spender', type: ABIDataTypes.ADDRESS }, { name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [], type: BitcoinAbiTypes.Function },
];

/* ─── Types ─── */
interface Order {
  id: string;
  seller: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amount: number;
  pricePerToken: number; // sats per token
  totalPrice: number;
  createdAt: number;
  status: 'active' | 'filled' | 'cancelled';
}

type MarketTab = 'browse' | 'sell' | 'my';

const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
};

/* ═══════════════════════════════════════════════════════════════
   ORDER CARD
   ═══════════════════════════════════════════════════════════════ */
const OrderCard: React.FC<{
  order: Order;
  onBuy?: (order: Order) => void;
  onCancel?: (order: Order) => void;
  isMine: boolean;
}> = ({ order, onBuy, onCancel, isMine }) => {
  const [c1] = hashColor(order.tokenSymbol);
  const imgSrc = genLogo(order.tokenSymbol);

  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14,
      padding: 14, display: 'flex', gap: 12, alignItems: 'center',
      transition: 'border-color .15s',
    }}>
      <img src={imgSrc} alt="" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--w)' }}>{order.tokenSymbol}</span>
          <span style={{ fontSize: '.58rem', color: 'var(--t4)' }}>{order.tokenName}</span>
          <span style={{
            marginLeft: 'auto', padding: '2px 7px', borderRadius: 6, fontSize: '.52rem', fontWeight: 700,
            background: order.status === 'active' ? 'rgba(16,185,129,.1)' : 'rgba(255,255,255,.05)',
            color: order.status === 'active' ? 'var(--g)' : 'var(--t4)',
          }}>
            {order.status.toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: '.66rem', color: 'var(--t3)' }}>
          <span>Amount: <strong style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fmtNum(order.amount)}</strong></span>
          <span>Price: <strong style={{ color: c1, fontFamily: 'var(--fm)' }}>{order.pricePerToken.toFixed(2)} sat/tok</strong></span>
          <span>Total: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>{fmtNum(order.totalPrice)} sats</strong></span>
        </div>
        <div style={{ fontSize: '.54rem', color: 'var(--t4)', marginTop: 3 }}>
          {order.seller.slice(0, 14)}... &middot; {timeAgo(order.createdAt)}
        </div>
      </div>
      {order.status === 'active' && (
        <div>
          {isMine ? (
            <button onClick={() => onCancel?.(order)}
              style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,.2)', background: 'rgba(239,68,68,.06)', color: '#ef4444', fontSize: '.68rem', cursor: 'pointer', fontWeight: 600, fontFamily: 'var(--ff)' }}>
              Cancel
            </button>
          ) : (
            <button onClick={() => onBuy?.(order)} className="lbtn"
              style={{ padding: '8px 16px', fontSize: '.72rem' }}>
              Buy
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN MARKETPLACE
   ═══════════════════════════════════════════════════════════════ */
const Marketplace: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const [activeTab, setActiveTab] = useState<MarketTab>('browse');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Sell form
  const [sellToken, setSellToken] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellStep, setSellStep] = useState('');
  const [selling, setSelling] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; name: string; balance: number } | null>(null);

  // Buy state
  const [buyStep, setBuyStep] = useState('');
  const [buying, setBuying] = useState(false);

  // Fetch orders from server
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${LP_API}/market/orders`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch { /* server offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Lookup token info when sell address changes
  useEffect(() => {
    if (!sellToken.startsWith('opt1sq') || !senderAddr) { setTokenInfo(null); return; }
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = getContract<any>(sellToken, OP20_ABI, provider, NETWORK, senderAddr as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const balRes = await c.balanceOf(senderAddr as any);
        if (cancelled) return;
        if (!(balRes as CallResult).revert) {
          const p = (balRes as CallResult).properties as Record<string, unknown>;
          const bal = Number(BigInt(String(p?.balance || 0))) / 1e8;
          setTokenInfo({ symbol: sellToken.slice(-6).toUpperCase(), name: 'OP20 Token', balance: bal });
        }
      } catch { if (!cancelled) setTokenInfo(null); }
    })();
    return () => { cancelled = true; };
  }, [sellToken, senderAddr, provider]);

  // Create sell order
  const handleSell = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!sellToken || !sellAmount || !sellPrice) return;

    setSelling(true); setSellStep('Creating order...');
    try {
      const amount = parseFloat(sellAmount);
      const price = parseFloat(sellPrice);
      if (!amount || !price || amount <= 0 || price <= 0) throw new Error('Invalid amount or price');

      const order: Omit<Order, 'id'> = {
        seller: walletAddress,
        tokenAddress: sellToken,
        tokenSymbol: tokenInfo?.symbol || sellToken.slice(-6).toUpperCase(),
        tokenName: tokenInfo?.name || 'OP20 Token',
        amount,
        pricePerToken: price,
        totalPrice: Math.floor(amount * price),
        createdAt: Date.now(),
        status: 'active',
      };

      setSellStep('Posting order...');
      const res = await fetch(`${LP_API}/market/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error('Failed to create order');

      setSellStep('Order listed!');
      setSellToken(''); setSellAmount(''); setSellPrice('');
      setTokenInfo(null);
      await fetchOrders();
      setTimeout(() => setSellStep(''), 3000);
    } catch (e) {
      setSellStep(e instanceof Error ? e.message : 'Failed');
      setTimeout(() => setSellStep(''), 4000);
    } finally {
      setSelling(false);
    }
  }, [walletAddress, senderAddr, sellToken, sellAmount, sellPrice, tokenInfo, openConnectModal, fetchOrders]);

  // Buy order (simplified: records intent, actual settlement via transfer)
  const handleBuy = useCallback(async (order: Order) => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    setBuying(true); setBuyStep(`Buying ${order.tokenSymbol}...`);
    try {
      // Mark order as filled on server
      const res = await fetch(`${LP_API}/market/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, buyer: walletAddress }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error('Failed to fill order');

      setBuyStep('Order filled! Tokens will be transferred on-chain.');
      await fetchOrders();
      setTimeout(() => setBuyStep(''), 5000);
    } catch (e) {
      setBuyStep(formatTxError(e));
      setTimeout(() => setBuyStep(''), 4000);
    } finally {
      setBuying(false);
    }
  }, [walletAddress, senderAddr, openConnectModal, fetchOrders]);

  // Cancel order
  const handleCancel = useCallback(async (order: Order) => {
    try {
      await fetch(`${LP_API}/market/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, seller: walletAddress }),
        signal: AbortSignal.timeout(5000),
      });
      await fetchOrders();
    } catch { /* ignore */ }
  }, [walletAddress, fetchOrders]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => activeTab === 'my' ? o.seller === walletAddress : o.status === 'active');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => o.tokenSymbol.toLowerCase().includes(q) || o.tokenName.toLowerCase().includes(q) || o.tokenAddress.includes(q));
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [orders, search, activeTab, walletAddress]);

  /* ─── RENDER ─── */
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--w)', marginBottom: 4 }}>
          Marketplace
        </h2>
        <p style={{ fontSize: '.72rem', color: 'var(--t3)', margin: 0 }}>
          P2P token trading on OPNet. List tokens for sale, browse &amp; buy from other users.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {([['browse', 'Browse Orders'], ['sell', 'Sell Tokens'], ['my', 'My Orders']] as [MarketTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{
              padding: '8px 18px', borderRadius: 10, border: '1px solid ' + (activeTab === id ? 'rgba(247,147,26,.4)' : 'var(--bd)'),
              background: activeTab === id ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
              color: activeTab === id ? 'var(--o)' : 'var(--t3)',
              fontSize: '.74rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 600,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Browse / My Orders */}
      {(activeTab === 'browse' || activeTab === 'my') && (
        <div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by symbol or address..."
            style={{ ...iStyle, marginBottom: 12 }} />

          {buyStep && (
            <div style={{ padding: '10px 14px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.15)', borderRadius: 10, fontSize: '.72rem', color: 'var(--o)', marginBottom: 12 }}>
              {buyStep}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--t4)', fontSize: '.8rem' }}>Loading orders...</div>
          ) : filteredOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#x1F4E6;</div>
              <div style={{ color: 'var(--t4)', fontSize: '.82rem' }}>
                {activeTab === 'my' ? 'You have no orders yet' : 'No active orders. Be the first to list!'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredOrders.map(o => (
                <OrderCard
                  key={o.id}
                  order={o}
                  onBuy={handleBuy}
                  onCancel={handleCancel}
                  isMine={o.seller === walletAddress}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sell Tab */}
      {activeTab === 'sell' && (
        <div className="P" style={{ padding: 20, maxWidth: 480 }}>
          <div className="Lb" style={{ marginBottom: 12 }}>Create Sell Order</div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Token Contract Address</label>
            <input style={iStyle} value={sellToken} onChange={e => setSellToken(e.target.value)} placeholder="opt1sq..." />
            {tokenInfo && (
              <div style={{ fontSize: '.58rem', color: 'var(--g)', marginTop: 3 }}>
                Balance: {fmtNum(tokenInfo.balance)} {tokenInfo.symbol}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Amount to Sell</label>
              <input style={iStyle} type="text" inputMode="numeric" value={sellAmount}
                onChange={e => setSellAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="100000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Price (sats/token)</label>
              <input style={iStyle} type="text" inputMode="decimal" value={sellPrice}
                onChange={e => setSellPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.5" />
            </div>
          </div>

          {sellAmount && sellPrice && (
            <div style={{ padding: '8px 12px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 10, fontSize: '.68rem', color: 'var(--t3)', marginBottom: 12 }}>
              Total: <strong style={{ color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {fmtNum(Math.floor(parseFloat(sellAmount || '0') * parseFloat(sellPrice || '0')))} sats
              </strong>
              {' '}({(parseFloat(sellAmount || '0') * parseFloat(sellPrice || '0') / 1e8).toFixed(6)} BTC)
            </div>
          )}

          {sellStep && (
            <div style={{ padding: '8px 10px', borderRadius: 8, fontSize: '.68rem', marginBottom: 10, textAlign: 'center',
              color: sellStep.includes('listed') ? 'var(--g)' : sellStep.includes('Failed') ? '#ef4444' : 'var(--o)',
              background: sellStep.includes('listed') ? 'rgba(16,185,129,.06)' : 'rgba(247,147,26,.06)',
            }}>
              {sellStep}
            </div>
          )}

          <button onClick={handleSell} disabled={selling || !sellToken || !sellAmount || !sellPrice}
            className="lbtn" style={{ width: '100%', opacity: selling ? 0.6 : 1 }}>
            {selling ? sellStep || 'Creating...' : walletAddress ? 'List for Sale' : 'Connect Wallet'}
          </button>

          <div style={{ marginTop: 10, fontSize: '.56rem', color: 'var(--t4)', textAlign: 'center', lineHeight: 1.5 }}>
            Orders are matched P2P. Buyer pays BTC, seller's tokens transfer on-chain.
            <br />All trades happen on OPNet testnet.
          </div>
        </div>
      )}
    </div>
  );
};

export default Marketplace;
