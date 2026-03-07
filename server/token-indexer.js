/**
 * Token Indexer — scans OPNet blocks for OP-20 contract deployments
 * using block.deployments[] array and btc_call for metadata.
 *
 * Runs as a background loop inside server/index.js
 */

const crypto = require('crypto');

const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';
const SCAN_INTERVAL_MS = 10_000; // 10 seconds
const BALANCE_CACHE_TTL_MS = 60_000; // 60 seconds

// ── RPC helper ──
let rpcId = 1;
async function rpc(method, params = []) {
    const res = await fetch(OPNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: rpcId++ }),
        signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
}

// ── btc_call helpers ──
// OPNet selectors: first 4 bytes of SHA-256("functionName()")
function getSelector(funcSig) {
    const hash = crypto.createHash('sha256').update(funcSig).digest();
    return hash.subarray(0, 4).toString('hex');
}

const SEL_NAME = getSelector('name()');
const SEL_SYMBOL = getSelector('symbol()');
const SEL_DECIMALS = getSelector('decimals()');
const SEL_TOTAL_SUPPLY = getSelector('totalSupply()');

/** Call a view function on a contract, return raw bytes or null */
async function callView(contractPubkey, selector) {
    try {
        const r = await rpc('btc_call', [contractPubkey, selector]);
        if (!r || r.error || r.revert) return null;
        const raw = typeof r.result === 'string' ? r.result : '';
        if (!raw || raw === 'AA==') return null;
        return Buffer.from(raw, 'base64');
    } catch { return null; }
}

/** Decode a string result from btc_call (4-byte length prefix + UTF-8) */
function decodeString(buf) {
    if (!buf || buf.length === 0) return '';
    if (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len > 0 && len <= buf.length - 4) {
            return buf.subarray(4, 4 + len).toString('utf-8').trim();
        }
    }
    // Fallback: try full buffer as string
    return buf.toString('utf-8').replace(/\0/g, '').trim();
}

/** Decode a uint from btc_call result */
function decodeUint(buf) {
    if (!buf || buf.length === 0) return 0;
    // Read as big-endian BigInt
    let hex = buf.toString('hex');
    if (!hex) return 0;
    try {
        return BigInt('0x' + hex);
    } catch { return 0n; }
}

// ── Probe contract via btc_call ──
async function probeOP20(contractPubkey) {
    try {
        const [nameB, symbolB, decimalsB, totalSupplyB] = await Promise.all([
            callView(contractPubkey, SEL_NAME),
            callView(contractPubkey, SEL_SYMBOL),
            callView(contractPubkey, SEL_DECIMALS),
            callView(contractPubkey, SEL_TOTAL_SUPPLY),
        ]);

        const name = decodeString(nameB);
        const symbol = decodeString(symbolB);
        if (!symbol && !name) return null;

        const decimals = decimalsB ? Number(decodeUint(decimalsB)) : 0;
        if (decimals < 0 || decimals > 18) return null;

        const totalSupply = totalSupplyB ? decodeUint(totalSupplyB).toString() : '0';

        return { name: name || 'Unknown', symbol: symbol || '?', decimals, totalSupply };
    } catch {
        return null;
    }
}

// ── BalanceOf via btc_call ──
async function getTokenBalance(tokenPubkey, holderMLDSAHex, holderTweakedHex) {
    try {
        const sel = getSelector('balanceOf(address)');
        const calldata = sel + holderMLDSAHex.replace('0x', '').padStart(64, '0');
        const params = [tokenPubkey, calldata, holderMLDSAHex];
        if (holderTweakedHex) params.push(holderTweakedHex);
        const r = await rpc('btc_call', params);
        if (!r || r.error || r.revert) return '0';
        const raw = typeof r.result === 'string' ? r.result : '';
        if (!raw || raw === 'AA==') return '0';
        const bin = Buffer.from(raw, 'base64');
        const n = BigInt('0x' + bin.toString('hex'));
        return n.toString();
    } catch { return '0'; }
}

// ══════════════════════════════════════════════════════════════
// Token Indexer class
// ══════════════════════════════════════════════════════════════
class TokenIndexer {
    constructor(db) {
        this.db = db;
        this._running = false;
        this._timer = null;
        this._scanning = false; // prevent concurrent scans
    }

