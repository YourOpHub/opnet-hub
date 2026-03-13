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

  CREATE TABLE IF NOT EXISTS swap_operations (
    id TEXT PRIMARY KEY,
    market TEXT NOT NULL,
    order_id TEXT NOT NULL,
    wallet TEXT NOT NULL,
    direction TEXT NOT NULL,
    role TEXT NOT NULL,
    step TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    amounts TEXT DEFAULT '{}',
    tx_ids TEXT DEFAULT '{}',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS swap_rates (
    order_id TEXT PRIMARY KEY,
    send_sats TEXT,
    receive_sats TEXT,
    send_unit TEXT,
    receive_unit TEXT,
    rate REAL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_locks (
    order_key TEXT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at TEXT DEFAULT (datetime('now')),
    released INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pool_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_address TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    reserve0 TEXT NOT NULL,
    reserve1 TEXT NOT NULL,
    price REAL NOT NULL,
    tvl_sats REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_ts ON pool_snapshots(pool_address, timestamp);
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

const allowedOrigins = (process.env.CORS_ORIGINS || 'https://opnethub.xyz,https://yourophub.github.io,http://localhost:3000').split(',');
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

// M-01: stricter rate limits for write endpoints
const writeLimiter = rateLimit({ windowMs: 60_000, max: 15, standardHeaders: true, legacyHeaders: false });

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
    res.status(502).json({ error: 'Bob MCP upstream error' });
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
    res.status(502).json({ error: 'RPC error' });
  }
});

