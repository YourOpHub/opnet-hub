import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CJS modules imported from sibling files (not migrated)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TokenIndexer } = require("../token-indexer") as {
  TokenIndexer: new (db: Database.Database) => TokenIndexerInstance;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FractalSwapRelayer } = require("../fractalswap-relayer") as {
  FractalSwapRelayer: new () => FractalSwapRelayerInstance;
};

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

interface TokenIndexerInstance {
  init(): void;
  start(): void;
  getAllTokens(limit: number, offset: number): unknown[];
  getScanStatus(): Record<string, unknown>;
  addTokenByAddress(
    address: string
  ): Promise<{ ok: boolean; token?: unknown; existed?: boolean; error?: string }>;
  getHolderBalances(
    pubkey: string,
    tweaked: string
  ): Promise<unknown[]>;
  getMotoswapPools(): unknown[];
}

interface FractalSwapRelayerInstance {
  start(): Promise<void>;
}

interface PlayerRow {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  total_clicks: number;
  hash_rate: number;
  last_sync: string;
  created_at: string;
  updated_at: string;
}

interface ClaimCooldownRow {
  address: string;
  last_claim_at: number;
}

interface LeaderboardRow {
  address: string;
  mine_balance: number;
  total_sats_mined: number;
  hash_rate: number;
  rank: number;
}

interface CountRow {
  c: number;
}

interface TotalRow {
  total: number | null;
}

interface PoolSnapshotRow {
  id: number;
  pool_address: string;
  timestamp: number;
  reserve0: string;
  reserve1: string;
  price: number;
  tvl_sats: number;
}

interface SwapOperationRow {
  id: string;
  market: string;
  order_id: string;
  wallet: string;
  direction: string;
  role: string;
  step: string;
  status: string;
  amounts: string;
  tx_ids: string;
  error: string;
  created_at: string;
  updated_at: string;
}

interface SwapRateRow {
  order_id: string;
  send_sats: string;
  receive_sats: string;
  send_unit: string;
  receive_unit: string;
  rate: number;
  updated_at: string;
}

interface OrderLockRow {
  order_key: string;
  locked_by: string;
  locked_at: string;
  released: number;
}

interface ClaimRow {
  id: number;
  address: string;
  amount: number;
  tx_hash: string;
  status: string;
  created_at: string;
}

interface RpcResponse {
  jsonrpc: string;
  id: number;
  result?: string | { result: string };
  error?: { message: string; code: number };
}

interface SyncBody {
  address?: string;
  mine_balance?: number;
  total_sats_mined?: number;
  total_clicks?: number;
  hash_rate?: number;
}

interface ClaimBody {
  address?: string;
  amount?: number;
}

interface SwapUpdateBody {
  id?: string;
  market?: string;
  order_id?: string;
  wallet?: string;
  direction?: string;
  role?: string;
  step?: string;
  status?: string;
  amounts?: Record<string, unknown>;
  tx_ids?: Record<string, unknown>;
  error?: string;
}

interface LockBody {
  order_key?: string;
  wallet?: string;
}

interface RateBody {
  order_id?: string;
  send_sats?: string;
  receive_sats?: string;
  send_unit?: string;
  receive_unit?: string;
  rate?: number;
}

interface SnapshotBody {
  pool_address?: string;
  reserve0?: string | number;
  reserve1?: string | number;
  price?: number;
  tvl_sats?: number;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevelKey = keyof typeof LogLevel;

const currentLevel: number =
  LogLevel[(process.env.LOG_LEVEL?.toUpperCase() as LogLevelKey) ?? "INFO"] ??
  LogLevel.INFO;

const logger = {
  debug(tag: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG)
      process.stdout.write(`[DEBUG][${tag}] ${args.join(" ")}\n`);
  },
  info(tag: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO)
      process.stdout.write(`[INFO][${tag}] ${args.join(" ")}\n`);
  },
  warn(tag: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN)
      process.stderr.write(`[WARN][${tag}] ${args.join(" ")}\n`);
  },
  error(tag: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.ERROR)
      process.stderr.write(`[ERROR][${tag}] ${args.join(" ")}\n`);
  },
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);
const BOB_MCP_URL: string =
  process.env.BOB_MCP_URL ?? "https://ai.opnet.org/mcp";
const OPNET_RPC: string =
  process.env.OPNET_RPC_URL ?? "https://testnet.opnet.org/api/v1/json-rpc";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = new Database(path.join(__dirname, "..", "..", "data.db"));