    /** Initialize DB tables */
    init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS indexed_tokens (
                address TEXT PRIMARY KEY,
                pubkey TEXT NOT NULL,
                symbol TEXT NOT NULL DEFAULT '?',
                name TEXT NOT NULL DEFAULT 'Unknown',
                decimals INTEGER NOT NULL DEFAULT 8,
                total_supply TEXT NOT NULL DEFAULT '0',
                deploy_block INTEGER NOT NULL DEFAULT 0,
                discovered_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS scanner_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS balance_cache (
                token_holder TEXT PRIMARY KEY,
                balance TEXT NOT NULL DEFAULT '0',
                cached_at INTEGER NOT NULL DEFAULT 0
            );
        `);

        // Seed known tokens
        this._seedKnownTokens();
    }

    _seedKnownTokens() {
        const known = [
            {
                address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
                pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
                symbol: 'MINE', name: 'Mine Token', decimals: 8,
                total_supply: '2100000000000000', deploy_block: 3822,
            },
            {
                address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
                pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
                symbol: 'VIBE', name: 'Vibe Token', decimals: 8,
                total_supply: '10000000000000000', deploy_block: 3822,
            },
        ];

        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO indexed_tokens (address, pubkey, symbol, name, decimals, total_supply, deploy_block)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const t of known) {
            insert.run(t.address, t.pubkey, t.symbol, t.name, t.decimals, t.total_supply, t.deploy_block);
        }
    }

    _getLastBlock() {
        const row = this.db.prepare('SELECT value FROM scanner_state WHERE key = ?').get('last_scanned_block');
        return row ? parseInt(row.value, 10) : 0;
    }

    _setLastBlock(block) {
        this.db.prepare('INSERT OR REPLACE INTO scanner_state (key, value) VALUES (?, ?)').run('last_scanned_block', String(block));
    }

    /** Start background scanning loop */
    start() {
        if (this._running) return;
        this._running = true;
        console.log('[TokenIndexer] Starting background scanner');
        this._scan();
        this._timer = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
    }

    stop() {
        this._running = false;
        if (this._timer) clearInterval(this._timer);
    }

    /** Main scan loop */
    async _scan() {
        if (this._scanning) return; // prevent overlap
        this._scanning = true;
        try {
            const currentHeight = await this._getCurrentHeight();
            if (!currentHeight) return;

            const lastScanned = this._getLastBlock();
            const behind = currentHeight - lastScanned;
            // Backfill aggressively, normal otherwise
            const maxBlocks = behind > 200 ? 50 : 20;
            const endBlock = Math.min(lastScanned + maxBlocks, currentHeight);

            if (behind > 100 && behind % 200 < maxBlocks) {
                console.log(`[TokenIndexer] Backfill: ${lastScanned}→${currentHeight} (${behind} blocks behind, ${this.getTokenCount()} tokens)`);
            }

            // Process blocks sequentially (each block may have many deployments to probe)
            for (let blockNum = lastScanned + 1; blockNum <= endBlock; blockNum++) {
                await this._scanBlock(blockNum);
            }

            if (endBlock > lastScanned) {
                this._setLastBlock(endBlock);
            }
        } catch (e) {
            console.warn('[TokenIndexer] Scan error:', e.message);
        } finally {
            this._scanning = false;
        }
    }

    async _getCurrentHeight() {
        try {
            const r = await rpc('btc_blockNumber');
            if (typeof r === 'number') return r;
            if (typeof r === 'string') {
                return r.startsWith('0x') ? parseInt(r.slice(2), 16) : parseInt(r, 10);
            }
            return null;
        } catch { return null; }
    }

    /** Scan a single block — read deployments[] array (requires prefetchTxs=true) */
    async _scanBlock(blockNum) {
        try {
            const hex = '0x' + blockNum.toString(16);
            const block = await rpc('btc_getBlockByNumber', [hex, true]);
            if (!block) return;

            const deployments = block.deployments || [];
            if (deployments.length === 0) return;

            // Filter out already indexed pubkeys
            const newPubkeys = [];
            for (const pk of deployments) {
                const existing = this.db.prepare('SELECT pubkey FROM indexed_tokens WHERE pubkey = ?').get(pk);
                if (!existing) newPubkeys.push(pk);
            }

            if (newPubkeys.length === 0) return;

            // Probe in batches of 5 to avoid overloading RPC
            const BATCH = 5;
            for (let i = 0; i < newPubkeys.length; i += BATCH) {
                const batch = newPubkeys.slice(i, i + BATCH);
                const results = await Promise.allSettled(batch.map(pk => probeOP20(pk)));

                for (let j = 0; j < batch.length; j++) {
                    const pk = batch[j];
                    const result = results[j];
                    if (result.status !== 'fulfilled' || !result.value) continue;

                    const info = result.value;
                    this.db.prepare(`
                        INSERT OR IGNORE INTO indexed_tokens (address, pubkey, symbol, name, decimals, total_supply, deploy_block)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(pk, pk, info.symbol, info.name, info.decimals, info.totalSupply, blockNum);
                }
            }

            const indexed = newPubkeys.length;
            if (indexed > 0) {
                console.log(`[TokenIndexer] Block ${blockNum}: ${deployments.length} deployments, probed ${indexed} new (total: ${this.getTokenCount()})`);
            }
        } catch (e) {
            // Block fetch failure — will retry next cycle
        }
    }

    // ── API Handlers ──

    getAllTokens() {
        return this.db.prepare('SELECT * FROM indexed_tokens ORDER BY deploy_block ASC').all();
    }

    getTokenCount() {
        const row = this.db.prepare('SELECT COUNT(*) as cnt FROM indexed_tokens').get();
        return row?.cnt || 0;
    }

    getScanStatus() {
        const lastScanned = this._getLastBlock();
        const count = this.getTokenCount();
        return { lastScannedBlock: lastScanned, tokenCount: count };
    }

    /** Manually add a token by hex pubkey or opt1 address */
    async addTokenByAddress(address) {
        // Check if already indexed (by address or pubkey)
        const existing = this.db.prepare('SELECT * FROM indexed_tokens WHERE address = ? OR pubkey = ?').get(address, address);
        if (existing) return { ok: true, token: existing, existed: true };

        const info = await probeOP20(address);
        if (!info) return { ok: false, error: 'Not a valid OP-20 token or cannot read metadata' };

        this.db.prepare(`
            INSERT OR IGNORE INTO indexed_tokens (address, pubkey, symbol, name, decimals, total_supply, deploy_block)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(address, address, info.symbol, info.name, info.decimals, info.totalSupply, 0);

        console.log(`[TokenIndexer] Manually added: ${info.symbol} (${info.name}) at ${address}`);
        const token = this.db.prepare('SELECT * FROM indexed_tokens WHERE address = ?').get(address);
        return { ok: true, token, existed: false };
    }

    /** Get all token balances for a holder */
    async getHolderBalances(holderPubkey, holderTweaked) {
        const tokens = this.getAllTokens();
        const now = Date.now();
        const results = [];

        for (const token of tokens) {
            const cacheKey = `${token.pubkey}:${holderPubkey}`;
            const cached = this.db.prepare('SELECT balance, cached_at FROM balance_cache WHERE token_holder = ?').get(cacheKey);

            if (cached && (now - cached.cached_at) < BALANCE_CACHE_TTL_MS) {
                if (cached.balance !== '0') {
                    results.push({
                        token: token.address,
                        pubkey: token.pubkey,
                        symbol: token.symbol,
                        name: token.name,
                        decimals: token.decimals,
                        balance: cached.balance,
                    });
                }
                continue;
            }

            const balance = await getTokenBalance(token.pubkey, holderPubkey, holderTweaked);
            this.db.prepare('INSERT OR REPLACE INTO balance_cache (token_holder, balance, cached_at) VALUES (?, ?, ?)').run(cacheKey, balance, now);

            if (balance !== '0') {
                results.push({
                    token: token.address,
                    pubkey: token.pubkey,
                    symbol: token.symbol,
                    name: token.name,
                    decimals: token.decimals,
                    balance,
                });
            }
        }

        return results;
    }
}

module.exports = { TokenIndexer };
