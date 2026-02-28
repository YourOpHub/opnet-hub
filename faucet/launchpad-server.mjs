/**
 * OPNet Launchpad + Marketplace Server
 * 
 * Token registry (social layer) + P2P marketplace orders.
 * All minting happens on-chain via publicMint (not through this server).
 * 
 * ENV: PORT (default 3457), DATA_DIR (default ./data)
 * 
 * Endpoints:
 *   GET  /lp/health              — health check
 *   GET  /lp/tokens              — list all tokens
 *   GET  /lp/token/:address      — token details
 *   POST /lp/create              — register token launch
 *   POST /lp/reply               — post comment
 *   POST /lp/like                — like token
 *
 *   GET  /market/orders           — list all marketplace orders
 *   POST /market/create           — create sell order
 *   POST /market/fill             — fill (buy) order
 *   POST /market/cancel           — cancel own order
 */
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.LP_PORT || '3457');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const TOKENS_FILE = join(DATA_DIR, 'launchpad-tokens.json');
const ORDERS_FILE = join(DATA_DIR, 'marketplace-orders.json');

/* ─── Data persistence ─── */
function loadJSON(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {}
  return fallback;
}

function saveJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let tokens = loadJSON(TOKENS_FILE, {});
let orders = loadJSON(ORDERS_FILE, []);

function persist() {
  saveJSON(TOKENS_FILE, tokens);
  saveJSON(ORDERS_FILE, orders);
}

setInterval(persist, 30_000);

/* ─── Seed with real contracts only ─── */
if (Object.keys(tokens).length === 0) {
  const now = Date.now();
  const seed = [
    { address: 'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa', name: 'Mine Token', symbol: 'MINE', totalSupply: 21000000, publicMintSupply: 10500000, maxMintPerTx: 1000000, mintedSupply: 0, creator: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my', createdAt: now - 86400000*2, description: 'The OG mining token. Earn by playing SatoshiMiner, trade on AMM.', status: 'bonding', txHash: '25843e9643ef623ea0d07fd196da277536b37156f90e1d0a718ebaa58d577cf0', website: 'opnet.org', twitter: 'opaboratory' },
    { address: 'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802', name: 'Vibe Token', symbol: 'VIBE', totalSupply: 100000000, publicMintSupply: 50000000, maxMintPerTx: 5000000, mintedSupply: 0, creator: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my', createdAt: now - 86400000*2, description: 'Community token for the OPNet ecosystem. Good vibes only.', status: 'bonding', txHash: 'bfbe3f54be4f56069976e3511ab4a4834462c28469412e1d20cb84746622b46b', website: 'opnet.org', twitter: 'opaboratory' },
  ];
  for (const t of seed) {
    tokens[t.address] = { ...t, decimals: 8, image: null, telegram: undefined, trades: [], replies: [], likes: 0 };
  }
  persist();
}

/* ─── Express ─── */
const app = express();
app.use(cors());
app.use(express.json());

// ═══ LAUNCHPAD ENDPOINTS ═══

app.get('/lp/health', (_req, res) => {
  res.json({ status: 'ok', tokens: Object.keys(tokens).length, orders: orders.length });
});

app.get('/lp/tokens', (_req, res) => {
  const list = Object.values(tokens).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ tokens: list });
});

app.get('/lp/token/:address', (req, res) => {
  const t = tokens[req.params.address];
  if (!t) return res.status(404).json({ error: 'Token not found' });
  res.json(t);
});

app.post('/lp/create', (req, res) => {
  const { address, name, symbol, decimals, totalSupply, publicMintSupply, maxMintPerTx, creator, description, image, website, twitter, telegram, txHash } = req.body;
  if (!address || !name || !symbol) return res.status(400).json({ error: 'address, name, symbol required' });
  if (tokens[address]) return res.status(409).json({ error: 'Token already exists' });

  tokens[address] = {
    address, name, symbol, decimals: decimals || 8,
    totalSupply: totalSupply || 1000000000,
    publicMintSupply: publicMintSupply || (totalSupply || 1000000000) / 2,
    maxMintPerTx: maxMintPerTx || 10000000,
    mintedSupply: 0, creator: creator || 'unknown',
    createdAt: Date.now(), description: description || '',
    image: image || null, website, twitter, telegram,
    status: 'bonding', txHash, trades: [], replies: [], likes: 0,
  };
  persist();
  res.json({ ok: true, token: tokens[address] });
});

app.post('/lp/reply', (req, res) => {
  const { address, wallet, text } = req.body;
  if (!address || !wallet || !text) return res.status(400).json({ error: 'address, wallet, text required' });
  const t = tokens[address];
  if (!t) return res.status(404).json({ error: 'Token not found' });

  const reply = {
    id: `r_${Date.now()}`,
    wallet: wallet.length > 16 ? `${wallet.slice(0, 10)}...${wallet.slice(-4)}` : wallet,
    text: text.slice(0, 500), timestamp: Date.now(),
  };
  t.replies.push(reply);
  persist();
  res.json({ ok: true, reply });
});

