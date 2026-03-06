require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');

const { TokenIndexer } = require('./token-indexer');
const { FractalSwapRelayer } = require('./fractalswap-relayer');

const app = express();
const PORT = process.env.PORT || 4000;
const BOB_MCP_URL = process.env.BOB_MCP_URL || 'https://ai.opnet.org/mcp';
const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';

// ─── Database ───
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    address TEXT PRIMARY KEY,
    mine_balance REAL DEFAULT 0,
    total_sats_mined INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    hash_rate REAL DEFAULT 0,
    last_sync TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    amount REAL NOT NULL,
    tx_hash TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leaderboard_cache (
    address TEXT PRIMARY KEY,
    mine_balance REAL DEFAULT 0,
    total_sats_mined INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0
  );
`);

// ─── Token Indexer ───
const indexer = new TokenIndexer(db);
indexer.init();
indexer.start();

// ─── FractalSwap Relayer ───
const relayer = new FractalSwapRelayer();
relayer.start().catch(e => console.error('[Relayer] Start failed:', e.message));

// ─── Middleware ───
app.set('trust proxy', 1); // Trust first proxy (nginx)
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const allowedOrigins = (process.env.CORS_ORIGINS || 'https://yourophub.github.io,http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS blocked'));
  },
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ─── $MINE Token Constants ───
const MINE_TOTAL_SUPPLY = 21_000_000;
const MINE_GAME_POOL = 10_500_000;
const MINE_DAILY_BASE = 350_000;
const MINE_HALVING_DAYS = 7;
const MINE_PER_SAT = 0.001;
const LAUNCH_DATE = new Date('2026-02-26T00:00:00Z');

function getDailyEmission() {
  const days = Math.floor((Date.now() - LAUNCH_DATE.getTime()) / 86400000);
  const halvings = Math.floor(days / MINE_HALVING_DAYS);
  return MINE_DAILY_BASE / Math.pow(2, halvings);
}

function getTotalDistributed() {
  const row = db.prepare('SELECT SUM(mine_balance) as total FROM players').get();
  return row?.total || 0;
}

// ─── Health ───
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    mine: {
      totalSupply: MINE_TOTAL_SUPPLY,
      gamePool: MINE_GAME_POOL,
      dailyEmission: getDailyEmission(),
      totalDistributed: getTotalDistributed(),
      poolRemaining: MINE_GAME_POOL - getTotalDistributed(),
    },
  });
});

// ─── Bob MCP Proxy (CORS bypass) ───
// Each request creates/uses its own session via client-provided header
app.post('/api/bob', async (req, res) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    // Forward client's session ID if provided (no server-side shared session)
    const clientSid = req.headers['mcp-session-id'];
    if (clientSid) headers['Mcp-Session-Id'] = clientSid;

    const upstream = await fetch(BOB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const sid = upstream.headers.get('mcp-session-id');
    if (sid) res.set('Mcp-Session-Id', sid);

    const text = await upstream.text();
    res.set('Content-Type', 'text/plain');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Bob MCP upstream error', message: e.message });
  }
});

// ─── OP_NET RPC Proxy ───
const RPC_ALLOWED_METHODS = new Set([
  'btc_blockNumber', 'btc_chainId', 'btc_gas',
  'btc_getBlockByNumber', 'btc_getBlockByHash',
  'btc_getBalance', 'btc_getUTXOs', 'btc_getCode', 'btc_getStorageAt',
  'btc_call', 'btc_getPublicKeyInfo',
  'btc_getTransactionByHash', 'btc_getTransactionReceipt',
  'btc_getMempoolInfo', 'btc_latestEpoch',
  'btc_getLatestPendingTransactions',
]);

app.post('/api/rpc', async (req, res) => {
  try {
    const { method } = req.body || {};
    if (!method || !RPC_ALLOWED_METHODS.has(method)) {
      return res.status(400).json({ error: 'Method not allowed', method });
    }
    const upstream = await fetch(OPNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'RPC error', message: e.message });
  }
});

// ─── Player Sync (save game state to server) ───
app.post('/api/player/sync', (req, res) => {
  const { address, mine_balance, total_sats_mined, total_clicks, hash_rate } = req.body;
  if (!address || typeof address !== 'string' || !address.startsWith('opt1') || address.length < 20) {
    return res.status(400).json({ error: 'Invalid address — must be opt1 format' });
  }

  // B-03 FIX: validate numeric fields
  const numBalance = typeof mine_balance === 'number' && isFinite(mine_balance) ? Math.max(0, mine_balance) : 0;
  const numSats = typeof total_sats_mined === 'number' && isFinite(total_sats_mined) ? Math.max(0, Math.floor(total_sats_mined)) : 0;
  const numClicks = typeof total_clicks === 'number' && isFinite(total_clicks) ? Math.max(0, Math.floor(total_clicks)) : 0;
  const numHash = typeof hash_rate === 'number' && isFinite(hash_rate) ? Math.max(0, hash_rate) : 0;

  const poolRemaining = MINE_GAME_POOL - getTotalDistributed();
  const cappedBalance = Math.min(numBalance, poolRemaining > 0 ? numBalance : 0);

  const stmt = db.prepare(`
    INSERT INTO players (address, mine_balance, total_sats_mined, total_clicks, hash_rate, last_sync, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(address) DO UPDATE SET
      mine_balance = ?,
      total_sats_mined = ?,
      total_clicks = ?,
      hash_rate = ?,
      last_sync = datetime('now'),
      updated_at = datetime('now')
  `);

  stmt.run(address, cappedBalance, numSats, numClicks, numHash,
           cappedBalance, numSats, numClicks, numHash);

  res.json({ ok: true, mine_balance: cappedBalance, pool_remaining: poolRemaining });
});

// ─── Get Player ───
app.get('/api/player/:address', (req, res) => {
  const row = db.prepare('SELECT * FROM players WHERE address = ?').get(req.params.address);
  if (!row) return res.status(404).json({ error: 'Player not found' });
  res.json(row);
});

// ─── Claim $MINE tokens ───
const claimCooldowns = new Map(); // address → timestamp
const CLAIM_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

app.post('/api/claim', (req, res) => {
  const { address, amount } = req.body;
  if (!address || typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid claim — amount must be a positive number' });
  }

  const lastClaim = claimCooldowns.get(address);
  if (lastClaim && Date.now() - lastClaim < CLAIM_COOLDOWN_MS) {
    const waitSec = Math.ceil((CLAIM_COOLDOWN_MS - (Date.now() - lastClaim)) / 1000);
    return res.status(429).json({ error: `Claim cooldown: wait ${waitSec}s` });
  }

  const player = db.prepare('SELECT * FROM players WHERE address = ?').get(address);
  if (!player) return res.status(404).json({ error: 'Player not found. Sync first.' });
  if (player.mine_balance < amount) {
    return res.status(400).json({ error: 'Insufficient MINE balance', available: player.mine_balance });
  }

  // Create pending claim
  const claim = db.prepare('INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)').run(address, amount, 'pending');

  // Deduct from player balance
  db.prepare('UPDATE players SET mine_balance = mine_balance - ? WHERE address = ?').run(amount, address);
  claimCooldowns.set(address, Date.now());

  res.json({
    ok: true,
    claim_id: claim.lastInsertRowid,
    amount,
    status: 'pending',
    message: 'Claim created. Token transfer will be processed on-chain via OP_NET.',
  });
});

// ─── Leaderboard ───
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
  const rows = db.prepare(`
    SELECT address, mine_balance, total_sats_mined, hash_rate,
           ROW_NUMBER() OVER (ORDER BY mine_balance DESC) as rank
    FROM players
    ORDER BY mine_balance DESC
    LIMIT ?
  `).all(limit);
  res.json({
    leaderboard: rows,
    stats: {
      total_players: db.prepare('SELECT COUNT(*) as c FROM players').get()?.c || 0,
      total_distributed: getTotalDistributed(),
      pool_remaining: MINE_GAME_POOL - getTotalDistributed(),
      daily_emission: getDailyEmission(),
    },
  });
});

// ─── Token Info ───
app.get('/api/token', (_req, res) => {
  const distributed = getTotalDistributed();
  res.json({
    name: 'Mine Token',
    symbol: 'MINE',
    decimals: 8,
    totalSupply: MINE_TOTAL_SUPPLY,
    gamePool: MINE_GAME_POOL,
    distributed,
    poolRemaining: MINE_GAME_POOL - distributed,
    dailyEmission: getDailyEmission(),
    halvingInterval: `${MINE_HALVING_DAYS} days`,
    launchDate: LAUNCH_DATE.toISOString(),
    conversionRate: `${MINE_PER_SAT} MINE per sat`,
    contract: process.env.MINE_CONTRACT_ADDRESS || 'pending deployment',
  });
});

// ─── Pending Claims (admin, requires API key) ───
app.get('/api/claims/pending', (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'Admin endpoint not configured' });
  }
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!key || key !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare('SELECT * FROM claims WHERE status = ? ORDER BY created_at ASC').all('pending');
  res.json(rows);
});

// ─── Token Indexer API ───
app.get('/api/tokens', (_req, res) => {
  try {
    const tokens = indexer.getAllTokens();
    res.json(tokens);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch tokens', message: e.message });
  }
});

app.get('/api/holder/:pubkey/tokens', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const tweaked = req.query.tweaked || '';
    if (!pubkey || pubkey.length < 10) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }
    const balances = await indexer.getHolderBalances(pubkey, tweaked);
    res.json(balances);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch balances', message: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OPNet Hub Server] Running on port ${PORT}`);
  console.log(`[Bob MCP Proxy] → ${BOB_MCP_URL}`);
  console.log(`[OP_NET RPC Proxy] → ${OPNET_RPC}`);
  console.log(`[$MINE] Pool: ${MINE_GAME_POOL.toLocaleString()} | Daily: ${getDailyEmission().toLocaleString()}`);
});
