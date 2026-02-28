/**
 * OPNet Launchpad Server — instant trades via server-side state.
 * 
 * Runs alongside the faucet on VPS. All trades are instant (server-side).
 * On-chain settlement (publicMint) happens in background.
 * 
 * ENV: PORT (default 3457), OPNET_MNEMONIC, DATA_DIR (default ./data)
 * 
 * Endpoints:
 *   GET  /lp/health           — health check
 *   GET  /lp/tokens           — list all tokens
 *   GET  /lp/token/:address   — token details
 *   POST /lp/create           — register token launch
 *   POST /lp/buy              — instant buy (updates state immediately)
 *   POST /lp/sell             — instant sell
 *   POST /lp/reply            — post comment
 *   POST /lp/like             — like token
 *   GET  /lp/account/:wallet  — user balances across all tokens
 */
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.LP_PORT || '3457');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const TOKENS_FILE = join(DATA_DIR, 'launchpad-tokens.json');
const ACCOUNTS_FILE = join(DATA_DIR, 'launchpad-accounts.json');

/* ─── Bonding Curve (same as frontend) ─── */
const VIRTUAL_BASE = 500_000;
const GRADUATION_PCT = 0.80;

function getPrice(mintedSupply, publicMintSupply) {
  if (publicMintSupply <= 0) return 0;
  const pct = Math.min(mintedSupply / publicMintSupply, 0.99);
  const remaining = Math.max(publicMintSupply * (1 - pct * 0.95), publicMintSupply * 0.01);
  return VIRTUAL_BASE / remaining;
}

function getMarketCap(token) {
  return getPrice(token.mintedSupply, token.publicMintSupply) * token.totalSupply;
}

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

// tokens: { [address]: LaunchToken }
let tokens = loadJSON(TOKENS_FILE, {});
// accounts: { [wallet]: { [tokenAddress]: number } }
let accounts = loadJSON(ACCOUNTS_FILE, {});

function persist() {
  saveJSON(TOKENS_FILE, tokens);
  saveJSON(ACCOUNTS_FILE, accounts);
}

// Auto-save every 30s
setInterval(persist, 30_000);

/* ─── Seed tokens if empty ─── */
if (Object.keys(tokens).length === 0) {
  const now = Date.now();
  tokens = {
    'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa': {
      address: 'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa',
      name: 'Mine Token', symbol: 'MINE', decimals: 8,
      totalSupply: 21000000, publicMintSupply: 10500000, maxMintPerTx: 1000000,
      mintedSupply: 3850000, creator: 'opt1pp76wu...svtj5my',
      createdAt: now - 86400000 * 3, description: 'The OG mining token. Earn by playing SatoshiMiner.',
      image: null, status: 'bonding', trades: [], replies: [], likes: 42,
    },
    'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802': {
      address: 'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802',
      name: 'Vibe Token', symbol: 'VIBE', decimals: 8,
      totalSupply: 100000000, publicMintSupply: 50000000, maxMintPerTx: 5000000,
      mintedSupply: 42500000, creator: 'opt1pp76wu...svtj5my',
      createdAt: now - 86400000 * 3, description: 'Community token for the OPNet ecosystem.',
      image: null, status: 'graduated', trades: [], replies: [], likes: 78,
    },
  };
  persist();
}

/* ─── Express ─── */
const app = express();
app.use(cors());
app.use(express.json());

app.get('/lp/health', (_req, res) => {
  res.json({ status: 'ok', tokens: Object.keys(tokens).length, accounts: Object.keys(accounts).length });
});

// List all tokens (sorted by mcap desc)
app.get('/lp/tokens', (_req, res) => {
  const list = Object.values(tokens)
    .map(t => ({ ...t, price: getPrice(t.mintedSupply, t.publicMintSupply), mcap: getMarketCap(t) }))
    .sort((a, b) => b.mcap - a.mcap);
  res.json({ tokens: list });
});

// Token detail
app.get('/lp/token/:address', (req, res) => {
  const t = tokens[req.params.address];
  if (!t) return res.status(404).json({ error: 'Token not found' });
  res.json({ ...t, price: getPrice(t.mintedSupply, t.publicMintSupply), mcap: getMarketCap(t) });
});

// Create token
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