db.pragma("journal_mode = WAL");

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

  CREATE TABLE IF NOT EXISTS claim_cooldowns (
    address TEXT PRIMARY KEY,
    last_claim_at INTEGER NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Token Indexer & FractalSwap Relayer
// ---------------------------------------------------------------------------

const indexer: TokenIndexerInstance = new TokenIndexer(db);
indexer.init();
indexer.start();

const relayer: FractalSwapRelayerInstance = new FractalSwapRelayer();
relayer
  .start()
  .catch((e: Error) => logger.error("Relayer", "Start failed:", e.message));

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const allowedOrigins: string[] = (
  process.env.CORS_ORIGINS ??
  "https://opnethub.xyz,https://yourophub.github.io,http://localhost:3000"
).split(",");

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// $MINE Token Constants
// ---------------------------------------------------------------------------

const MINE_TOTAL_SUPPLY = 21_000_000;
const MINE_GAME_POOL = 10_500_000;
const MINE_DAILY_BASE = 350_000;
const MINE_HALVING_DAYS = 7;
const MINE_PER_SAT = 0.001;
const LAUNCH_DATE = new Date("2026-02-26T00:00:00Z");

function getDailyEmission(): number {
  const days = Math.floor(
    (Date.now() - LAUNCH_DATE.getTime()) / 86_400_000
  );
  const halvings = Math.floor(days / MINE_HALVING_DAYS);
  return MINE_DAILY_BASE / Math.pow(2, halvings);
}

function getTotalDistributed(): number {
  const row = db
    .prepare("SELECT SUM(mine_balance) as total FROM players")
    .get() as TotalRow | undefined;
  return row?.total ?? 0;
}

// ---------------------------------------------------------------------------
// Routes: Health
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  const distributed = getTotalDistributed();
  res.json({
    status: "ok",
    version: "1.0.0",
    uptime: process.uptime(),
    mine: {
      totalSupply: MINE_TOTAL_SUPPLY,
      gamePool: MINE_GAME_POOL,
      dailyEmission: getDailyEmission(),
      totalDistributed: distributed,
      poolRemaining: MINE_GAME_POOL - distributed,
    },
  });
});

// ---------------------------------------------------------------------------
// Routes: Bob MCP Proxy (CORS bypass)
// ---------------------------------------------------------------------------

app.post("/api/bob", async (req: Request, res: Response) => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const clientSid = req.headers["mcp-session-id"];
    if (typeof clientSid === "string") headers["Mcp-Session-Id"] = clientSid;

    const upstream = await fetch(BOB_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body),
    });

    const sid = upstream.headers.get("mcp-session-id");
    if (sid) res.set("Mcp-Session-Id", sid);

    const text = await upstream.text();
    res.set("Content-Type", "text/plain");
    res.send(text);
  } catch (_e) {
    res.status(502).json({ error: "Bob MCP upstream error" });
  }
});

// ---------------------------------------------------------------------------
// Routes: OP_NET RPC Proxy
// ---------------------------------------------------------------------------

const RPC_ALLOWED_METHODS = new Set<string>([
  "btc_blockNumber",
  "btc_chainId",
  "btc_gas",
  "btc_getBlockByNumber",
  "btc_getBlockByHash",
  "btc_getBalance",
  "btc_getUTXOs",
  "btc_getCode",
  "btc_getStorageAt",
  "btc_call",
  "btc_getPublicKeyInfo",
  "btc_getTransactionByHash",
  "btc_getTransactionReceipt",
  "btc_getMempoolInfo",
  "btc_latestEpoch",
  "btc_getLatestPendingTransactions",
]);

