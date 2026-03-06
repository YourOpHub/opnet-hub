/**
 * FractalSwap v7 Auto-Complete Relayer
 *
 * Monitors "Taken" FractalSwap orders on OPNet and checks if the corresponding
 * Fractal BTC payment has been sent. If detected, calls relayerComplete() to
 * release the locked BTC to the correct party.
 *
 * Flow:
 * 1. Poll OPNet contract for Taken orders (via btc_call RPC)
 * 2. For each Taken order, get the target Fractal address
 * 3. Check Fractal mempool API for incoming payments
 * 4. If payment found → call relayerComplete (via OPNet SDK)
 *
 * Requires: OPNET_MNEMONIC env var for signing transactions
 */

const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';
const FRACTAL_API = 'https://mempool-testnet.fractalbitcoin.io/api';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

// FractalSwap v7 contract address
const CROSSCHAIN_ADDRESS = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
const CROSSCHAIN_PUBKEY = '0x526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';

// Selectors (sha256-based, from opnet-transform)
const SEL_GET_NEXT_ORDER_ID = 'f4920cae';
const SEL_GET_ORDER = 'e9489555';
const SEL_RELAYER_COMPLETE = '4e402884';

// Order statuses
const STATUS_TAKEN = 2;

// Direction
const DIR_BTC_TO_FB = 1;
const DIR_FB_TO_BTC = 2;

class FractalSwapRelayer {
    constructor() {
        this.processedOrders = new Set(); // orderId → already completed
        this.running = false;
    }