// ─── Player Sync (save game state to server) ───
app.post('/api/player/sync', writeLimiter, (req, res) => {
  const { address, mine_balance, total_sats_mined, total_clicks, hash_rate } = req.body;
  if (!address || typeof address !== 'string' || !address.startsWith('opt1') || address.length < 20) {
    return res.status(400).json({ error: 'Invalid address — must be opt1 format' });
  }

  // B-03 FIX: validate numeric fields
  const numBalance = typeof mine_balance === 'number' && isFinite(mine_balance) ? Math.max(0, mine_balance) : 0;
  const numSats = typeof total_sats_mined === 'number' && isFinite(total_sats_mined) ? Math.max(0, Math.floor(total_sats_mined)) : 0;
  const numClicks = typeof total_clicks === 'number' && isFinite(total_clicks) ? Math.max(0, Math.floor(total_clicks)) : 0;
  const numHash = typeof hash_rate === 'number' && isFinite(hash_rate) ? Math.max(0, hash_rate) : 0;

  // H-03: server-side rate validation — cap balance increase to max mining rate
  const existing = db.prepare('SELECT mine_balance, last_sync FROM players WHERE address = ?').get(address);
  const prevBalance = existing?.mine_balance || 0;
  const lastSync = existing?.last_sync ? new Date(existing.last_sync).getTime() : 0;
  const elapsed = lastSync ? Math.max(Date.now() - lastSync, 1000) : 60_000;
  const dailyRate = getDailyEmission();
  // Max possible earnings: daily rate per ms * elapsed * 2x tolerance
  const maxIncrease = (dailyRate / 86_400_000) * elapsed * 2;
  const cappedIncrease = Math.min(numBalance - prevBalance, maxIncrease);
  const validatedBalance = prevBalance + Math.max(0, cappedIncrease);

  const poolRemaining = MINE_GAME_POOL - getTotalDistributed();
  const cappedBalance = Math.min(validatedBalance, poolRemaining > 0 ? validatedBalance : 0);

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
const CLAIM_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// L-02: cooldown in SQLite (survives restart)
db.exec(`CREATE TABLE IF NOT EXISTS claim_cooldowns (
  address TEXT PRIMARY KEY,
  last_claim_at INTEGER NOT NULL
)`);

app.post('/api/claim', writeLimiter, (req, res) => {
  const { address, amount } = req.body;
  if (!address || typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid claim — amount must be a positive number' });
  }

  const cooldownRow = db.prepare('SELECT last_claim_at FROM claim_cooldowns WHERE address = ?').get(address);
  const lastClaim = cooldownRow?.last_claim_at || 0;
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
  db.prepare('INSERT INTO claim_cooldowns (address, last_claim_at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET last_claim_at = ?').run(address, Date.now(), Date.now());

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
  const key = req.headers['x-admin-key'];
  if (!key || key !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare('SELECT * FROM claims WHERE status = ? ORDER BY created_at ASC').all('pending');
  res.json(rows);
});

// ─── Token Indexer API ───
app.get('/api/tokens', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 2000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const tokens = indexer.getAllTokens(limit, offset);
    res.json(tokens);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

app.get('/api/tokens/status', (_req, res) => {
  try {
    res.json(indexer.getScanStatus());
  } catch (e) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post('/api/tokens/add', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || typeof address !== 'string' || (!address.startsWith('opt1') && !address.startsWith('0x'))) {
      return res.status(400).json({ error: 'Invalid address — must be opt1 or 0x format' });
    }
    const result = await indexer.addTokenByAddress(address);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add token' });
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
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// ─── Motoswap Pools API ───
app.get('/api/pools', (_req, res) => {
  try {
    const pools = indexer.getMotoswapPools();
    res.json(pools);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// ─── Swap Persistence API ───
app.post('/api/swap/update', (req, res) => {
  const { id, market, order_id, wallet, direction, role, step, status, amounts, tx_ids, error } = req.body;
  if (!id || !market || !wallet) return res.status(400).json({ error: 'id, market, wallet required' });
  const stmt = db.prepare(`
    INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status, amounts, tx_ids, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      step = COALESCE(?, step),
      status = COALESCE(?, status),
      amounts = COALESCE(?, amounts),
      tx_ids = COALESCE(?, tx_ids),
      error = COALESCE(?, error),
      updated_at = datetime('now')
  `);
  stmt.run(
    id, market, order_id || '', wallet, direction || '', role || '', step || '', status || 'active',
    JSON.stringify(amounts || {}), JSON.stringify(tx_ids || {}), error || '',
    step || null, status || null, amounts ? JSON.stringify(amounts) : null, tx_ids ? JSON.stringify(tx_ids) : null, error ?? null
  );
  res.json({ ok: true });
});

app.get('/api/swap/active/:wallet', (req, res) => {
  const { wallet } = req.params;
  const market = req.query.market || null;
  let rows;
  if (market) {
    rows = db.prepare('SELECT * FROM swap_operations WHERE wallet = ? AND status = ? AND market = ? ORDER BY updated_at DESC').all(wallet, 'active', market);
  } else {
    rows = db.prepare('SELECT * FROM swap_operations WHERE wallet = ? AND status = ? ORDER BY updated_at DESC').all(wallet, 'active');
  }
  res.json(rows);
});

app.get('/api/swap/history/:wallet', (req, res) => {
  const { wallet } = req.params;
  const market = req.query.market || null;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  let rows;
  if (market) {
    rows = db.prepare('SELECT * FROM swap_operations WHERE wallet = ? AND status != ? AND market = ? ORDER BY updated_at DESC LIMIT ?').all(wallet, 'active', market, limit);
  } else {
    rows = db.prepare('SELECT * FROM swap_operations WHERE wallet = ? AND status != ? ORDER BY updated_at DESC LIMIT ?').all(wallet, 'active', limit);
  }
  res.json(rows);
});

app.post('/api/orders/rate', (req, res) => {
  const { order_id, send_sats, receive_sats, send_unit, receive_unit, rate } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  db.prepare(`
    INSERT INTO swap_rates (order_id, send_sats, receive_sats, send_unit, receive_unit, rate, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET
      send_sats = ?, receive_sats = ?, send_unit = ?, receive_unit = ?, rate = ?, updated_at = datetime('now')
  `).run(order_id, send_sats || '', receive_sats || '', send_unit || '', receive_unit || '', rate || 0,
         send_sats || '', receive_sats || '', send_unit || '', receive_unit || '', rate || 0);
  res.json({ ok: true });
});

app.get('/api/orders/rates', (_req, res) => {
  const rows = db.prepare('SELECT * FROM swap_rates ORDER BY updated_at DESC').all();
  const map = {};
  for (const r of rows) map[r.order_id] = r;
  res.json(map);
});

// ─── Order Lock API ───
app.post('/api/swap/lock', writeLimiter, (req, res) => {
  const { order_key, wallet } = req.body;
  if (!order_key || !wallet) return res.status(400).json({ error: 'order_key, wallet required' });
  // Clean expired locks (>10 min)
  db.prepare("DELETE FROM order_locks WHERE released = 0 AND datetime(locked_at, '+10 minutes') < datetime('now')").run();
  const existing = db.prepare('SELECT * FROM order_locks WHERE order_key = ? AND released = 0').get(order_key);
  if (existing && existing.locked_by !== wallet) {
    return res.status(409).json({ error: 'Order locked by another user', locked_by: existing.locked_by.slice(0, 10) + '...' });
  }
  db.prepare(`INSERT INTO order_locks (order_key, locked_by, locked_at, released) VALUES (?, ?, datetime('now'), 0)
    ON CONFLICT(order_key) DO UPDATE SET locked_by = ?, locked_at = datetime('now'), released = 0`
  ).run(order_key, wallet, wallet);
  res.json({ ok: true, order_key });
});

app.post('/api/swap/unlock', (req, res) => {
  const { order_key, wallet } = req.body;
  if (!order_key || !wallet) return res.status(400).json({ error: 'order_key and wallet required' });
  // H-04: only the lock owner can unlock
  const lock = db.prepare('SELECT locked_by FROM order_locks WHERE order_key = ? AND released = 0').get(order_key);
  if (lock && lock.locked_by !== wallet) {
    return res.status(403).json({ error: 'Only lock owner can unlock' });
  }
  db.prepare('UPDATE order_locks SET released = 1 WHERE order_key = ? AND locked_by = ?').run(order_key, wallet);
  res.json({ ok: true });
});

app.get('/api/swap/locks', (_req, res) => {
  db.prepare("DELETE FROM order_locks WHERE released = 0 AND datetime(locked_at, '+10 minutes') < datetime('now')").run();
  const rows = db.prepare('SELECT order_key, locked_by, locked_at FROM order_locks WHERE released = 0').all();
  const map = {};
  for (const r of rows) map[r.order_key] = r;
  res.json(map);
});

// ─── Faucet Proxy (CORS bypass for faucet.opnet.org) ───
const FAUCET_UPSTREAM = process.env.FAUCET_URL || 'https://faucet.opnet.org';
const faucetLimiter = rateLimit({ windowMs: 300_000, max: 3, standardHeaders: true, legacyHeaders: false });
app.post('/api/faucet/claim', faucetLimiter, async (req, res) => {
  // R-03: disable faucet on mainnet
  if ((process.env.OPNET_NETWORK || 'testnet') === 'mainnet') {
    return res.status(403).json({ error: 'Faucet not available on mainnet' });
  }
  try {
    const upstream = await fetch(`${FAUCET_UPSTREAM}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Faucet upstream error' });
  }
});

// ─── Pool Snapshots API ───
const POOL_SNAPSHOT_ADDRESS = process.env.POOL_ADDRESS || 'opt1sqz6acsz9tkyfzzlg337x35swysmtp4u8kye8u2pv';
const POOL_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const GET_RESERVES_SELECTOR = '06374bfc';

/** Fetch pool reserves from RPC and save snapshot */
async function collectPoolSnapshot() {
  try {
    const calldata = GET_RESERVES_SELECTOR;
    const rpcBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'btc_call',
      params: [POOL_SNAPSHOT_ADDRESS, calldata],
    };
    const resp = await fetch(OPNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody),
    });
    const json = await resp.json();
    if (json.error) {
      console.error('[PoolSnapshot] RPC error:', json.error);
      return;
    }
    // Result is base64 on OPNet RPC
    let hex;
    if (json.result && typeof json.result === 'string') {
      // Try base64 first, fall back to hex
      try {
        hex = Buffer.from(json.result, 'base64').toString('hex');
      } catch {
        hex = json.result.replace(/^0x/, '');
      }
    } else if (json.result && json.result.result) {
      try {
        hex = Buffer.from(json.result.result, 'base64').toString('hex');
      } catch {
        hex = String(json.result.result).replace(/^0x/, '');
      }
    }
    if (!hex || hex.length < 128) {
      console.error('[PoolSnapshot] Invalid reserves hex, length:', hex?.length);
      return;
    }
    const reserve0Raw = BigInt('0x' + hex.slice(0, 64));
    const reserve1Raw = BigInt('0x' + hex.slice(64, 128));
    const reserve0 = Number(reserve0Raw) / 1e8;
    const reserve1 = Number(reserve1Raw) / 1e8;
    if (reserve0 <= 0 || reserve1 <= 0) {
      console.log('[PoolSnapshot] Reserves are zero, skipping');
      return;
    }
    const price = reserve1 / reserve0;
    const tvlSats = reserve0 + reserve1;
    const now = Date.now();

    // Deduplicate: skip if last snapshot < 5 min ago
    const lastSnap = db.prepare(
      'SELECT timestamp FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(POOL_SNAPSHOT_ADDRESS);
    if (lastSnap && now - lastSnap.timestamp < 5 * 60 * 1000) {
      return;
    }

    db.prepare(
      'INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(POOL_SNAPSHOT_ADDRESS, now, reserve0Raw.toString(), reserve1Raw.toString(), price, tvlSats);
    console.log(`[PoolSnapshot] Saved: MINE=${reserve0.toFixed(0)} VIBE=${reserve1.toFixed(0)} price=${price.toFixed(4)}`);

    // Prune old snapshots (keep last 2000 per pool)
    const count = db.prepare('SELECT COUNT(*) as c FROM pool_snapshots WHERE pool_address = ?').get(POOL_SNAPSHOT_ADDRESS);
    if (count && count.c > 2000) {
      db.prepare(
        'DELETE FROM pool_snapshots WHERE pool_address = ? AND id NOT IN (SELECT id FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 2000)'
      ).run(POOL_SNAPSHOT_ADDRESS, POOL_SNAPSHOT_ADDRESS);
    }
  } catch (e) {
    console.error('[PoolSnapshot] Error:', e.message);
  }
}

// Collect on startup + every 10 minutes
collectPoolSnapshot();
setInterval(collectPoolSnapshot, POOL_SNAPSHOT_INTERVAL_MS);

// GET /api/pool/history — return pool snapshots
app.get('/api/pool/history', (req, res) => {
  try {
    const pool = req.query.pool || POOL_SNAPSHOT_ADDRESS;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 2000);
    const rows = db.prepare(
      'SELECT timestamp, reserve0, reserve1, price, tvl_sats FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp ASC LIMIT ?'
    ).all(pool, limit);
    // Convert to frontend-friendly format
    const snapshots = rows.map(r => ({
      ts: r.timestamp,
      reserveMINE: Number(BigInt(r.reserve0)) / 1e8,
      reserveVIBE: Number(BigInt(r.reserve1)) / 1e8,
      rate: r.price,
    }));
    res.json({ pool, count: snapshots.length, snapshots });
  } catch (e) {
    console.error('[PoolHistory] Error:', e.message);
    res.status(500).json({ error: 'Failed to fetch pool history' });
  }
});

// POST /api/pool/snapshot — admin endpoint to manually record a snapshot
app.post('/api/pool/snapshot', writeLimiter, (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'Admin endpoint not configured' });
  }
  const key = req.headers['x-admin-key'];
  if (!key || key !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { pool_address, reserve0, reserve1, price, tvl_sats } = req.body;
  if (!pool_address || reserve0 == null || reserve1 == null) {
    return res.status(400).json({ error: 'pool_address, reserve0, reserve1 required' });
  }
  const now = Date.now();
  db.prepare(
    'INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(pool_address, now, String(reserve0), String(reserve1), price || 0, tvl_sats || 0);
  res.json({ ok: true, timestamp: now });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OPNet Hub Server] Running on port ${PORT}`);
  console.log(`[Bob MCP Proxy] → ${BOB_MCP_URL}`);
  console.log(`[OP_NET RPC Proxy] → ${OPNET_RPC}`);
  console.log(`[Pool Snapshots] Collecting every ${POOL_SNAPSHOT_INTERVAL_MS / 60000}min for ${POOL_SNAPSHOT_ADDRESS}`);
  console.log(`[$MINE] Pool: ${MINE_GAME_POOL.toLocaleString()} | Daily: ${getDailyEmission().toLocaleString()}`);
});