app.post("/api/rpc", async (req: Request, res: Response) => {
  try {
    const body = req.body as { method?: string } | undefined;
    const method = body?.method;
    if (!method || !RPC_ALLOWED_METHODS.has(method)) {
      res.status(400).json({ error: "Method not allowed", method });
      return;
    }
    const upstream = await fetch(OPNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data: unknown = await upstream.json();
    res.json(data);
  } catch (_e) {
    res.status(502).json({ error: "RPC error" });
  }
});

// ---------------------------------------------------------------------------
// Routes: Player Sync
// ---------------------------------------------------------------------------

app.post("/api/player/sync", writeLimiter, (req: Request, res: Response) => {
  const {
    address,
    mine_balance,
    total_sats_mined,
    total_clicks,
    hash_rate,
  } = req.body as SyncBody;

  if (
    !address ||
    typeof address !== "string" ||
    !address.startsWith("opt1") ||
    address.length < 20
  ) {
    res
      .status(400)
      .json({ error: "Invalid address — must be opt1 format" });
    return;
  }

  const numBalance =
    typeof mine_balance === "number" && isFinite(mine_balance)
      ? Math.max(0, mine_balance)
      : 0;
  const numSats =
    typeof total_sats_mined === "number" && isFinite(total_sats_mined)
      ? Math.max(0, Math.floor(total_sats_mined))
      : 0;
  const numClicks =
    typeof total_clicks === "number" && isFinite(total_clicks)
      ? Math.max(0, Math.floor(total_clicks))
      : 0;
  const numHash =
    typeof hash_rate === "number" && isFinite(hash_rate)
      ? Math.max(0, hash_rate)
      : 0;

  const existing = db
    .prepare("SELECT mine_balance, last_sync FROM players WHERE address = ?")
    .get(address) as Pick<PlayerRow, "mine_balance" | "last_sync"> | undefined;

  const prevBalance = existing?.mine_balance ?? 0;
  const lastSync = existing?.last_sync
    ? new Date(existing.last_sync).getTime()
    : 0;
  const elapsed = lastSync ? Math.max(Date.now() - lastSync, 1000) : 60_000;
  const dailyRate = getDailyEmission();
  const maxIncrease = (dailyRate / 86_400_000) * elapsed * 2;
  const cappedIncrease = Math.min(numBalance - prevBalance, maxIncrease);
  const validatedBalance = prevBalance + Math.max(0, cappedIncrease);

  const poolRemaining = MINE_GAME_POOL - getTotalDistributed();
  const cappedBalance = Math.min(
    validatedBalance,
    poolRemaining > 0 ? validatedBalance : 0
  );

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

  stmt.run(
    address,
    cappedBalance,
    numSats,
    numClicks,
    numHash,
    cappedBalance,
    numSats,
    numClicks,
    numHash
  );

  res.json({
    ok: true,
    mine_balance: cappedBalance,
    pool_remaining: poolRemaining,
  });
});

// ---------------------------------------------------------------------------
// Routes: Get Player
// ---------------------------------------------------------------------------

app.get("/api/player/:address", (req: Request, res: Response) => {
  const row = db
    .prepare("SELECT * FROM players WHERE address = ?")
    .get(req.params.address) as PlayerRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(row);
});

// ---------------------------------------------------------------------------
// Routes: Claim $MINE
// ---------------------------------------------------------------------------

const CLAIM_COOLDOWN_MS = 5 * 60 * 1000;

app.post("/api/claim", writeLimiter, (req: Request, res: Response) => {
  const { address, amount } = req.body as ClaimBody;
  if (
    !address ||
    typeof amount !== "number" ||
    !isFinite(amount) ||
    amount <= 0
  ) {
    res
      .status(400)
      .json({ error: "Invalid claim — amount must be a positive number" });
    return;
  }

  const cooldownRow = db
    .prepare("SELECT last_claim_at FROM claim_cooldowns WHERE address = ?")
    .get(address) as ClaimCooldownRow | undefined;
  const lastClaim = cooldownRow?.last_claim_at ?? 0;
  if (lastClaim && Date.now() - lastClaim < CLAIM_COOLDOWN_MS) {
    const waitSec = Math.ceil(
      (CLAIM_COOLDOWN_MS - (Date.now() - lastClaim)) / 1000
    );
    res.status(429).json({ error: `Claim cooldown: wait ${waitSec}s` });
    return;
  }

  const player = db
    .prepare("SELECT * FROM players WHERE address = ?")
    .get(address) as PlayerRow | undefined;
  if (!player) {
    res.status(404).json({ error: "Player not found. Sync first." });
    return;
  }
  if (player.mine_balance < amount) {
    res.status(400).json({
      error: "Insufficient MINE balance",
      available: player.mine_balance,
    });
    return;
  }

  const claim = db
    .prepare(
      "INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)"
    )
    .run(address, amount, "pending");

  db.prepare(
    "UPDATE players SET mine_balance = mine_balance - ? WHERE address = ?"
  ).run(amount, address);

  db.prepare(
    "INSERT INTO claim_cooldowns (address, last_claim_at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET last_claim_at = ?"
  ).run(address, Date.now(), Date.now());

  res.json({
    ok: true,
    claim_id: claim.lastInsertRowid,
    amount,
    status: "pending",
    message:
      "Claim created. Token transfer will be processed on-chain via OP_NET.",
  });
});

// ---------------------------------------------------------------------------
// Routes: Leaderboard
// ---------------------------------------------------------------------------

app.get("/api/leaderboard", (req: Request, res: Response) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit as string) || 50, 1),
    100
  );
  const rows = db
    .prepare(
      `
    SELECT address, mine_balance, total_sats_mined, hash_rate,
           ROW_NUMBER() OVER (ORDER BY mine_balance DESC) as rank
    FROM players
    ORDER BY mine_balance DESC
    LIMIT ?
  `
    )
    .all(limit) as LeaderboardRow[];

  const countRow = db
    .prepare("SELECT COUNT(*) as c FROM players")
    .get() as CountRow | undefined;

  res.json({
    leaderboard: rows,
    stats: {
      total_players: countRow?.c ?? 0,
      total_distributed: getTotalDistributed(),
      pool_remaining: MINE_GAME_POOL - getTotalDistributed(),
      daily_emission: getDailyEmission(),
    },
  });
});

