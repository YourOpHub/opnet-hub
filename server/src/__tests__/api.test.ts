import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";

// ---------------------------------------------------------------------------
// sql.js thin wrapper — mimics the better-sqlite3 API used by the server
// ---------------------------------------------------------------------------

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

/** Wraps sql.js to provide a prepare/get/all/run interface similar to better-sqlite3 */
function wrapDb(raw: SqlJsDatabase) {
  return {
    raw,
    exec(sql: string) {
      raw.run(sql);
    },
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          const stmt = raw.prepare(sql);
          stmt.bind(params as (string | number | null | Uint8Array)[]);
          stmt.step();
          stmt.free();
          // Emulate better-sqlite3 RunResult
          const changesResult = raw.exec("SELECT changes() as changes, last_insert_rowid() as rid");
          const changes = changesResult.length > 0 ? (changesResult[0]!.values[0]![0] as number) : 0;
          const lastInsertRowid = changesResult.length > 0 ? (changesResult[0]!.values[0]![1] as number) : 0;
          return { changes, lastInsertRowid };
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const stmt = raw.prepare(sql);
          stmt.bind(params as (string | number | null | Uint8Array)[]);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row: Record<string, unknown> = {};
            for (let i = 0; i < cols.length; i++) {
              row[cols[i]!] = vals[i];
            }
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          const stmt = raw.prepare(sql);
          stmt.bind(params as (string | number | null | Uint8Array)[]);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row: Record<string, unknown> = {};
            for (let i = 0; i < cols.length; i++) {
              row[cols[i]!] = vals[i];
            }
            rows.push(row);
          }
          stmt.free();
          return rows;
        },
      };
    },
    close() {
      raw.close();
    },
  };
}

type WrappedDb = ReturnType<typeof wrapDb>;

