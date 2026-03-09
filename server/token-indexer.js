/**
 * Token Indexer — scans OPNet blocks for OP-20 contract deployments
 * using block.deployments[] array and btc_call for metadata.
 * Also tracks holder counts from Transfer/Mint events and mintable status.
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
const SEL_IS_PUBLIC_MINT = getSelector('isPublicMintEnabled()');
const SEL_FREE_MINT_INFO = getSelector('getFreeMintInfo()');
const SEL_GET_POOL = getSelector('getPool(address,address)');
const SEL_GET_RESERVES = getSelector('getReserves()');
const SEL_TOKEN0 = getSelector('token0()');
const SEL_TOKEN1 = getSelector('token1()');

// ── Motoswap Factory address (env-overridable for mainnet) ──
const MOTOSWAP_FACTORY = process.env.MOTOSWAP_FACTORY_PUBKEY || '0xa02aa5ca4c307107484d5fb690d811df1cf526f8de204d24528653dcae369a0f';
const POOL_DISCOVERY_INTERVAL_MS = 120_000; // 2 minutes

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
    let hex = buf.toString('hex');
    if (!hex) return 0;
    try { return BigInt('0x' + hex); } catch { return 0n; }
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

// ── Check mintable status via btc_call ──
async function checkMintable(contractPubkey) {
    try {
        // Try MintableToken: isPublicMintEnabled()
        const buf = await callView(contractPubkey, SEL_IS_PUBLIC_MINT);
        if (buf && buf.length > 0) {
            return buf[buf.length - 1] > 0 ? 1 : 0;
        }
        // Try Factory OP20: getFreeMintInfo()
        const fmBuf = await callView(contractPubkey, SEL_FREE_MINT_INFO);
        if (fmBuf && fmBuf.length > 0) {
            return 1;
        }
        return 0;
    } catch { return 0; }
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
        this._scanning = false;
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

        // Migration: add mintable and holder_count columns
        try { this.db.exec(`ALTER TABLE indexed_tokens ADD COLUMN mintable INTEGER DEFAULT -1`); } catch {}
        try { this.db.exec(`ALTER TABLE indexed_tokens ADD COLUMN holder_count INTEGER DEFAULT 0`); } catch {}

        // Holder tracking table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS token_holders (
                token_pubkey TEXT NOT NULL,
                holder_hash TEXT NOT NULL,
                PRIMARY KEY (token_pubkey, holder_hash)
            );
        `);

        // Motoswap pool discovery table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS motoswap_pools (
                pool_pubkey TEXT PRIMARY KEY,
                token0_pubkey TEXT NOT NULL,
                token1_pubkey TEXT NOT NULL,
                token0_symbol TEXT DEFAULT '?',
                token1_symbol TEXT DEFAULT '?',
                token0_decimals INTEGER DEFAULT 8,
                token1_decimals INTEGER DEFAULT 8,
                reserve0 TEXT DEFAULT '0',
                reserve1 TEXT DEFAULT '0',
                last_updated TEXT DEFAULT (datetime('now'))
            );
        `);

        this._seedKnownTokens();
    }

    _seedKnownTokens() {
        // Seed tokens from env (JSON array) or use testnet defaults
        const envSeed = process.env.SEED_TOKENS;
        const known = envSeed ? JSON.parse(envSeed) : [
            {
                address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
                pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
                symbol: 'MINE', name: 'Mine Token', decimals: 8,
                total_supply: '2100000000000000', deploy_block: 3822, mintable: 1,
            },
            {
                address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
                pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
                symbol: 'VIBE', name: 'Vibe Token', decimals: 8,
                total_supply: '10000000000000000', deploy_block: 3822, mintable: 1,
            },
        ];

        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO indexed_tokens (address, pubkey, symbol, name, decimals, total_supply, deploy_block, mintable)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const t of known) {
            insert.run(t.address, t.pubkey, t.symbol, t.name, t.decimals, t.total_supply, t.deploy_block, t.mintable);
        }
    }

    // ── State helpers ──
    _getState(key) {
        const row = this.db.prepare('SELECT value FROM scanner_state WHERE key = ?').get(key);
        return row ? row.value : null;
    }

    _setState(key, value) {
        this.db.prepare('INSERT OR REPLACE INTO scanner_state (key, value) VALUES (?, ?)').run(key, String(value));
    }

    _getLastBlock() {
        const v = this._getState('last_scanned_block');
        return v ? parseInt(v, 10) : 0;
    }

    _setLastBlock(block) {
        this._setState('last_scanned_block', block);
    }

    /** Start background scanning loop */
    start() {
        if (this._running) return;
        this._running = true;
        console.log('[TokenIndexer] Starting background scanner');
        this._scan();
        this._timer = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
        // Pool discovery runs less frequently
        this._poolTimer = setInterval(() => {
            this.discoverMotoswapPools().catch(() => {});
            this.updatePoolReserves().catch(() => {});
        }, POOL_DISCOVERY_INTERVAL_MS);
        // Initial pool discovery after 30s (let token scan get ahead first)
        setTimeout(() => {
            this.discoverMotoswapPools().catch(() => {});
        }, 30_000);
    }

    stop() {
        this._running = false;
        if (this._timer) clearInterval(this._timer);
        if (this._poolTimer) clearInterval(this._poolTimer);
    }

    /** Main scan loop */
    async _scan() {
        if (this._scanning) return;
        this._scanning = true;
        try {
            const currentHeight = await this._getCurrentHeight();
            if (!currentHeight) return;

            const lastScanned = this._getLastBlock();
            const behind = currentHeight - lastScanned;
            const maxBlocks = behind > 200 ? 50 : 20;
            const endBlock = Math.min(lastScanned + maxBlocks, currentHeight);

            if (behind > 100 && behind % 200 < maxBlocks) {
                console.log(`[TokenIndexer] Backfill: ${lastScanned}->${currentHeight} (${behind} blocks behind, ${this.getTokenCount()} tokens)`);
            }

            for (let blockNum = lastScanned + 1; blockNum <= endBlock; blockNum++) {
                await this._scanBlock(blockNum);
            }

            if (endBlock > lastScanned) {
                this._setLastBlock(endBlock);
            }

            // Run enrichment when mostly caught up
            if (behind <= 20) {
                await this._enrichTokens();
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

    /** Scan a single block — deployments + events */
    async _scanBlock(blockNum) {
        try {
            const hex = '0x' + blockNum.toString(16);
            const block = await rpc('btc_getBlockByNumber', [hex, true]);
            if (!block) return;

            // 1. Process deployments
            const deployments = block.deployments || [];
            if (deployments.length > 0) {
                const newPubkeys = [];
                for (const pk of deployments) {
                    const existing = this.db.prepare('SELECT pubkey FROM indexed_tokens WHERE pubkey = ?').get(pk);
                    if (!existing) newPubkeys.push(pk);
                }

                if (newPubkeys.length > 0) {
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
                    console.log(`[TokenIndexer] Block ${blockNum}: ${deployments.length} deployments, probed ${newPubkeys.length} new (total: ${this.getTokenCount()})`);
                }
            }

            // 2. Process events for holder tracking
            this._processBlockEvents(block);
        } catch (e) {
            // Block fetch failure — will retry next cycle
        }
    }

    /** Extract holder addresses from Transfer/Mint events in block */
    _processBlockEvents(block) {
        const txs = block.transactions || [];
        const insertHolder = this.db.prepare(
            'INSERT OR IGNORE INTO token_holders (token_pubkey, holder_hash) VALUES (?, ?)'
        );
        const ZERO = '0'.repeat(64);

        for (const tx of txs) {
            const events = tx.events || [];
            for (const ev of events) {
                if (!ev.contractAddress || !ev.data) continue;
                if (ev.type !== 'Transferred' && ev.type !== 'Minted') continue;
                try {
                    const data = Buffer.from(ev.data, 'base64');
                    if (ev.type === 'Transferred' && data.length >= 64) {
                        // ABI: [from: ADDRESS(32), to: ADDRESS(32), value: UINT256(32)]
                        const from = data.subarray(0, 32).toString('hex');
                        const to = data.subarray(32, 64).toString('hex');
                        if (from !== ZERO) insertHolder.run(ev.contractAddress, from);
                        if (to !== ZERO) insertHolder.run(ev.contractAddress, to);
                    } else if (ev.type === 'Minted' && data.length >= 32) {
                        // ABI: [to: ADDRESS(32), amount: UINT256(32)]
                        const to = data.subarray(0, 32).toString('hex');
                        if (to !== ZERO) insertHolder.run(ev.contractAddress, to);
                    }
                } catch { /* ignore decode errors */ }
            }
        }
    }

    /** Enrichment: mintable detection + holder count backfill */
    async _enrichTokens() {
        try {
            // 1. Backfill holder events for previously scanned blocks
            const holderScan = parseInt(this._getState('holder_scan_block') || '0', 10);
            const mainScan = this._getLastBlock();
            if (holderScan < mainScan) {
                // Larger batches for events-only scan (lightweight)
                const gap = mainScan - holderScan;
                const batchSize = gap > 1000 ? 100 : gap > 200 ? 50 : 30;
                const batchEnd = Math.min(holderScan + batchSize, mainScan);
                for (let b = holderScan + 1; b <= batchEnd; b++) {
                    await this._scanBlockEventsOnly(b);
                }
                this._setState('holder_scan_block', batchEnd);
                if (batchEnd < mainScan && (mainScan - batchEnd) % 500 < batchSize + 5) {
                    console.log(`[TokenIndexer] Holder backfill: ${batchEnd}/${mainScan} (${gap} behind)`);
                }
            }

            // 2. Check mintable for unknown tokens (batch of 10)
            const unknown = this.db.prepare(
                'SELECT pubkey FROM indexed_tokens WHERE mintable = -1 LIMIT 10'
            ).all();
            if (unknown.length > 0) {
                const results = await Promise.allSettled(
                    unknown.map(t => checkMintable(t.pubkey))
                );
                for (let i = 0; i < unknown.length; i++) {
                    const val = results[i].status === 'fulfilled' ? results[i].value : 0;
                    this.db.prepare('UPDATE indexed_tokens SET mintable = ? WHERE pubkey = ?')
                        .run(val, unknown[i].pubkey);
                }
            }

            // 3. Update holder counts from token_holders table
            this.db.exec(`
                UPDATE indexed_tokens SET holder_count = COALESCE(
                    (SELECT COUNT(*) FROM token_holders WHERE token_pubkey = indexed_tokens.pubkey), 0
                )
            `);
        } catch (e) {
            console.warn('[TokenIndexer] Enrichment error:', e.message);
        }
    }

    /** Scan a block only for events (holder backfill) */
    async _scanBlockEventsOnly(blockNum) {
        try {
            const hex = '0x' + blockNum.toString(16);
            const block = await rpc('btc_getBlockByNumber', [hex, true]);
            if (block) this._processBlockEvents(block);
        } catch { /* ignore */ }
    }

    // ── API Handlers ──

    getAllTokens(limit = 500, offset = 0) {
        return this.db.prepare('SELECT * FROM indexed_tokens ORDER BY deploy_block ASC LIMIT ? OFFSET ?').all(limit, offset);
    }

    getTokenCount() {
        const row = this.db.prepare('SELECT COUNT(*) as cnt FROM indexed_tokens').get();
        return row?.cnt || 0;
    }

    getScanStatus() {
        const lastScanned = this._getLastBlock();
        const count = this.getTokenCount();
        const mintableCount = this.db.prepare('SELECT COUNT(*) as cnt FROM indexed_tokens WHERE mintable = 1').get()?.cnt || 0;
        const holderScan = parseInt(this._getState('holder_scan_block') || '0', 10);
        return { lastScannedBlock: lastScanned, tokenCount: count, mintableCount, holderScanBlock: holderScan };
    }

    /** Manually add a token by hex pubkey or opt1 address */
    async addTokenByAddress(address) {
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

    // ── Motoswap Pool Discovery ──

    /** Discover Motoswap pools by querying Factory.getPool for top token pairs */
    async discoverMotoswapPools() {
        try {
            // Get top 30 tokens by holder count (most likely to have pools)
            const topTokens = this.db.prepare(
                'SELECT pubkey, symbol, decimals FROM indexed_tokens WHERE holder_count > 0 ORDER BY holder_count DESC LIMIT 30'
            ).all();

            if (topTokens.length < 2) return;

            const ZERO = '0'.repeat(64);
            let discovered = 0;

            // Query getPool for each unique pair
            for (let i = 0; i < topTokens.length && i < 30; i++) {
                for (let j = i + 1; j < topTokens.length && j < 30; j++) {
                    const a = topTokens[i];
                    const b = topTokens[j];
                    const pkA = a.pubkey.replace('0x', '').padStart(64, '0');
                    const pkB = b.pubkey.replace('0x', '').padStart(64, '0');

                    // Check if already discovered
                    const pairKey = [pkA, pkB].sort().join(':');
                    const existing = this.db.prepare(
                        'SELECT pool_pubkey FROM motoswap_pools WHERE (token0_pubkey = ? AND token1_pubkey = ?) OR (token0_pubkey = ? AND token1_pubkey = ?)'
                    ).get(a.pubkey, b.pubkey, b.pubkey, a.pubkey);
                    if (existing) continue;

                    try {
                        const calldata = SEL_GET_POOL + pkA + pkB;
                        const buf = await callView(MOTOSWAP_FACTORY, calldata);
                        if (!buf || buf.length < 32) continue;

                        const poolPk = buf.subarray(buf.length - 32).toString('hex');
                        if (poolPk === ZERO || poolPk.length < 64) continue;

                        // Pool exists! Get reserves
                        const poolPubkey = '0x' + poolPk;
                        const resBuf = await callView(poolPk, SEL_GET_RESERVES);
                        let r0 = '0', r1 = '0';
                        if (resBuf && resBuf.length >= 64) {
                            r0 = BigInt('0x' + resBuf.subarray(0, 32).toString('hex')).toString();
                            r1 = BigInt('0x' + resBuf.subarray(32, 64).toString('hex')).toString();
                        }

                        // Determine actual token0/token1 from pool contract
                        const t0Buf = await callView(poolPk, SEL_TOKEN0);
                        const t1Buf = await callView(poolPk, SEL_TOKEN1);
                        let tok0pk = a.pubkey, tok1pk = b.pubkey;
                        let tok0sym = a.symbol, tok1sym = b.symbol;
                        let tok0dec = a.decimals, tok1dec = b.decimals;
                        if (t0Buf && t0Buf.length >= 32) {
                            const actualT0 = '0x' + t0Buf.subarray(t0Buf.length - 32).toString('hex');
                            if (actualT0 === b.pubkey) {
                                // Swap order
                                tok0pk = b.pubkey; tok1pk = a.pubkey;
                                tok0sym = b.symbol; tok1sym = a.symbol;
                                tok0dec = b.decimals; tok1dec = a.decimals;
                            }
                        }

                        this.db.prepare(`
                            INSERT OR REPLACE INTO motoswap_pools (pool_pubkey, token0_pubkey, token1_pubkey, token0_symbol, token1_symbol, token0_decimals, token1_decimals, reserve0, reserve1, last_updated)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                        `).run(poolPubkey, tok0pk, tok1pk, tok0sym, tok1sym, tok0dec, tok1dec, r0, r1);

                        discovered++;
                        console.log(`[TokenIndexer] Motoswap pool found: ${tok0sym}/${tok1sym} at ${poolPubkey.slice(0, 16)}... reserves ${r0}/${r1}`);
                    } catch { /* skip pair */ }
                }
            }

            if (discovered > 0) {
                console.log(`[TokenIndexer] Discovered ${discovered} new Motoswap pools`);
            }
        } catch (e) {
            console.warn('[TokenIndexer] Pool discovery error:', e.message);
        }
    }

    /** Update reserves for all known Motoswap pools */
    async updatePoolReserves() {
        try {
            const pools = this.db.prepare('SELECT pool_pubkey FROM motoswap_pools').all();
            for (const pool of pools) {
                try {
                    const pk = pool.pool_pubkey.replace('0x', '');
                    const resBuf = await callView(pk, SEL_GET_RESERVES);
                    if (resBuf && resBuf.length >= 64) {
                        const r0 = BigInt('0x' + resBuf.subarray(0, 32).toString('hex')).toString();
                        const r1 = BigInt('0x' + resBuf.subarray(32, 64).toString('hex')).toString();
                        this.db.prepare('UPDATE motoswap_pools SET reserve0 = ?, reserve1 = ?, last_updated = datetime(\'now\') WHERE pool_pubkey = ?')
                            .run(r0, r1, pool.pool_pubkey);
                    }
                } catch { /* skip pool */ }
            }
        } catch (e) {
            console.warn('[TokenIndexer] Reserve update error:', e.message);
        }
    }

    /** Get all discovered Motoswap pools */
    getMotoswapPools() {
        return this.db.prepare('SELECT * FROM motoswap_pools ORDER BY last_updated DESC').all();
    }

    /** Get all token balances for a holder */
    async getHolderBalances(holderPubkey, holderTweaked) {
        const tokens = this.getAllTokens(100000, 0); // internal: get all for balance scan
        const now = Date.now();
        const results = [];

        for (const token of tokens) {
            const cacheKey = `${token.pubkey}:${holderPubkey}`;
            const cached = this.db.prepare('SELECT balance, cached_at FROM balance_cache WHERE token_holder = ?').get(cacheKey);

            if (cached && (now - cached.cached_at) < BALANCE_CACHE_TTL_MS) {
                if (cached.balance !== '0') {
                    results.push({
                        token: token.address, pubkey: token.pubkey,
                        symbol: token.symbol, name: token.name,
                        decimals: token.decimals, balance: cached.balance,
                    });
                }
                continue;
            }

            const balance = await getTokenBalance(token.pubkey, holderPubkey, holderTweaked);
            this.db.prepare('INSERT OR REPLACE INTO balance_cache (token_holder, balance, cached_at) VALUES (?, ?, ?)').run(cacheKey, balance, now);

            if (balance !== '0') {
                results.push({
                    token: token.address, pubkey: token.pubkey,
                    symbol: token.symbol, name: token.name,
                    decimals: token.decimals, balance,
                });
            }
        }

        return results;
    }
}

module.exports = { TokenIndexer };
