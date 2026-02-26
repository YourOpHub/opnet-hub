#!/bin/bash
# ═══════════════════════════════════════════════
# OPNet Hub VPS Setup — ONE COMMAND INSTALL
# Run on VPS: curl -sL <url> | bash
# Or paste this entire script into SSH terminal
# ═══════════════════════════════════════════════
set -e

echo "═══ OPNet Hub Server Setup ═══"
echo ""

# 1. Install Node.js 20
if ! command -v node &> /dev/null; then
    echo "[1/7] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/7] Node.js $(node -v) OK"
fi

# 2. Create app dir
echo "[2/7] Creating /opt/opnet-hub..."
mkdir -p /opt/opnet-hub
cd /opt/opnet-hub

# 3. Write package.json
echo "[3/7] Writing package.json..."
cat > package.json << 'PKGJSON'
{
  "name": "opnet-hub-server",
  "version": "1.0.0",
  "description": "OPNet Hub backend",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.3.1"
  }
}
PKGJSON

# 4. Write .env
echo "[4/7] Writing .env..."
cat > .env << 'ENVFILE'
PORT=4000
NODE_ENV=production
BOB_MCP_URL=https://ai.opnet.org/mcp
OPNET_RPC_URL=https://testnet.opnet.org/api/v1/json-rpc
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
CORS_ORIGINS=https://yourophub.github.io,http://localhost:3000
MINE_CONTRACT_ADDRESS=
ENVFILE

# 5. Write server code
echo "[5/7] Writing server index.js..."
cat > index.js << 'SERVERJS'
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const BOB_MCP_URL = process.env.BOB_MCP_URL || 'https://ai.opnet.org/mcp';
const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';

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
`);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
const origins = (process.env.CORS_ORIGINS || '').split(',');
app.use(cors({ origin: (o, cb) => { if (!o || origins.includes(o)) cb(null, true); else cb(new Error('CORS')); }, credentials: true }));
app.use(rateLimit({ windowMs: 60000, max: 100, standardHeaders: true, legacyHeaders: false }));

const MINE_POOL = 10500000;
const MINE_DAILY = 350000;
const MINE_HALVING = 7;
const LAUNCH = new Date('2025-02-26T00:00:00Z');
function emission() { return MINE_DAILY / Math.pow(2, Math.floor((Date.now() - LAUNCH.getTime()) / 86400000 / MINE_HALVING)); }
function distributed() { return db.prepare('SELECT COALESCE(SUM(mine_balance),0) as t FROM players').get().t; }

// Health
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime(), mine: { pool: MINE_POOL, distributed: distributed(), remaining: MINE_POOL - distributed(), dailyEmission: emission() } }));

// Bob MCP Proxy
let mcpSid = null;
app.post('/api/bob', async (req, res) => {
  try {
    const h = { 'Content-Type': 'application/json' };
    if (mcpSid) h['Mcp-Session-Id'] = mcpSid;
    const r = await fetch(BOB_MCP_URL, { method: 'POST', headers: h, body: JSON.stringify(req.body) });
    const sid = r.headers.get('mcp-session-id');
    if (sid) mcpSid = sid;
    res.set('Content-Type', 'text/plain').send(await r.text());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// OP_NET RPC Proxy
app.post('/api/rpc', async (req, res) => {
  try {
    const r = await fetch(OPNET_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    res.json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Player sync
app.post('/api/player/sync', (req, res) => {
  const { address, mine_balance, total_sats_mined, total_clicks, hash_rate } = req.body;
  if (!address || address.length < 10) return res.status(400).json({ error: 'bad address' });
  const rem = MINE_POOL - distributed();
  const bal = Math.min(mine_balance || 0, rem > 0 ? mine_balance : 0);
  db.prepare(`INSERT INTO players (address,mine_balance,total_sats_mined,total_clicks,hash_rate,last_sync,updated_at) VALUES(?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(address) DO UPDATE SET mine_balance=?,total_sats_mined=?,total_clicks=?,hash_rate=?,last_sync=datetime('now'),updated_at=datetime('now')`).run(address,bal,total_sats_mined||0,total_clicks||0,hash_rate||0,bal,total_sats_mined||0,total_clicks||0,hash_rate||0);
  res.json({ ok: true, mine_balance: bal, pool_remaining: rem });
});

// Get player
app.get('/api/player/:addr', (req, res) => {
  const r = db.prepare('SELECT * FROM players WHERE address=?').get(req.params.addr);
  r ? res.json(r) : res.status(404).json({ error: 'not found' });
});

// Claim
app.post('/api/claim', (req, res) => {
  const { address, amount } = req.body;
  if (!address || !amount || amount <= 0) return res.status(400).json({ error: 'invalid' });
  const p = db.prepare('SELECT * FROM players WHERE address=?').get(address);
  if (!p) return res.status(404).json({ error: 'sync first' });
  if (p.mine_balance < amount) return res.status(400).json({ error: 'insufficient', available: p.mine_balance });
  const c = db.prepare('INSERT INTO claims (address,amount,status) VALUES(?,?,?)').run(address, amount, 'pending');
  db.prepare('UPDATE players SET mine_balance=mine_balance-? WHERE address=?').run(amount, address);
  res.json({ ok: true, claim_id: c.lastInsertRowid, amount, status: 'pending' });
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const lim = Math.min(parseInt(req.query.limit) || 50, 100);
  const rows = db.prepare('SELECT address,mine_balance,total_sats_mined,hash_rate,ROW_NUMBER() OVER (ORDER BY mine_balance DESC) as rank FROM players ORDER BY mine_balance DESC LIMIT ?').all(lim);
  res.json({ leaderboard: rows, stats: { players: db.prepare('SELECT COUNT(*) as c FROM players').get().c, distributed: distributed(), remaining: MINE_POOL - distributed(), emission: emission() } });
});

// Token info
app.get('/api/token', (_, res) => {
  const d = distributed();
  res.json({ name: 'Mine Token', symbol: 'MINE', decimals: 8, totalSupply: 21000000, gamePool: MINE_POOL, distributed: d, remaining: MINE_POOL - d, dailyEmission: emission(), halving: MINE_HALVING + ' days', contract: process.env.MINE_CONTRACT_ADDRESS || 'pending' });
});

// Pending claims
app.get('/api/claims/pending', (_, res) => res.json(db.prepare("SELECT * FROM claims WHERE status='pending' ORDER BY created_at").all()));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OPNet Hub] :${PORT} | Bob→${BOB_MCP_URL} | RPC→${OPNET_RPC}`);
  console.log(`[$MINE] Pool:${MINE_POOL} Daily:${emission()}`);
});
SERVERJS