// ---------------------------------------------------------------------------
// Routes: Token Info
// ---------------------------------------------------------------------------

app.get("/api/token", (_req: Request, res: Response) => {
  const distributed = getTotalDistributed();
  res.json({
    name: "Mine Token",
    symbol: "MINE",
    decimals: 8,
    totalSupply: MINE_TOTAL_SUPPLY,
    gamePool: MINE_GAME_POOL,
    distributed,
    poolRemaining: MINE_GAME_POOL - distributed,
    dailyEmission: getDailyEmission(),
    halvingInterval: `${MINE_HALVING_DAYS} days`,
    launchDate: LAUNCH_DATE.toISOString(),
    conversionRate: `${MINE_PER_SAT} MINE per sat`,
    contract: process.env.MINE_CONTRACT_ADDRESS ?? "pending deployment",
  });
});

// ---------------------------------------------------------------------------
// Routes: Pending Claims (admin)
// ---------------------------------------------------------------------------

app.get("/api/claims/pending", (req: Request, res: Response) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(503).json({ error: "Admin endpoint not configured" });
    return;
  }
  const key = req.headers["x-admin-key"];
  if (!key || key !== adminKey) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = db
    .prepare(
      "SELECT * FROM claims WHERE status = ? ORDER BY created_at ASC"
    )
    .all("pending") as ClaimRow[];
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Routes: Token Indexer API
// ---------------------------------------------------------------------------

app.get("/api/tokens", (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string) || 500, 1),
      2000
    );
    const offset = Math.max(
      parseInt(req.query.offset as string) || 0,
      0
    );
    const tokens = indexer.getAllTokens(limit, offset);
    res.json(tokens);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch tokens" });
  }
});

