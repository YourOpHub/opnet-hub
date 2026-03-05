/**
 * Token Indexer — scans OPNet blocks for OP-20 contract deployments
 * and provides APIs for token discovery + balance queries.
 *
 * Runs as a background loop inside server/index.js
 */

const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';
const SCAN_INTERVAL_MS = 30_000; // 30 seconds
const BALANCE_CACHE_TTL_MS = 60_000; // 60 seconds

// ── RPC helper ──
async function rpc(method, params = []) {
    const res = await fetch(OPNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
}

// ── Storage slot helpers (OP-20: 0=name, 1=symbol, 2=decimals, 3=totalSupply) ──
function slotToPointer(slot) {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint32(28, slot, false);
    const bytes = new Uint8Array(buf);
    return Buffer.from(bytes).toString('base64');
}

function decodeStorageVal(val) {
    if (val == null) return '';
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (val.startsWith('0x')) {
            try {
                const n = BigInt(val);
                if (n < 256n) return Number(n);
                return val;
            } catch { return val; }
        }
        return val;
    }
    if (typeof val === 'object') {
        if (val.value !== undefined) return decodeStorageVal(val.value);
        if (typeof val.valueHex === 'string' && val.valueHex.startsWith('0x')) {
            return Number(BigInt(val.valueHex));
        }
    }
    return String(val);
}

async function getStorageAt(address, slot) {
    const pointer = slotToPointer(slot);
    try {
        return await rpc('btc_getStorageAt', [address, pointer, false]);
    } catch { return null; }
}

// ── Check if contract is OP-20 by reading storage slots ──
async function probeOP20(contractPubkey) {
    try {
        const [nameR, symbolR, decimalsR, totalSupplyR] = await Promise.all([
            getStorageAt(contractPubkey, 0),
            getStorageAt(contractPubkey, 1),
            getStorageAt(contractPubkey, 2),
            getStorageAt(contractPubkey, 3),
        ]);

        const name = String(decodeStorageVal(nameR) || '').trim();
        const symbol = String(decodeStorageVal(symbolR) || '').trim();
        const decimals = Number(decodeStorageVal(decimalsR)) || 0;
        const totalSupplyRaw = decodeStorageVal(totalSupplyR);
        const totalSupply = typeof totalSupplyRaw === 'string' && totalSupplyRaw.startsWith('0x')
            ? totalSupplyRaw : String(totalSupplyRaw || '0');

        // Must have at least symbol or name to be considered OP-20
        if (!symbol && !name) return null;
        // Decimals sanity check
        if (decimals < 0 || decimals > 18) return null;

        return { name: name || 'Unknown', symbol: symbol || '?', decimals, totalSupply };
    } catch {
        return null;
    }
}