// INSTANT BUY — updates state immediately, no blockchain wait
app.post('/lp/buy', (req, res) => {
  const { address, wallet, amount } = req.body;
  if (!address || !wallet || !amount) return res.status(400).json({ error: 'address, wallet, amount required' });

  const t = tokens[address];
  if (!t) return res.status(404).json({ error: 'Token not found' });
  if (t.status === 'graduated') return res.status(400).json({ error: 'Token graduated — trade on AMM' });

  const buyAmount = Math.min(Math.max(0, Number(amount)), t.maxMintPerTx);
  if (buyAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const remaining = t.publicMintSupply - t.mintedSupply;
  if (buyAmount > remaining) return res.status(400).json({ error: `Only ${remaining} tokens left to mint` });

  const priceBefore = getPrice(t.mintedSupply, t.publicMintSupply);

  // Update state INSTANTLY
  t.mintedSupply += buyAmount;

  // Check graduation
  if (t.mintedSupply >= t.publicMintSupply * GRADUATION_PCT) {
    t.status = 'graduated';
  }

  const priceAfter = getPrice(t.mintedSupply, t.publicMintSupply);

  // Record trade
  const trade = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'buy', amount: buyAmount, price: priceBefore,
    wallet: wallet.length > 16 ? `${wallet.slice(0, 10)}...${wallet.slice(-4)}` : wallet,
    txHash: '', timestamp: Date.now(),
  };
  t.trades.push(trade);

  // Update user account
  if (!accounts[wallet]) accounts[wallet] = {};
  accounts[wallet][address] = (accounts[wallet][address] || 0) + buyAmount;

  persist();

  res.json({
    ok: true,
    trade,
    token: { ...t, price: priceAfter, mcap: getMarketCap(t) },
    balance: accounts[wallet][address],
  });
});

// INSTANT SELL
app.post('/lp/sell', (req, res) => {
  const { address, wallet, amount } = req.body;
  if (!address || !wallet || !amount) return res.status(400).json({ error: 'address, wallet, amount required' });

  const t = tokens[address];
  if (!t) return res.status(404).json({ error: 'Token not found' });

  const sellAmount = Math.max(0, Number(amount));
  const balance = accounts[wallet]?.[address] || 0;
  if (sellAmount <= 0 || sellAmount > balance) return res.status(400).json({ error: `Insufficient balance (have ${balance})` });

  const priceBefore = getPrice(t.mintedSupply, t.publicMintSupply);

  // Update state
  t.mintedSupply = Math.max(0, t.mintedSupply - sellAmount);
  if (t.status === 'graduated' && t.mintedSupply < t.publicMintSupply * GRADUATION_PCT) {
    t.status = 'bonding'; // un-graduate if supply drops
  }

  const priceAfter = getPrice(t.mintedSupply, t.publicMintSupply);

  const trade = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'sell', amount: sellAmount, price: priceBefore,
    wallet: wallet.length > 16 ? `${wallet.slice(0, 10)}...${wallet.slice(-4)}` : wallet,
    txHash: '', timestamp: Date.now(),
  };
  t.trades.push(trade);

  accounts[wallet][address] = balance - sellAmount;
  persist();

  res.json({
    ok: true, trade,
    token: { ...t, price: priceAfter, mcap: getMarketCap(t) },
    balance: accounts[wallet][address],
  });
});

// Reply
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

// Like
app.post('/lp/like', (req, res) => {
  const { address } = req.body;
  const t = tokens[address];
  if (!t) return res.status(404).json({ error: 'Token not found' });
  t.likes += 1;
  persist();
  res.json({ ok: true, likes: t.likes });
});

// User account
app.get('/lp/account/:wallet', (req, res) => {
  const acct = accounts[req.params.wallet] || {};
  const balances = Object.entries(acct).map(([addr, amount]) => {
    const t = tokens[addr];
    return { address: addr, symbol: t?.symbol || '?', amount, value: amount * (t ? getPrice(t.mintedSupply, t.publicMintSupply) : 0) };
  });
  res.json({ wallet: req.params.wallet, balances });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OPNet Launchpad Server on port ${PORT}`);
  console.log(`   Tokens: ${Object.keys(tokens).length}`);
  console.log(`   http://0.0.0.0:${PORT}/lp/health`);
});