app.get("/api/tokens/status", (_req: Request, res: Response) => {
  try {
    res.json(indexer.getScanStatus());
  } catch (_e) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.post("/api/tokens/add", async (req: Request, res: Response) => {
  try {
    const { address } = req.body as { address?: string };
    if (
      !address ||
      typeof address !== "string" ||
      (!address.startsWith("opt1") && !address.startsWith("0x"))
    ) {
      res
        .status(400)
        .json({ error: "Invalid address — must be opt1 or 0x format" });
      return;
    }
    const result = await indexer.addTokenByAddress(address);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (_e) {
    res.status(500).json({ error: "Failed to add token" });
  }
});

app.get(
  "/api/holder/:pubkey/tokens",
  async (req: Request, res: Response) => {
    try {
      const { pubkey } = req.params;
      const tweaked = (req.query.tweaked as string) ?? "";
      if (!pubkey || pubkey.length < 10) {
        res.status(400).json({ error: "Invalid pubkey" });
        return;
      }
      const balances = await indexer.getHolderBalances(pubkey, tweaked);
      res.json(balances);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch balances" });
    }
  }
);

// ---------------------------------------------------------------------------
// Routes: Motoswap Pools
// ---------------------------------------------------------------------------

app.get("/api/pools", (_req: Request, res: Response) => {
  try {
    const pools = indexer.getMotoswapPools();
    res.json(pools);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch pools" });
  }
});

// ---------------------------------------------------------------------------
// Routes: Swap Persistence
// ---------------------------------------------------------------------------

app.post("/api/swap/update", (req: Request, res: Response) => {
  const {
    id,
    market,
    order_id,
    wallet,
    direction,
    role,
    step,
    status,
    amounts,
    tx_ids,
    error: swapError,
  } = req.body as SwapUpdateBody;

  if (!id || !market || !wallet) {
    res.status(400).json({ error: "id, market, wallet required" });
    return;
  }

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
    id,
    market,
    order_id ?? "",
    wallet,
    direction ?? "",
    role ?? "",
    step ?? "",
    status ?? "active",
    JSON.stringify(amounts ?? {}),
    JSON.stringify(tx_ids ?? {}),
    swapError ?? "",
    step ?? null,
    status ?? null,
    amounts ? JSON.stringify(amounts) : null,
    tx_ids ? JSON.stringify(tx_ids) : null,
    swapError ?? null
  );

  res.json({ ok: true });
});

app.get("/api/swap/active/:wallet", (req: Request, res: Response) => {
  const { wallet } = req.params;
  const market = (req.query.market as string) ?? null;
  let rows: SwapOperationRow[];

  if (market) {
    rows = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status = ? AND market = ? ORDER BY updated_at DESC"
      )
      .all(wallet, "active", market) as SwapOperationRow[];
  } else {
    rows = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status = ? ORDER BY updated_at DESC"
      )
      .all(wallet, "active") as SwapOperationRow[];
  }

  res.json(rows);
});

app.get("/api/swap/history/:wallet", (req: Request, res: Response) => {
  const { wallet } = req.params;
  const market = (req.query.market as string) ?? null;
  const limit = Math.min(
    Math.max(parseInt(req.query.limit as string) || 50, 1),
    200
  );
  let rows: SwapOperationRow[];

  if (market) {
    rows = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status != ? AND market = ? ORDER BY updated_at DESC LIMIT ?"
      )
      .all(wallet, "active", market, limit) as SwapOperationRow[];
  } else {
    rows = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status != ? ORDER BY updated_at DESC LIMIT ?"
      )
      .all(wallet, "active", limit) as SwapOperationRow[];
  }

  res.json(rows);
});

app.post("/api/orders/rate", (req: Request, res: Response) => {
  const {
    order_id,
    send_sats,
    receive_sats,
    send_unit,
    receive_unit,
    rate,
  } = req.body as RateBody;

  if (!order_id) {
    res.status(400).json({ error: "order_id required" });
    return;
  }

  db.prepare(
    `
    INSERT INTO swap_rates (order_id, send_sats, receive_sats, send_unit, receive_unit, rate, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET
      send_sats = ?, receive_sats = ?, send_unit = ?, receive_unit = ?, rate = ?, updated_at = datetime('now')
  `
  ).run(
    order_id,
    send_sats ?? "",
    receive_sats ?? "",
    send_unit ?? "",
    receive_unit ?? "",
    rate ?? 0,
    send_sats ?? "",
    receive_sats ?? "",
    send_unit ?? "",
    receive_unit ?? "",
    rate ?? 0
  );

  res.json({ ok: true });
});

app.get("/api/orders/rates", (_req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM swap_rates ORDER BY updated_at DESC")
    .all() as SwapRateRow[];
  const map: Record<string, SwapRateRow> = {};
  for (const r of rows) map[r.order_id] = r;
  res.json(map);
});

// ---------------------------------------------------------------------------
// Routes: Order Locks
// ---------------------------------------------------------------------------

app.post("/api/swap/lock", writeLimiter, (req: Request, res: Response) => {
  const { order_key, wallet } = req.body as LockBody;
  if (!order_key || !wallet) {
    res.status(400).json({ error: "order_key, wallet required" });
    return;
  }

  db.prepare(
    "DELETE FROM order_locks WHERE released = 0 AND datetime(locked_at, '+10 minutes') < datetime('now')"
  ).run();

  const existing = db
    .prepare(
      "SELECT * FROM order_locks WHERE order_key = ? AND released = 0"
    )
    .get(order_key) as OrderLockRow | undefined;

  if (existing && existing.locked_by !== wallet) {
    res.status(409).json({
      error: "Order locked by another user",
      locked_by: existing.locked_by.slice(0, 10) + "...",
    });
    return;
  }

  db.prepare(
    `INSERT INTO order_locks (order_key, locked_by, locked_at, released) VALUES (?, ?, datetime('now'), 0)
    ON CONFLICT(order_key) DO UPDATE SET locked_by = ?, locked_at = datetime('now'), released = 0`
  ).run(order_key, wallet, wallet);

  res.json({ ok: true, order_key });
});