// ── BalanceOf via btc_call ──
// btc_call params: [to, calldata, fromMLDSAHex, fromTweakedHex]
async function getTokenBalance(tokenAddress, holderMLDSAHex, holderTweakedHex) {
    try {
        const BALANCE_OF_SELECTOR = '5b46f8f6';
        const calldata = BALANCE_OF_SELECTOR + holderMLDSAHex.replace('0x', '').padStart(64, '0');
        const params = [tokenAddress, calldata, holderMLDSAHex];
        if (holderTweakedHex) params.push(holderTweakedHex);
        const r = await rpc('btc_call', params);
        if (!r || r.error || r.revert) return '0';
        const raw = typeof r.result === 'string' ? r.result : (r.returnData || '');
        if (!raw || raw === 'AA==') return '0';
        let hex = raw;
        if (!hex.startsWith('0x')) {
            // base64 decode
            try {
                const bin = Buffer.from(raw, 'base64');
                hex = '0x' + bin.toString('hex');
            } catch { return '0'; }
        }
        const n = BigInt(hex);
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

        // Seed known tokens if not already present
        this._seedKnownTokens();
    }

    _seedKnownTokens() {
        const known = [
            {
                address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
                pubkey: 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
                symbol: 'MINE', name: 'Mine Token', decimals: 8,
                total_supply: '2100000000000000', deploy_block: 3822,
            },
            {
                address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
                pubkey: '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
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

    /** Get last scanned block */
    _getLastBlock() {
        const row = this.db.prepare('SELECT value FROM scanner_state WHERE key = ?').get('last_scanned_block');
        return row ? parseInt(row.value, 10) : 0;
    }

    /** Set last scanned block */
    _setLastBlock(block) {
        this.db.prepare('INSERT OR REPLACE INTO scanner_state (key, value) VALUES (?, ?)').run('last_scanned_block', String(block));
    }

    /** Start background scanning loop */
    start() {
        if (this._running) return;
        this._running = true;
        console.log('[TokenIndexer] Starting background scanner');
        this._scan(); // first scan immediately
        this._timer = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
    }

    stop() {
        this._running = false;
        if (this._timer) clearInterval(this._timer);
    }

    /** Scan new blocks for deployments */
    async _scan() {
        try {
            const currentHeight = await this._getCurrentHeight();
            if (!currentHeight) return;

            let lastScanned = this._getLastBlock();
            if (lastScanned === 0) {
                // Start from a reasonable point (don't scan from genesis)
                lastScanned = Math.max(0, currentHeight - 100);
            }

            // Scan up to 10 blocks per cycle (avoid overload)
            const maxBlocks = 10;
            const endBlock = Math.min(lastScanned + maxBlocks, currentHeight);

            for (let blockNum = lastScanned + 1; blockNum <= endBlock; blockNum++) {
                await this._scanBlock(blockNum);
            }

            if (endBlock > lastScanned) {
                this._setLastBlock(endBlock);
            }
        } catch (e) {
            console.warn('[TokenIndexer] Scan error:', e.message);
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

    async _scanBlock(blockNum) {
        try {
            const hex = '0x' + blockNum.toString(16);
            const block = await rpc('btc_getBlockByNumber', [hex, true]);
            if (!block || !block.transactions) return;

            for (const tx of block.transactions) {
                // Look for deployment transactions
                if (tx.OPNetType === 'Deployment' || tx.opnetType === 'Deployment' ||
                    tx.type === 'Deployment' || tx.contractAddress) {
                    const addr = tx.contractAddress || tx.deployedContract;
                    const pubkey = tx.contractPubKey || tx.deployedPubKey || '';
                    if (addr) {
                        await this._tryIndexToken(addr, pubkey.replace('0x', ''), blockNum);
                    }
                }
            }
        } catch (e) {
            // Some blocks may not be fetched with txs — that's fine
        }
    }

    async _tryIndexToken(address, pubkey, blockNum) {
        // Already indexed?
        const existing = this.db.prepare('SELECT address FROM indexed_tokens WHERE address = ?').get(address);
        if (existing) return;

        // If no pubkey, we can't probe — try using address directly
        const probeAddr = pubkey || address;
        const info = await probeOP20(probeAddr);
        if (!info) return; // Not an OP-20 or can't read

        this.db.prepare(`
            INSERT OR IGNORE INTO indexed_tokens (address, pubkey, symbol, name, decimals, total_supply, deploy_block)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(address, pubkey, info.symbol, info.name, info.decimals, info.totalSupply, blockNum);

        console.log(`[TokenIndexer] Found OP-20: ${info.symbol} (${info.name}) at ${address}`);
    }

    // ── API Handlers ──

    /** GET /api/tokens — all known OP-20 tokens */
    getAllTokens() {
        return this.db.prepare('SELECT * FROM indexed_tokens ORDER BY deploy_block ASC').all();
    }

    /** GET /api/holder/:pubkey/tokens — all balances for a holder
     *  holderPubkey = MLDSA hash hex, holderTweaked = tweaked pubkey hex (optional but needed for balanceOf)
     */
    async getHolderBalances(holderPubkey, holderTweaked) {
        const tokens = this.getAllTokens();
        const now = Date.now();
        const results = [];

        // Check cache first, then fetch missing
        for (const token of tokens) {
            const cacheKey = `${token.address}:${holderPubkey}`;
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

            // Fetch on-chain balance — use opt1 address for btc_call (not hex pubkey)
            const balance = await getTokenBalance(token.address, holderPubkey, holderTweaked);

            // Cache it
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