# 6. Install deps
echo "[6/7] Installing npm dependencies..."
npm install --production 2>&1 | tail -3

# 7. Setup nginx + systemd
echo "[7/7] Configuring nginx + systemd..."

cat > /etc/nginx/sites-available/opnet-hub << 'NGINX'
server {
    listen 80;
    server_name _;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Mcp-Session-Id" always;

    location /api/ {
        if ($request_method = OPTIONS) { return 204; }
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
    location /health {
        proxy_pass http://127.0.0.1:4000/health;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/opnet-hub /etc/nginx/sites-enabled/opnet-hub
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

cat > /etc/systemd/system/opnet-hub.service << 'SVC'
[Unit]
Description=OPNet Hub Backend
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=/opt/opnet-hub
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable opnet-hub
systemctl restart opnet-hub

sleep 2

echo ""
echo "═══════════════════════════════════════"
echo "  OPNet Hub Server — DEPLOYED"
echo "═══════════════════════════════════════"
echo ""
echo "  Health: http://188.137.250.160/health"
echo "  Bob:    http://188.137.250.160/api/bob"
echo "  Token:  http://188.137.250.160/api/token"
echo "  Board:  http://188.137.250.160/api/leaderboard"
echo ""
echo "  Status: systemctl status opnet-hub"
echo "  Logs:   journalctl -u opnet-hub -f"
echo ""

# Quick health check
curl -s http://127.0.0.1:4000/health | head -c 200
echo ""