app.post("/api/swap/unlock", (req: Request, res: Response) => {
  const { order_key, wallet } = req.body as LockBody;
  if (!order_key || !wallet) {
    res.status(400).json({ error: "order_key and wallet required" });
    return;
  }

  const lock = db
    .prepare(
      "SELECT locked_by FROM order_locks WHERE order_key = ? AND released = 0"
    )
    .get(order_key) as Pick<OrderLockRow, "locked_by"> | undefined;

  if (lock && lock.locked_by !== wallet) {
    res.status(403).json({ error: "Only lock owner can unlock" });
    return;
  }

  db.prepare(
    "UPDATE order_locks SET released = 1 WHERE order_key = ? AND locked_by = ?"
  ).run(order_key, wallet);

  res.json({ ok: true });
});

app.get("/api/swap/locks", (_req: Request, res: Response) => {
  db.prepare(
    "DELETE FROM order_locks WHERE released = 0 AND datetime(locked_at, '+10 minutes') < datetime('now')"
  ).run();

  const rows = db
    .prepare(
      "SELECT order_key, locked_by, locked_at FROM order_locks WHERE released = 0"
    )
    .all() as Pick<OrderLockRow, "order_key" | "locked_by" | "locked_at">[];

  const map: Record<
    string,
    Pick<OrderLockRow, "order_key" | "locked_by" | "locked_at">
  > = {};
  for (const r of rows) map[r.order_key] = r;
  res.json(map);
});

// ---------------------------------------------------------------------------
// Routes: Faucet Proxy
// ---------------------------------------------------------------------------

const FAUCET_UPSTREAM: string =
  process.env.FAUCET_URL ?? "https://faucet.opnet.org";