// ---------------------------------------------------------------------------
// Helper: create a fresh in-memory database with the same schema as the server
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
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
`;

function createTestDb(): WrappedDb {
  const raw = new SQL.Database();
  const db = wrapDb(raw);
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Constants mirrored from server
// ---------------------------------------------------------------------------

const MINE_TOTAL_SUPPLY = 21_000_000;
const MINE_GAME_POOL = 10_500_000;
const MINE_DAILY_BASE = 350_000;
const MINE_HALVING_DAYS = 7;
const MINE_PER_SAT = 0.001;
const LAUNCH_DATE = new Date("2026-02-26T00:00:00Z");
const CLAIM_COOLDOWN_MS = 5 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Pure logic functions extracted from server for testing
// ---------------------------------------------------------------------------

function getDailyEmission(now: number = Date.now()): number {
  const days = Math.floor((now - LAUNCH_DATE.getTime()) / 86_400_000);
  const halvings = Math.floor(days / MINE_HALVING_DAYS);
  return MINE_DAILY_BASE / Math.pow(2, halvings);
}

function getTotalDistributed(db: WrappedDb): number {
  const row = db
    .prepare("SELECT SUM(mine_balance) as total FROM players")
    .get();
  return (row?.total as number) ?? 0;
}

function validateAddress(address: unknown): boolean {
  return (
    typeof address === "string" &&
    address.startsWith("opt1") &&
    address.length >= 20
  );
}

function validateClaimAmount(amount: unknown): boolean {
  return typeof amount === "number" && isFinite(amount) && amount > 0;
}

function sanitizeNumeric(
  value: unknown,
  allowFloat: boolean = false
): number {
  if (typeof value !== "number" || !isFinite(value)) return 0;
  const clamped = Math.max(0, value);
  return allowFloat ? clamped : Math.floor(clamped);
}

function clampLimit(
  raw: string | undefined,
  defaultVal: number,
  min: number,
  max: number
): number {
  return Math.min(Math.max(parseInt(raw ?? "") || defaultVal, min), max);
}

function isRpcMethodAllowed(method: string): boolean {
  return RPC_ALLOWED_METHODS.has(method);
}

function validateTokenAddress(address: unknown): boolean {
  return (
    typeof address === "string" &&
    (address.startsWith("opt1") || address.startsWith("0x"))
  );
}

// ============================================================================
// TESTS
// ============================================================================

describe("Database Schema", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create all expected tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all();
    const names = tables.map((t) => t.name);

    expect(names).toContain("players");
    expect(names).toContain("claims");
    expect(names).toContain("leaderboard_cache");
    expect(names).toContain("swap_operations");
    expect(names).toContain("swap_rates");
    expect(names).toContain("order_locks");
    expect(names).toContain("pool_snapshots");
    expect(names).toContain("claim_cooldowns");
  });

  it("should create pool_snapshots index", () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pool_snapshots'"
      )
      .all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_pool_snapshots_pool_ts");
  });

  it("should enforce players address as primary key", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1abc_long_enough_address", 100);

    expect(() => {
      db.prepare(
        "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
      ).run("opt1abc_long_enough_address", 200);
    }).toThrow();
  });

  it("should auto-increment claims id", () => {
    const r1 = db
      .prepare(
        "INSERT INTO claims (address, amount) VALUES (?, ?)"
      )
      .run("opt1abc_long_enough_claim", 100);
    const r2 = db
      .prepare(
        "INSERT INTO claims (address, amount) VALUES (?, ?)"
      )
      .run("opt1abc_long_enough_claim", 200);

    expect(r2.lastInsertRowid).toBeGreaterThan(r1.lastInsertRowid);
  });

  it("should set default values for players", () => {
    db.prepare("INSERT INTO players (address) VALUES (?)").run("opt1test_default_vals");
    const row = db
      .prepare("SELECT * FROM players WHERE address = ?")
      .get("opt1test_default_vals");

    expect(row).toBeDefined();
    expect(row!.mine_balance).toBe(0);
    expect(row!.total_sats_mined).toBe(0);
    expect(row!.total_clicks).toBe(0);
    expect(row!.hash_rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Player Data Operations
// ---------------------------------------------------------------------------

describe("Player Data Operations", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should insert a new player via upsert", () => {
    db.prepare(`
      INSERT INTO players (address, mine_balance, total_sats_mined, total_clicks, hash_rate, last_sync, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(address) DO UPDATE SET
        mine_balance = ?,
        total_sats_mined = ?,
        total_clicks = ?,
        hash_rate = ?,
        last_sync = datetime('now'),
        updated_at = datetime('now')
    `).run("opt1player1_address_long", 50, 1000, 200, 5.5, 50, 1000, 200, 5.5);

    const row = db
      .prepare("SELECT * FROM players WHERE address = ?")
      .get("opt1player1_address_long");

    expect(row).toBeDefined();
    expect(row!.mine_balance).toBe(50);
    expect(row!.total_sats_mined).toBe(1000);
    expect(row!.total_clicks).toBe(200);
    expect(row!.hash_rate).toBe(5.5);
  });

  it("should update existing player via upsert", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1player1_address_long", 50);

    db.prepare(`
      INSERT INTO players (address, mine_balance, total_sats_mined, total_clicks, hash_rate, last_sync, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(address) DO UPDATE SET
        mine_balance = ?,
        total_sats_mined = ?,
        total_clicks = ?,
        hash_rate = ?,
        last_sync = datetime('now'),
        updated_at = datetime('now')
    `).run("opt1player1_address_long", 100, 2000, 400, 10, 100, 2000, 400, 10);

    const row = db
      .prepare("SELECT * FROM players WHERE address = ?")
      .get("opt1player1_address_long");

    expect(row).toBeDefined();
    expect(row!.mine_balance).toBe(100);
    expect(row!.total_sats_mined).toBe(2000);
  });

  it("should return undefined for non-existent player", () => {
    const row = db
      .prepare("SELECT * FROM players WHERE address = ?")
      .get("opt1nonexistent_player_addr");
    expect(row).toBeUndefined();
  });

  it("should calculate total distributed correctly", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1aaaaaaaaaaaaaaaaaaaaa", 100);
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1bbbbbbbbbbbbbbbbbbbbb", 250);
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1ccccccccccccccccccccc", 50);

    expect(getTotalDistributed(db)).toBe(400);
  });

  it("should return 0 for total distributed when no players", () => {
    expect(getTotalDistributed(db)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Claims Operations
// ---------------------------------------------------------------------------

describe("Claims Operations", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should insert a pending claim", () => {
    const result = db
      .prepare(
        "INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)"
      )
      .run("opt1claimer_address_long", 500, "pending");

    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const claim = db
      .prepare("SELECT * FROM claims WHERE id = ?")
      .get(result.lastInsertRowid);
    expect(claim).toBeDefined();
    expect(claim!.address).toBe("opt1claimer_address_long");
    expect(claim!.amount).toBe(500);
    expect(claim!.status).toBe("pending");
  });

  it("should deduct balance after claim", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1claimer_address_long", 1000);

    db.prepare(
      "UPDATE players SET mine_balance = mine_balance - ? WHERE address = ?"
    ).run(250, "opt1claimer_address_long");

    const row = db
      .prepare("SELECT mine_balance FROM players WHERE address = ?")
      .get("opt1claimer_address_long");
    expect(row).toBeDefined();
    expect(row!.mine_balance).toBe(750);
  });

  it("should track claim cooldown", () => {
    const now = Date.now();
    db.prepare(
      "INSERT INTO claim_cooldowns (address, last_claim_at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET last_claim_at = ?"
    ).run("opt1claimer_address_long", now, now);

    const row = db
      .prepare(
        "SELECT last_claim_at FROM claim_cooldowns WHERE address = ?"
      )
      .get("opt1claimer_address_long");
    expect(row).toBeDefined();
    expect(row!.last_claim_at).toBe(now);
  });

  it("should filter pending claims", () => {
    db.prepare(
      "INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)"
    ).run("opt1aaaaaaaaaaaaaaaaaaaaa", 100, "pending");
    db.prepare(
      "INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)"
    ).run("opt1bbbbbbbbbbbbbbbbbbbbb", 200, "completed");
    db.prepare(
      "INSERT INTO claims (address, amount, status) VALUES (?, ?, ?)"
    ).run("opt1ccccccccccccccccccccc", 300, "pending");

    const pending = db
      .prepare("SELECT * FROM claims WHERE status = ? ORDER BY created_at ASC")
      .all("pending");
    expect(pending).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Swap Operations
// ---------------------------------------------------------------------------

describe("Swap Operations", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should insert a new swap operation with JSON amounts", () => {
    const amounts = { btc: "0.001", mine: "1000" };
    const txIds = { take: "tx123" };

    db.prepare(`
      INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status, amounts, tx_ids, error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        step = COALESCE(?, step),
        status = COALESCE(?, status),
        amounts = COALESCE(?, amounts),
        tx_ids = COALESCE(?, tx_ids),
        error = COALESCE(?, error),
        updated_at = datetime('now')
    `).run(
      "swap-1",
      "NativeSwap",
      "order-42",
      "opt1wallet1_address_long",
      "BTC_TO_TOKEN",
      "taker",
      "take",
      "active",
      JSON.stringify(amounts),
      JSON.stringify(txIds),
      "",
      "take",
      "active",
      JSON.stringify(amounts),
      JSON.stringify(txIds),
      null
    );

    const row = db
      .prepare("SELECT * FROM swap_operations WHERE id = ?")
      .get("swap-1");

    expect(row).toBeDefined();
    expect(row!.market).toBe("NativeSwap");
    expect(row!.wallet).toBe("opt1wallet1_address_long");
    expect(JSON.parse(row!.amounts as string)).toEqual(amounts);
    expect(JSON.parse(row!.tx_ids as string)).toEqual(txIds);
  });

  it("should update an existing swap operation via upsert", () => {
    db.prepare(
      "INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("swap-1", "NativeSwap", "order-42", "opt1wallet1_address_long", "BTC_TO_TOKEN", "taker", "take", "active");

    db.prepare(`
      INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status, amounts, tx_ids, error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        step = COALESCE(?, step),
        status = COALESCE(?, status),
        amounts = COALESCE(?, amounts),
        tx_ids = COALESCE(?, tx_ids),
        error = COALESCE(?, error),
        updated_at = datetime('now')
    `).run(
      "swap-1", "NativeSwap", "order-42", "opt1wallet1_address_long",
      "BTC_TO_TOKEN", "taker", "complete", "completed", "{}", "{}", "",
      "complete", "completed", null, null, null
    );

    const row = db
      .prepare("SELECT * FROM swap_operations WHERE id = ?")
      .get("swap-1");

    expect(row).toBeDefined();
    expect(row!.step).toBe("complete");
    expect(row!.status).toBe("completed");
  });

  it("should filter active swap operations by wallet", () => {
    const ins = db.prepare(
      "INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    ins.run("s1", "NativeSwap", "o1", "opt1w1_long_address_str", "BTC_TO_TOKEN", "taker", "take", "active");
    ins.run("s2", "NativeSwap", "o2", "opt1w1_long_address_str", "TOKEN_TO_BTC", "maker", "create", "completed");
    ins.run("s3", "FractalSwap", "o3", "opt1w1_long_address_str", "BTC_TO_FB", "taker", "take", "active");
    ins.run("s4", "NativeSwap", "o4", "opt1w2_long_address_str", "BTC_TO_TOKEN", "taker", "take", "active");

    const allActive = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status = ? ORDER BY updated_at DESC"
      )
      .all("opt1w1_long_address_str", "active");
    expect(allActive).toHaveLength(2);

    const nativeOnly = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status = ? AND market = ? ORDER BY updated_at DESC"
      )
      .all("opt1w1_long_address_str", "active", "NativeSwap");
    expect(nativeOnly).toHaveLength(1);
    expect(nativeOnly[0]!.id).toBe("s1");
  });

  it("should filter swap history (non-active) with limit", () => {
    const ins = db.prepare(
      "INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (let i = 0; i < 10; i++) {
      ins.run(`h${i}`, "NativeSwap", `o${i}`, "opt1w1_long_address_str", "BTC_TO_TOKEN", "taker", "complete", "completed");
    }

    const history = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status != ? ORDER BY updated_at DESC LIMIT ?"
      )
      .all("opt1w1_long_address_str", "active", 5);
    expect(history).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Swap Rates
// ---------------------------------------------------------------------------

describe("Swap Rates", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should insert a swap rate", () => {
    db.prepare(`
      INSERT INTO swap_rates (order_id, send_sats, receive_sats, send_unit, receive_unit, rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(order_id) DO UPDATE SET
        send_sats = ?, receive_sats = ?, send_unit = ?, receive_unit = ?, rate = ?, updated_at = datetime('now')
    `).run(
      "order-1", "50000", "1000000", "BTC", "MINE", 20,
      "50000", "1000000", "BTC", "MINE", 20
    );

    const row = db
      .prepare("SELECT * FROM swap_rates WHERE order_id = ?")
      .get("order-1");
    expect(row).toBeDefined();
    expect(row!.send_sats).toBe("50000");
    expect(row!.rate).toBe(20);
  });

  it("should update an existing swap rate", () => {
    db.prepare(
      "INSERT INTO swap_rates (order_id, rate) VALUES (?, ?)"
    ).run("order-1", 20);

    db.prepare(`
      INSERT INTO swap_rates (order_id, send_sats, receive_sats, send_unit, receive_unit, rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(order_id) DO UPDATE SET
        send_sats = ?, receive_sats = ?, send_unit = ?, receive_unit = ?, rate = ?, updated_at = datetime('now')
    `).run(
      "order-1", "60000", "1500000", "BTC", "MINE", 25,
      "60000", "1500000", "BTC", "MINE", 25
    );

    const row = db
      .prepare("SELECT * FROM swap_rates WHERE order_id = ?")
      .get("order-1");
    expect(row).toBeDefined();
    expect(row!.rate).toBe(25);
    expect(row!.send_sats).toBe("60000");
  });

  it("should build rates map from all rows", () => {
    db.prepare("INSERT INTO swap_rates (order_id, rate) VALUES (?, ?)").run("o1", 10);
    db.prepare("INSERT INTO swap_rates (order_id, rate) VALUES (?, ?)").run("o2", 20);
    db.prepare("INSERT INTO swap_rates (order_id, rate) VALUES (?, ?)").run("o3", 30);

    const rows = db
      .prepare("SELECT * FROM swap_rates ORDER BY updated_at DESC")
      .all();

    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.order_id as string] = r;

    expect(Object.keys(map)).toHaveLength(3);
    expect(map).toHaveProperty("o1");
    expect(map).toHaveProperty("o2");
    expect(map).toHaveProperty("o3");
  });
});

// ---------------------------------------------------------------------------
// Order Locks
// ---------------------------------------------------------------------------

describe("Order Locks", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a lock for an order", () => {
    db.prepare(
      `INSERT INTO order_locks (order_key, locked_by, locked_at, released) VALUES (?, ?, datetime('now'), 0)
       ON CONFLICT(order_key) DO UPDATE SET locked_by = ?, locked_at = datetime('now'), released = 0`
    ).run("order-1", "opt1wallet1_long_addr", "opt1wallet1_long_addr");

    const lock = db
      .prepare(
        "SELECT * FROM order_locks WHERE order_key = ? AND released = 0"
      )
      .get("order-1");
    expect(lock).toBeDefined();
    expect(lock!.locked_by).toBe("opt1wallet1_long_addr");
  });

  it("should detect conflict when different wallet tries to lock", () => {
    db.prepare(
      "INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, 0)"
    ).run("order-1", "opt1wallet1_long_addr");

    const existing = db
      .prepare(
        "SELECT * FROM order_locks WHERE order_key = ? AND released = 0"
      )
      .get("order-1");

    const newWallet = "opt1wallet2_long_addr";
    const isConflict = existing != null && existing.locked_by !== newWallet;
    expect(isConflict).toBe(true);
  });

  it("should allow same wallet to re-lock", () => {
    db.prepare(
      "INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, 0)"
    ).run("order-1", "opt1wallet1_long_addr");

    const existing = db
      .prepare(
        "SELECT * FROM order_locks WHERE order_key = ? AND released = 0"
      )
      .get("order-1");

    const sameWallet = "opt1wallet1_long_addr";
    const isConflict = existing != null && existing.locked_by !== sameWallet;
    expect(isConflict).toBe(false);
  });

  it("should release a lock", () => {
    db.prepare(
      "INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, 0)"
    ).run("order-1", "opt1wallet1_long_addr");

    db.prepare(
      "UPDATE order_locks SET released = 1 WHERE order_key = ? AND locked_by = ?"
    ).run("order-1", "opt1wallet1_long_addr");

    const lock = db
      .prepare(
        "SELECT * FROM order_locks WHERE order_key = ? AND released = 0"
      )
      .get("order-1");
    expect(lock).toBeUndefined();
  });

  it("should prevent non-owner from unlocking", () => {
    db.prepare(
      "INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, 0)"
    ).run("order-1", "opt1wallet1_long_addr");

    const lock = db
      .prepare(
        "SELECT locked_by FROM order_locks WHERE order_key = ? AND released = 0"
      )
      .get("order-1");

    const isOwner = lock != null && lock.locked_by === "opt1wallet2_long_addr";
    expect(isOwner).toBe(false);
  });

  it("should list only active (non-released) locks", () => {
    db.prepare("INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, ?)").run("o1", "w1", 0);
    db.prepare("INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, ?)").run("o2", "w2", 1);
    db.prepare("INSERT INTO order_locks (order_key, locked_by, released) VALUES (?, ?, ?)").run("o3", "w3", 0);

    const active = db
      .prepare(
        "SELECT order_key, locked_by, locked_at FROM order_locks WHERE released = 0"
      )
      .all();
    expect(active).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Pool Snapshots
// ---------------------------------------------------------------------------

describe("Pool Snapshots", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should insert a pool snapshot", () => {
    const now = Date.now();
    db.prepare(
      "INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("opt1pool1_long_address_str", now, "500000000000000", "2500000000000000", 50.0, 3000);

    const row = db
      .prepare(
        "SELECT * FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get("opt1pool1_long_address_str");
    expect(row).toBeDefined();
    expect(row!.reserve0).toBe("500000000000000");
    expect(row!.price).toBe(50.0);
  });

  it("should retrieve snapshots in ascending timestamp order", () => {
    const base = 1700000000000;
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("opt1pool1_long_address_str", base + i * 600000, "1000", "5000", i + 1, 6000);
    }

    const rows = db
      .prepare(
        "SELECT timestamp, price FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp ASC LIMIT ?"
      )
      .all("opt1pool1_long_address_str", 100);

    expect(rows).toHaveLength(5);
    expect(rows[0]!.price).toBe(1);
    expect(rows[4]!.price).toBe(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.timestamp as number).toBeGreaterThan(rows[i - 1]!.timestamp as number);
    }
  });

  it("should deduplicate snapshots within 5min window", () => {
    const now = 1700000000000;
    db.prepare(
      "INSERT INTO pool_snapshots (pool_address, timestamp, reserve0, reserve1, price, tvl_sats) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("opt1pool1_long_address_str", now, "1000", "5000", 1, 6000);

    const lastSnap = db
      .prepare(
        "SELECT timestamp FROM pool_snapshots WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get("opt1pool1_long_address_str");

    // 1 minute later - should be too soon
    const tooSoon = lastSnap != null && (now + 60000) - (lastSnap.timestamp as number) < 5 * 60 * 1000;
    expect(tooSoon).toBe(true);

    // 6 minutes later - should be enough
    const enoughTime = lastSnap != null && (now + 6 * 60 * 1000) - (lastSnap.timestamp as number) < 5 * 60 * 1000;
    expect(enoughTime).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

describe("Leaderboard Queries", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
    const insert = db.prepare(
      "INSERT INTO players (address, mine_balance, total_sats_mined, hash_rate) VALUES (?, ?, ?, ?)"
    );
    insert.run("opt1alice_long_address_str", 500, 5000, 10);
    insert.run("opt1bob_longer_address_str", 1000, 10000, 20);
    insert.run("opt1charlie_long_addr_str", 250, 2500, 5);
    insert.run("opt1dave_longer_address_str", 750, 7500, 15);
  });

  afterEach(() => {
    db.close();
  });

  it("should rank players by mine_balance descending", () => {
    const rows = db
      .prepare(
        `SELECT address, mine_balance,
                ROW_NUMBER() OVER (ORDER BY mine_balance DESC) as rank
         FROM players ORDER BY mine_balance DESC LIMIT ?`
      )
      .all(10);

    expect(rows[0]!.address).toBe("opt1bob_longer_address_str");
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.address).toBe("opt1dave_longer_address_str");
    expect(rows[1]!.rank).toBe(2);
    expect(rows[3]!.address).toBe("opt1charlie_long_addr_str");
    expect(rows[3]!.rank).toBe(4);
  });

  it("should count total players", () => {
    const countRow = db
      .prepare("SELECT COUNT(*) as c FROM players")
      .get();
    expect(countRow).toBeDefined();
    expect(countRow!.c).toBe(4);
  });

  it("should respect limit parameter", () => {
    const rows = db
      .prepare(
        "SELECT address FROM players ORDER BY mine_balance DESC LIMIT ?"
      )
      .all(2);
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

describe("Address Validation", () => {
  it("should accept valid opt1 addresses", () => {
    expect(
      validateAddress(
        "opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my"
      )
    ).toBe(true);
    expect(validateAddress("opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa")).toBe(
      true
    );
  });

  it("should reject non-string addresses", () => {
    expect(validateAddress(null)).toBe(false);
    expect(validateAddress(undefined)).toBe(false);
    expect(validateAddress(12345)).toBe(false);
    expect(validateAddress({})).toBe(false);
  });

  it("should reject addresses not starting with opt1", () => {
    expect(validateAddress("tb1qexampleaddresslongenough")).toBe(false);
    expect(validateAddress("bc1qexampleaddresslongenough")).toBe(false);
    expect(validateAddress("0xabcdef1234567890abcdef")).toBe(false);
  });

  it("should reject addresses shorter than 20 chars", () => {
    expect(validateAddress("opt1short")).toBe(false);
    expect(validateAddress("opt1")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(validateAddress("")).toBe(false);
  });
});

describe("Token Address Validation", () => {
  it("should accept opt1 addresses", () => {
    expect(validateTokenAddress("opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa")).toBe(true);
  });

  it("should accept 0x addresses", () => {
    expect(validateTokenAddress("0xabcdef1234567890")).toBe(true);
  });

  it("should reject invalid prefixes", () => {
    expect(validateTokenAddress("tb1qexample")).toBe(false);
    expect(validateTokenAddress("bc1qexample")).toBe(false);
    expect(validateTokenAddress("invalid")).toBe(false);
  });

  it("should reject non-strings", () => {
    expect(validateTokenAddress(null)).toBe(false);
    expect(validateTokenAddress(123)).toBe(false);
  });
});

describe("Claim Amount Validation", () => {
  it("should accept positive finite numbers", () => {
    expect(validateClaimAmount(100)).toBe(true);
    expect(validateClaimAmount(0.001)).toBe(true);
    expect(validateClaimAmount(999999)).toBe(true);
  });

  it("should reject zero", () => {
    expect(validateClaimAmount(0)).toBe(false);
  });

  it("should reject negative numbers", () => {
    expect(validateClaimAmount(-100)).toBe(false);
    expect(validateClaimAmount(-0.001)).toBe(false);
  });

  it("should reject non-numbers", () => {
    expect(validateClaimAmount("100")).toBe(false);
    expect(validateClaimAmount(null)).toBe(false);
    expect(validateClaimAmount(undefined)).toBe(false);
  });

  it("should reject Infinity and NaN", () => {
    expect(validateClaimAmount(Infinity)).toBe(false);
    expect(validateClaimAmount(-Infinity)).toBe(false);
    expect(validateClaimAmount(NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Numeric Sanitization
// ---------------------------------------------------------------------------

describe("Numeric Sanitization", () => {
  it("should clamp negatives to 0", () => {
    expect(sanitizeNumeric(-5)).toBe(0);
    expect(sanitizeNumeric(-100)).toBe(0);
  });

  it("should floor integer values by default", () => {
    expect(sanitizeNumeric(5.7)).toBe(5);
    expect(sanitizeNumeric(10.99)).toBe(10);
  });

  it("should preserve decimals when allowFloat is true", () => {
    expect(sanitizeNumeric(5.7, true)).toBe(5.7);
    expect(sanitizeNumeric(10.99, true)).toBe(10.99);
  });

  it("should return 0 for non-numbers", () => {
    expect(sanitizeNumeric("hello")).toBe(0);
    expect(sanitizeNumeric(null)).toBe(0);
    expect(sanitizeNumeric(undefined)).toBe(0);
    expect(sanitizeNumeric(NaN)).toBe(0);
    expect(sanitizeNumeric(Infinity)).toBe(0);
  });

  it("should handle zero correctly", () => {
    expect(sanitizeNumeric(0)).toBe(0);
    expect(sanitizeNumeric(0, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Limit Clamping
// ---------------------------------------------------------------------------

describe("Limit Clamping", () => {
  it("should use default when input is empty or NaN", () => {
    expect(clampLimit(undefined, 50, 1, 100)).toBe(50);
    expect(clampLimit("", 50, 1, 100)).toBe(50);
    expect(clampLimit("abc", 50, 1, 100)).toBe(50);
  });

  it("should parse valid integer strings", () => {
    expect(clampLimit("25", 50, 1, 100)).toBe(25);
    expect(clampLimit("75", 50, 1, 100)).toBe(75);
  });

  it("should use default for zero input (parseInt falsy)", () => {
    // parseInt("0") is 0, which is falsy, so `|| defaultVal` kicks in
    expect(clampLimit("0", 50, 1, 100)).toBe(50);
    // parseInt("-5") is -5, which is truthy, so Math.max(-5, 1) = 1
    expect(clampLimit("-5", 50, 1, 100)).toBe(1);
  });

  it("should clamp above maximum", () => {
    expect(clampLimit("999", 50, 1, 100)).toBe(100);
    expect(clampLimit("200", 50, 1, 100)).toBe(100);
  });

  it("should work with leaderboard limits (1-100, default 50)", () => {
    expect(clampLimit("150", 50, 1, 100)).toBe(100);
    expect(clampLimit(undefined, 50, 1, 100)).toBe(50);
  });

  it("should work with token limits (1-2000, default 500)", () => {
    expect(clampLimit("3000", 500, 1, 2000)).toBe(2000);
    expect(clampLimit(undefined, 500, 1, 2000)).toBe(500);
  });

  it("should work with swap history limits (1-200, default 50)", () => {
    expect(clampLimit("300", 50, 1, 200)).toBe(200);
    expect(clampLimit("10", 50, 1, 200)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// RPC Method Filtering
// ---------------------------------------------------------------------------

describe("RPC Method Allowlist", () => {
  it("should allow standard read methods", () => {
    expect(isRpcMethodAllowed("btc_blockNumber")).toBe(true);
    expect(isRpcMethodAllowed("btc_call")).toBe(true);
    expect(isRpcMethodAllowed("btc_getBalance")).toBe(true);
    expect(isRpcMethodAllowed("btc_getCode")).toBe(true);
    expect(isRpcMethodAllowed("btc_getTransactionByHash")).toBe(true);
  });

  it("should reject write/dangerous methods", () => {
    expect(isRpcMethodAllowed("btc_sendRawTransaction")).toBe(false);
    expect(isRpcMethodAllowed("btc_sendTransaction")).toBe(false);
    expect(isRpcMethodAllowed("eth_sendTransaction")).toBe(false);
  });

  it("should reject unknown methods", () => {
    expect(isRpcMethodAllowed("admin_nodeInfo")).toBe(false);
    expect(isRpcMethodAllowed("debug_traceTransaction")).toBe(false);
    expect(isRpcMethodAllowed("")).toBe(false);
    expect(isRpcMethodAllowed("random_method")).toBe(false);
  });

  it("should include all 16 allowed methods", () => {
    expect(RPC_ALLOWED_METHODS.size).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Daily Emission / Halving
// ---------------------------------------------------------------------------

describe("Daily Emission & Halving", () => {
  const launchTime = LAUNCH_DATE.getTime();

  it("should return base emission on launch day", () => {
    expect(getDailyEmission(launchTime)).toBe(350_000);
  });

  it("should return base emission within first 7 days", () => {
    expect(getDailyEmission(launchTime + 6 * 86_400_000)).toBe(350_000);
  });

  it("should halve after 7 days", () => {
    expect(getDailyEmission(launchTime + 7 * 86_400_000)).toBe(175_000);
  });

  it("should halve again after 14 days", () => {
    expect(getDailyEmission(launchTime + 14 * 86_400_000)).toBe(87_500);
  });

  it("should halve three times after 21 days", () => {
    expect(getDailyEmission(launchTime + 21 * 86_400_000)).toBe(43_750);
  });

  it("should approach zero after many halvings", () => {
    const veryLate = launchTime + 365 * 86_400_000; // 1 year
    const emission = getDailyEmission(veryLate);
    expect(emission).toBeLessThan(1);
    expect(emission).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Claim Cooldown Logic
// ---------------------------------------------------------------------------

describe("Claim Cooldown Logic", () => {
  it("should allow claim when no previous claim", () => {
    const lastClaim = 0;
    const now = Date.now();
    const canClaim = !lastClaim || now - lastClaim >= CLAIM_COOLDOWN_MS;
    expect(canClaim).toBe(true);
  });

  it("should block claim within 5-minute window", () => {
    const now = Date.now();
    const lastClaim = now - 2 * 60 * 1000; // 2 minutes ago
    const canClaim = now - lastClaim >= CLAIM_COOLDOWN_MS;
    expect(canClaim).toBe(false);
  });

  it("should allow claim after cooldown expires", () => {
    const now = Date.now();
    const lastClaim = now - 6 * 60 * 1000; // 6 minutes ago
    const canClaim = now - lastClaim >= CLAIM_COOLDOWN_MS;
    expect(canClaim).toBe(true);
  });

  it("should calculate correct wait time", () => {
    const now = Date.now();
    const lastClaim = now - 3 * 60 * 1000; // 3 minutes ago
    const waitSec = Math.ceil(
      (CLAIM_COOLDOWN_MS - (now - lastClaim)) / 1000
    );
    expect(waitSec).toBe(120); // 2 minutes remaining
  });

  it("should show 0 or negative wait when cooldown expired", () => {
    const now = Date.now();
    const lastClaim = now - 10 * 60 * 1000;
    const remaining = CLAIM_COOLDOWN_MS - (now - lastClaim);
    expect(remaining).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// JSON Parsing of Swap Amounts/TxIds
// ---------------------------------------------------------------------------

describe("JSON Parsing of Swap Data", () => {
  it("should serialize and deserialize amounts correctly", () => {
    const amounts = { btcAmount: "0.001", tokenAmount: "1000000" };
    const json = JSON.stringify(amounts);
    const parsed = JSON.parse(json);
    expect(parsed.btcAmount).toBe("0.001");
    expect(parsed.tokenAmount).toBe("1000000");
  });

  it("should handle empty amounts object", () => {
    const json = JSON.stringify({});
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({});
  });

  it("should serialize tx_ids with nested data", () => {
    const txIds = {
      take: "abc123",
      complete: "def456",
      fractal: "ghi789",
    };
    const json = JSON.stringify(txIds);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed)).toHaveLength(3);
    expect(parsed.take).toBe("abc123");
  });

  it("should handle null/undefined amounts gracefully", () => {
    const amounts = undefined;
    const serialized = JSON.stringify(amounts ?? {});
    expect(serialized).toBe("{}");
  });

  it("should store and retrieve JSON from database", () => {
    const db = createTestDb();
    const amounts = { btc: "0.005", mine: "5000" };
    const txIds = { take: "txhash123" };

    db.prepare(
      "INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status, amounts, tx_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "json-test", "NativeSwap", "o1", "opt1w1_long_address_str",
      "BTC_TO_TOKEN", "taker", "take", "active",
      JSON.stringify(amounts), JSON.stringify(txIds)
    );

    const row = db
      .prepare("SELECT amounts, tx_ids FROM swap_operations WHERE id = ?")
      .get("json-test");

    expect(row).toBeDefined();
    const parsedAmounts = JSON.parse(row!.amounts as string);
    const parsedTxIds = JSON.parse(row!.tx_ids as string);

    expect(parsedAmounts.btc).toBe("0.005");
    expect(parsedTxIds.take).toBe("txhash123");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Token Constants
// ---------------------------------------------------------------------------

describe("Token Constants", () => {
  it("should have correct total supply", () => {
    expect(MINE_TOTAL_SUPPLY).toBe(21_000_000);
  });

  it("should have game pool as half of total supply", () => {
    expect(MINE_GAME_POOL).toBe(MINE_TOTAL_SUPPLY / 2);
  });

  it("should have correct halving interval", () => {
    expect(MINE_HALVING_DAYS).toBe(7);
  });

  it("should have correct conversion rate", () => {
    expect(MINE_PER_SAT).toBe(0.001);
  });

  it("should have launch date in February 2026", () => {
    expect(LAUNCH_DATE.getUTCFullYear()).toBe(2026);
    expect(LAUNCH_DATE.getUTCMonth()).toBe(1); // 0-indexed: 1 = February
    expect(LAUNCH_DATE.getUTCDate()).toBe(26);
  });
});

// ---------------------------------------------------------------------------
// Balance Capping Logic
// ---------------------------------------------------------------------------

describe("Balance Capping Logic", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should cap balance at 0 when pool is exhausted", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1whale_long_address_str", MINE_GAME_POOL);

    const poolRemaining = MINE_GAME_POOL - getTotalDistributed(db);
    expect(poolRemaining).toBe(0);

    const validatedBalance = 100;
    const cappedBalance = poolRemaining > 0 ? validatedBalance : 0;
    expect(cappedBalance).toBe(0);
  });

  it("should allow balance when pool has remaining", () => {
    db.prepare(
      "INSERT INTO players (address, mine_balance) VALUES (?, ?)"
    ).run("opt1existing_long_addr_str", 1000);

    const poolRemaining = MINE_GAME_POOL - getTotalDistributed(db);
    expect(poolRemaining).toBe(MINE_GAME_POOL - 1000);

    const validatedBalance = 50;
    const cappedBalance = poolRemaining > 0 ? validatedBalance : 0;
    expect(cappedBalance).toBe(50);
  });

  it("should prevent negative balance increases", () => {
    const prevBalance = 100;
    const newBalance = 50; // Client sends lower balance
    const cappedIncrease = Math.min(newBalance - prevBalance, 1000);
    const validated = prevBalance + Math.max(0, cappedIncrease);
    expect(validated).toBe(100); // Should not decrease
  });
});

// ---------------------------------------------------------------------------
// Edge Cases & Error Handling
// ---------------------------------------------------------------------------

describe("Edge Cases", () => {
  let db: WrappedDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should handle concurrent upserts without error", () => {
    for (let i = 0; i < 100; i++) {
      db.prepare(
        `INSERT INTO players (address, mine_balance) VALUES (?, ?)
         ON CONFLICT(address) DO UPDATE SET mine_balance = ?`
      ).run("opt1concurrent_long_addr", i, i);
    }

    const row = db
      .prepare("SELECT mine_balance FROM players WHERE address = ?")
      .get("opt1concurrent_long_addr");
    expect(row).toBeDefined();
    expect(row!.mine_balance).toBe(99);
  });

  it("should handle special characters in error messages", () => {
    const errorMsg = 'Transaction failed: "invalid" <script>alert(1)</script>';
    db.prepare(
      "INSERT INTO swap_operations (id, market, order_id, wallet, direction, role, step, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("err-1", "NativeSwap", "o1", "opt1w1_long_address_str", "BTC_TO_TOKEN", "taker", "take", "failed", errorMsg);

    const row = db
      .prepare("SELECT error FROM swap_operations WHERE id = ?")
      .get("err-1");
    expect(row).toBeDefined();
    expect(row!.error).toBe(errorMsg);
  });

  it("should handle empty swap_operations table gracefully", () => {
    const rows = db
      .prepare(
        "SELECT * FROM swap_operations WHERE wallet = ? AND status = ?"
      )
      .all("opt1nonexistent_long_addr", "active");
    expect(rows).toEqual([]);
  });

  it("should enforce claim_cooldowns primary key with upsert", () => {
    db.prepare(
      "INSERT INTO claim_cooldowns (address, last_claim_at) VALUES (?, ?)"
    ).run("opt1aaaaaaaaaaaaaaaaaaaaa", 1000);

    db.prepare(
      "INSERT INTO claim_cooldowns (address, last_claim_at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET last_claim_at = ?"
    ).run("opt1aaaaaaaaaaaaaaaaaaaaa", 2000, 2000);

    const row = db
      .prepare("SELECT last_claim_at FROM claim_cooldowns WHERE address = ?")
      .get("opt1aaaaaaaaaaaaaaaaaaaaa");
    expect(row).toBeDefined();
    expect(row!.last_claim_at).toBe(2000);
  });
});