    async rpcCall(method, params) {
        const res = await fetch(OPNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
            signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
        return data.result;
    }

    /** Encode a u256 as 32-byte hex (big-endian, left-padded) */
    encodeU256(n) {
        return BigInt(n).toString(16).padStart(64, '0');
    }

    /** Build calldata for a function call: 4-byte selector + encoded args */
    buildCalldata(selector, ...args) {
        let hex = selector;
        for (const arg of args) {
            hex += this.encodeU256(arg);
        }
        return hex;
    }

    /** Call a view function on the FractalSwap contract */
    async contractCall(selector, ...args) {
        const calldata = this.buildCalldata(selector, ...args);
        const to = '0x' + CROSSCHAIN_PUBKEY.replace('0x', '');
        const result = await this.rpcCall('btc_call', [to, calldata]);
        // Result is nested: { result: "base64...", events: {}, ... }
        const b64 = typeof result === 'string' ? result : (result?.result || '');
        return Buffer.from(b64, 'base64');
    }

    /** Parse a u256 from a buffer at offset */
    parseU256(buf, offset = 0) {
        let hex = '';
        for (let i = 0; i < 32; i++) {
            hex += buf[offset + i].toString(16).padStart(2, '0');
        }
        return BigInt('0x' + hex);
    }

    /** Get next order ID */
    async getNextOrderId() {
        const buf = await this.contractCall(SEL_GET_NEXT_ORDER_ID);
        return Number(this.parseU256(buf, 0));
    }

    /** Get order details */
    async getOrder(orderId) {
        const buf = await this.contractCall(SEL_GET_ORDER, orderId);
        if (buf.length < 320) return null; // 10 * 32 bytes expected

        return {
            direction: Number(this.parseU256(buf, 0)),
            status: Number(this.parseU256(buf, 32)),
            creator: this.parseU256(buf, 64).toString(16).padStart(64, '0'),
            taker: this.parseU256(buf, 96).toString(16).padStart(64, '0'),
            btcAmount: this.parseU256(buf, 128),
            wantAmount: this.parseU256(buf, 160),
            expiry: Number(this.parseU256(buf, 192)),
            makerAddr: this.parseU256(buf, 224).toString(16).padStart(64, '0'),
            takerAddr: this.parseU256(buf, 256).toString(16).padStart(64, '0'),
            feePaid: this.parseU256(buf, 288),
        };
    }

    /** Get current OPNet block number */
    async getBlockNumber() {
        const result = await this.rpcCall('btc_blockNumber', []);
        return Number(result);
    }

    /** Decode Fractal address from u256 hex (first N non-zero bytes as UTF-8) */
    decodeFractalAddr(hex) {
        const bytes = Buffer.from(hex, 'hex');
        let end = bytes.indexOf(0);
        if (end === -1) end = 32;
        return bytes.slice(0, end).toString('utf-8');
    }

    /** Check Fractal Bitcoin for payments to an address above minSats */
    async checkFractalPayment(address, minSats) {
        try {
            const res = await fetch(`${FRACTAL_API}/address/${address}/txs`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return false;
            const txs = await res.json();

            for (const tx of txs) {
                // Sum outputs going to this address
                let received = 0;
                for (const vout of (tx.vout || [])) {
                    if (vout.scriptpubkey_address === address) {
                        received += vout.value || 0;
                    }
                }
                if (received >= Number(minSats)) {
                    console.log(`[Relayer] Found Fractal payment to ${address}: ${received} sats (tx: ${tx.txid?.slice(0, 12)}...)`);
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(`[Relayer] Fractal API error for ${address}:`, e.message);
            return false;
        }
    }

    /** Main poll loop — check all Taken orders */
    async pollOrders() {
        try {
            const nextId = await this.getNextOrderId();
            const currentBlock = await this.getBlockNumber();

            for (let i = 1; i < nextId; i++) {
                if (this.processedOrders.has(i)) continue;

                const order = await this.getOrder(i);
                if (!order || order.status !== STATUS_TAKEN) {
                    if (order && order.status !== STATUS_TAKEN) {
                        this.processedOrders.add(i); // skip non-Taken
                    }
                    continue;
                }

                // Skip expired orders
                if (order.expiry > 0 && currentBlock >= order.expiry) {
                    console.log(`[Relayer] Order #${i} expired, skipping`);
                    this.processedOrders.add(i);
                    continue;
                }

                // Determine which Fractal address should have received payment
                // BTC_TO_FB: taker sends FB to maker's Fractal address (makerAddr)
                // FB_TO_BTC: maker sends FB to taker's Fractal address (takerAddr)
                const targetHex = order.direction === DIR_BTC_TO_FB
                    ? order.makerAddr
                    : order.takerAddr;
                const fractalAddr = this.decodeFractalAddr(targetHex);

                if (!fractalAddr.startsWith('bc1') && !fractalAddr.startsWith('tb1')) {
                    console.log(`[Relayer] Order #${i}: invalid Fractal address "${fractalAddr}", skipping`);
                    continue;
                }

                // Check if FB payment was sent
                const paid = await this.checkFractalPayment(fractalAddr, order.wantAmount);
                if (paid) {
                    console.log(`[Relayer] Order #${i}: Fractal payment detected! Queuing auto-complete...`);
                    // Note: actual relayerComplete transaction requires OPNet SDK signing
                    // For now, log and mark as needing completion
                    // TODO: Integrate OPNet SDK for transaction signing when packages are available on VPS
                    this.processedOrders.add(i);
                    console.log(`[Relayer] Order #${i}: Would call relayerComplete(${i}) — SDK integration pending`);
                }
            }
        } catch (e) {
            console.error('[Relayer] Poll error:', e.message);
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[FractalSwap Relayer] Started — polling every', POLL_INTERVAL_MS / 1000, 'seconds');
        console.log('[FractalSwap Relayer] Contract:', CROSSCHAIN_ADDRESS);

        // Initial poll
        this.pollOrders();

        // Schedule periodic polls
        this.interval = setInterval(() => this.pollOrders(), POLL_INTERVAL_MS);
    }

    stop() {
        this.running = false;
        if (this.interval) clearInterval(this.interval);
        console.log('[FractalSwap Relayer] Stopped');
    }
}

module.exports = { FractalSwapRelayer };