const faucetLimiter = rateLimit({
  windowMs: 300_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post(
  "/api/faucet/claim",
  faucetLimiter,
  async (req: Request, res: Response) => {
    if ((process.env.OPNET_NETWORK ?? "testnet") === "mainnet") {
      res
        .status(403)
        .json({ error: "Faucet not available on mainnet" });
      return;
    }
    try {
      const upstream = await fetch(`${FAUCET_UPSTREAM}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data: unknown = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (_e) {
      res.status(502).json({ error: "Faucet upstream error" });
    }
  }
);

// ---------------------------------------------------------------------------
// Pool Snapshots
// ---------------------------------------------------------------------------

const POOL_SNAPSHOT_ADDRESS: string =
  process.env.POOL_ADDRESS ?? "opt1sqplvfq5ytgtwzes6tc4ys77f90279rsz8q4dg7ex";
const POOL_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const GET_RESERVES_SELECTOR = "06374bfc";

async function collectPoolSnapshot(): Promise<void> {
  try {
    const rpcBody = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "btc_call",
      params: [POOL_SNAPSHOT_ADDRESS, GET_RESERVES_SELECTOR],
    };

    const resp = await fetch(OPNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    });

    const json = (await resp.json()) as RpcResponse;
    if (json.error) {
      logger.error("PoolSnapshot", "RPC error:", JSON.stringify(json.error));
      return;
    }

    let hex: string | undefined;
    if (json.result && typeof json.result === "string") {
      try {
        hex = Buffer.from(json.result, "base64").toString("hex");
      } catch {
        hex = json.result.replace(/^0x/, "");
      }
    } else if (
      json.result &&
      typeof json.result === "object" &&
      "result" in json.result
    ) {
      const inner = json.result.result;
      try {
        hex = Buffer.from(inner, "base64").toString("hex");
      } catch {
        hex = String(inner).replace(/^0x/, "");
      }
    }

    if (!hex || hex.length < 128) {
      logger.error(
        "PoolSnapshot",
        "Invalid reserves hex, length:",
        String(hex?.length)
      );
      return;
    }

    const reserve0Raw = BigInt("0x" + hex.slice(0, 64));
    const reserve1Raw = BigInt("0x" + hex.slice(64, 128));
    const reserve0 = Number(reserve0Raw) / 1e8;
    const reserve1 = Number(reserve1Raw) / 1e8;

    if (reserve0 <= 0 || reserve1 <= 0) {
      logger.info("PoolSnapshot", "Reserves are zero, skipping");
      return;
    }

    const price = reserve1 / reserve0;
    const tvlSats = reserve0 + reserve1;
    const now = Date.now();

    const lastSnap = db
      .prepare(
        "SELECT timestamp FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get(POOL_SNAPSHOT_ADDRESS) as
      | Pick<PoolSnapshotRow, "timestamp">
      | undefined;

    if (lastSnap && now - lastSnap.timestamp < 5 * 60 * 1000) {
      return;
    }

    db.prepare(
      "INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      POOL_SNAPSHOT_ADDRESS,
      now,
      reserve0Raw.toString(),
      reserve1Raw.toString(),
      price,
      tvlSats
    );

    logger.info(
      "PoolSnapshot",
      `Saved: MINE=${reserve0.toFixed(0)} VIBE=${reserve1.toFixed(0)} price=${price.toFixed(4)}`
    );

    const count = db
      .prepare(
        "SELECT COUNT(*) as c FROM pool_snapshots WHERE pool_address = ?"
      )
      .get(POOL_SNAPSHOT_ADDRESS) as CountRow | undefined;

    if (count && count.c > 2000) {
      db.prepare(
        "DELETE FROM pool_snapshots WHERE pool_address = ? AND id NOT IN (SELECT id FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 2000)"
      ).run(POOL_SNAPSHOT_ADDRESS, POOL_SNAPSHOT_ADDRESS);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("PoolSnapshot", "Error:", msg);
  }
}

collectPoolSnapshot();
setInterval(collectPoolSnapshot, POOL_SNAPSHOT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Routes: Pool History
// ---------------------------------------------------------------------------

app.get("/api/pool/history", (req: Request, res: Response) => {
  try {
    const pool =
      (req.query.pool as string) ?? POOL_SNAPSHOT_ADDRESS;
    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string) || 100, 1),
      2000
    );

    const rows = db
      .prepare(
        "SELECT timestamp, reserve0, reserve1, price, tvl_sats FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp ASC LIMIT ?"
      )
      .all(pool, limit) as Pick<
      PoolSnapshotRow,
      "timestamp" | "reserve0" | "reserve1" | "price" | "tvl_sats"
    >[];

    const snapshots = rows.map((r) => ({
      ts: r.timestamp,
      reserveMINE: Number(BigInt(r.reserve0)) / 1e8,
      reserveVIBE: Number(BigInt(r.reserve1)) / 1e8,
      rate: r.price,
    }));

    res.json({ pool, count: snapshots.length, snapshots });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("PoolHistory", "Error:", msg);
    res.status(500).json({ error: "Failed to fetch pool history" });
  }
});

// ---------------------------------------------------------------------------
// Routes: Pool Snapshot (admin, manual)
// ---------------------------------------------------------------------------

app.post(
  "/api/pool/snapshot",
  writeLimiter,
  (req: Request, res: Response) => {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      res
        .status(503)
        .json({ error: "Admin endpoint not configured" });
      return;
    }
    const key = req.headers["x-admin-key"];
    if (!key || key !== adminKey) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { pool_address, reserve0, reserve1, price, tvl_sats } =
      req.body as SnapshotBody;

    if (pool_address == null || reserve0 == null || reserve1 == null) {
      res
        .status(400)
        .json({ error: "pool_address, reserve0, reserve1 required" });
      return;
    }

    const now = Date.now();
    db.prepare(
      "INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      pool_address,
      now,
      String(reserve0),
      String(reserve1),
      price ?? 0,
      tvl_sats ?? 0
    );

    res.json({ ok: true, timestamp: now });
  }
);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  logger.info("Server", `Running on port ${PORT}`);
  logger.info("Bob MCP Proxy", `-> ${BOB_MCP_URL}`);
  logger.info("OP_NET RPC Proxy", `-> ${OPNET_RPC}`);
  logger.info(
    "Pool Snapshots",
    `Collecting every ${POOL_SNAPSHOT_INTERVAL_MS / 60000}min for ${POOL_SNAPSHOT_ADDRESS}`
  );
  logger.info(
    "$MINE",
    `Pool: ${MINE_GAME_POOL.toLocaleString()} | Daily: ${getDailyEmission().toLocaleString()}`
  );
});