app.post('/lp/like', (req, res) => {
  const { address } = req.body;
  const t = tokens[address];
  if (!t) return res.status(404).json({ error: 'Token not found' });
  t.likes += 1;
  persist();
  res.json({ ok: true, likes: t.likes });
});

// ═══ MARKETPLACE ENDPOINTS ═══
// Orders support: sell (user lists tokens), buy (user wants tokens, offers sats)
// Partial fills: amountFilled tracks progress, order stays active until fully filled

// List orders — optionally filter by token
app.get('/market/orders', (req, res) => {
  let filtered = orders;
  if (req.query.token) {
    const q = req.query.token.toLowerCase();
    filtered = orders.filter(o =>
      o.tokenAddress.toLowerCase() === q ||
      o.tokenSymbol.toLowerCase().includes(q) ||
      o.tokenName.toLowerCase().includes(q)
    );
  }
  if (req.query.status) {
    filtered = filtered.filter(o => o.status === req.query.status);
  }
  res.json({ orders: filtered.sort((a, b) => b.createdAt - a.createdAt) });
});

// List unique tokens that have orders
app.get('/market/tokens', (_req, res) => {
  const tokenMap = {};
  for (const o of orders) {
    if (!tokenMap[o.tokenAddress]) {
      tokenMap[o.tokenAddress] = {
        address: o.tokenAddress, symbol: o.tokenSymbol, name: o.tokenName,
        sellCount: 0, buyCount: 0, totalVolume: 0,
      };
    }
    const t = tokenMap[o.tokenAddress];
    if (o.type === 'sell') t.sellCount++; else t.buyCount++;
    t.totalVolume += o.amount;
  }
  // Also include registered tokens from launchpad
  for (const t of Object.values(tokens)) {
    if (!tokenMap[t.address]) {
      tokenMap[t.address] = {
        address: t.address, symbol: t.symbol, name: t.name,
        sellCount: 0, buyCount: 0, totalVolume: 0,
      };
    }
  }
  const list = Object.values(tokenMap).sort((a, b) => b.totalVolume - a.totalVolume);
  res.json({ tokens: list });
});

// Create order (sell or buy)
app.post('/market/create', (req, res) => {
  const { type, creator, tokenAddress, tokenSymbol, tokenName, amount, pricePerToken } = req.body;
  const orderType = type || 'sell';
  if (!creator || !tokenAddress || !amount || !pricePerToken) {
    return res.status(400).json({ error: 'creator, tokenAddress, amount, pricePerToken required' });
  }
  if (!['sell', 'buy'].includes(orderType)) {
    return res.status(400).json({ error: 'type must be sell or buy' });
  }

  const amt = Number(amount);
  const ppt = Number(pricePerToken);
  if (amt <= 0 || ppt <= 0) return res.status(400).json({ error: 'amount and pricePerToken must be > 0' });

  const order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: orderType,
    creator,
    tokenAddress,
    tokenSymbol: tokenSymbol || (tokens[tokenAddress]?.symbol) || tokenAddress.slice(-6).toUpperCase(),
    tokenName: tokenName || (tokens[tokenAddress]?.name) || 'OP20 Token',
    amount: amt,
    amountFilled: 0,
    pricePerToken: ppt,
    totalPrice: Math.round(amt * ppt),
    createdAt: Date.now(),
    status: 'active',
    fills: [],
  };

  orders.push(order);
  persist();
  res.json({ ok: true, order });
});

// Fill order (partial or full)
app.post('/market/fill', (req, res) => {
  const { orderId, filler, amount } = req.body;
  if (!orderId || !filler) return res.status(400).json({ error: 'orderId, filler required' });

  const order = orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'active') return res.status(400).json({ error: 'Order is not active' });
  if (order.creator === filler) return res.status(400).json({ error: 'Cannot fill your own order' });

  const remaining = order.amount - order.amountFilled;
  const fillAmt = amount ? Math.min(Number(amount), remaining) : remaining;
  if (fillAmt <= 0) return res.status(400).json({ error: 'Nothing left to fill' });

  order.amountFilled += fillAmt;
  const fill = {
    id: `fill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    filler,
    amount: fillAmt,
    price: fillAmt * order.pricePerToken,
    timestamp: Date.now(),
  };
  order.fills.push(fill);

  if (order.amountFilled >= order.amount) {
    order.status = 'filled';
    order.filledAt = Date.now();
  }

  persist();
  res.json({ ok: true, order, fill });
});

// Cancel order
app.post('/market/cancel', (req, res) => {
  const { orderId, creator } = req.body;
  if (!orderId || !creator) return res.status(400).json({ error: 'orderId, creator required' });

  const order = orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.creator !== creator) return res.status(403).json({ error: 'Not your order' });
  if (order.status !== 'active') return res.status(400).json({ error: 'Order is not active' });

  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  persist();
  res.json({ ok: true, order });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OPNet Launchpad + Marketplace on port ${PORT}`);
  console.log(`   Tokens: ${Object.keys(tokens).length} | Orders: ${orders.length}`);
  console.log(`   http://0.0.0.0:${PORT}/lp/health`);
});
