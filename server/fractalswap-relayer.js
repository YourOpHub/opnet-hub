/**
 * FractalSwap v7 Auto-Complete Relayer
 *
 * Monitors "Taken" FractalSwap orders on OPNet and checks if the corresponding
 * Fractal BTC payment has been sent. If detected, calls relayerComplete() to
 * release the locked BTC to the correct party.
 *
 * Requires: OPNET_MNEMONIC env var for signing transactions
 */
const { createHash } = require('crypto');

const OPNET_RPC = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org/api/v1/json-rpc';
const OPNET_BASE = process.env.OPNET_RPC_URL
    ? process.env.OPNET_RPC_URL.replace('/api/v1/json-rpc', '')
    : 'https://testnet.opnet.org';
const FRACTAL_API = 'https://mempool-testnet.fractalbitcoin.io/api';
const POLL_INTERVAL_MS = 30_000;

const CROSSCHAIN_ADDRESS = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
const CROSSCHAIN_PUBKEY = '0x526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';

const SEL_GET_NEXT_ORDER_ID = 'f4920cae';
const SEL_GET_ORDER = 'e9489555';

const STATUS_TAKEN = 2;
const DIR_BTC_TO_FB = 1;
const DIR_FB_TO_BTC = 2;

// ABI for SDK contract interaction
const RELAYER_ABI = [
    {
        name: 'relayerComplete',
        type: 2, // BitcoinAbiTypes.Function
        inputs: [{ name: 'orderId', type: 0 }], // ABIDataTypes.UINT256
        outputs: [{ name: 'success', type: 1 }], // ABIDataTypes.BOOL
    },
    {
        name: 'getOrder',
        type: 2,
        inputs: [{ name: 'orderId', type: 0 }],
        outputs: [
            { name: 'direction', type: 0 },
            { name: 'status', type: 0 },
            { name: 'creator', type: 0 },
            { name: 'taker', type: 0 },
            { name: 'btcAmount', type: 0 },
            { name: 'wantAmount', type: 0 },
            { name: 'expiry', type: 0 },
            { name: 'makerAddr', type: 0 },
            { name: 'takerAddr', type: 0 },
            { name: 'feePaid', type: 0 },
        ],
    },
    {
        name: 'getNextOrderId',
        type: 2,
        inputs: [],
        outputs: [{ name: 'nextOrderId', type: 0 }],
    },
];

/** Build P2OP script: [0x60, 0x20, <32-byte MLDSA hash>] */
function buildP2OPScript(mldsaHashHex) {
    const bytes = new Uint8Array(34);
    bytes[0] = 0x60;
    bytes[1] = 0x20;
    for (let i = 0; i < 32; i++) {
        bytes[2 + i] = parseInt(mldsaHashHex.slice(i * 2, i * 2 + 2), 16);
    }
    return Buffer.from(bytes);
}

class FractalSwapRelayer {
    constructor() {
        this.processedOrders = new Set();
        this.running = false;
        this.sdkReady = false;
        this.wallet = null;
        this.completingOrder = false; // lock to prevent concurrent completions
    }

    /** Initialize OPNet SDK for transaction signing */
    async initSDK() {
        const mnemonic = process.env.OPNET_MNEMONIC;
        if (!mnemonic) {
            console.log('[Relayer] No OPNET_MNEMONIC — running in monitor-only mode');
            return;
        }

        try {
            // Dynamic import for ESM packages
            const txMod = await import('@btc-vision/transaction');
            const btcMod = await import('@btc-vision/bitcoin');

            // CJS require for opnet (works in both modes)
            const opnet = require('opnet');

            this.network = { ...btcMod.networks.testnet, bech32: btcMod.networks.testnet.bech32Opnet };
            const mnemonicObj = new txMod.Mnemonic(mnemonic, '', this.network);
            this.wallet = mnemonicObj.deriveOPWallet(undefined, 0);

            // Provider for SDK contract calls
            this.sdkProvider = new opnet.JSONRpcProvider(OPNET_BASE, this.network);
            this.getContract = opnet.getContract;
            this.TransactionOutputFlags = opnet.TransactionOutputFlags;

            // Build sender address (SHA256 of full MLDSA pubkey)
            const mldsaHash = createHash('sha256')
                .update(Buffer.from(this.wallet.mldsaKeypair.publicKey))
                .digest().toString('hex');
            const tweaked = this.wallet._tweakedKey || this.wallet.keypair.publicKey;
            this.senderAddr = txMod.Address.fromString(mldsaHash, Buffer.from(tweaked).toString('hex'));

            this.sdkReady = true;
            console.log('[Relayer] SDK initialized — wallet:', this.wallet.p2tr);
            console.log('[Relayer] Sender:', this.senderAddr.toString());
        } catch (e) {
            console.error('[Relayer] SDK init failed:', e.message);
            console.error('[Relayer] Install SDK: npm install opnet @btc-vision/transaction @btc-vision/bitcoin');
        }
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

    encodeU256(n) {
        return BigInt(n).toString(16).padStart(64, '0');
    }

    buildCalldata(selector, ...args) {
        let hex = selector;
        for (const arg of args) hex += this.encodeU256(arg);
        return hex;
    }

    async contractCall(selector, ...args) {
        const calldata = this.buildCalldata(selector, ...args);
        const to = '0x' + CROSSCHAIN_PUBKEY.replace('0x', '');
        const result = await this.rpcCall('btc_call', [to, calldata]);
        const b64 = typeof result === 'string' ? result : (result?.result || '');
        return Buffer.from(b64, 'base64');
    }

    parseU256(buf, offset = 0) {
        let hex = '';
        for (let i = 0; i < 32; i++) hex += buf[offset + i].toString(16).padStart(2, '0');
        return BigInt('0x' + hex);
    }

    async getNextOrderId() {
        const buf = await this.contractCall(SEL_GET_NEXT_ORDER_ID);
        return Number(this.parseU256(buf, 0));
    }

    async getOrder(orderId) {
        const buf = await this.contractCall(SEL_GET_ORDER, orderId);
        if (buf.length < 320) return null;
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

    async getBlockNumber() {
        const result = await this.rpcCall('btc_blockNumber', []);
        return Number(result);
    }

    decodeFractalAddr(hex) {
        const bytes = Buffer.from(hex, 'hex');
        let end = bytes.indexOf(0);
        if (end === -1) end = 32;
        return bytes.slice(0, end).toString('utf-8');
    }

    async checkFractalPayment(address, minSats) {
        try {
            const res = await fetch(`${FRACTAL_API}/address/${address}/txs`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return false;
            const txs = await res.json();

            for (const tx of txs) {
                let received = 0;
                for (const vout of (tx.vout || [])) {
                    if (vout.scriptpubkey_address === address) {
                        received += vout.value || 0;
                    }
                }
                if (received >= Number(minSats)) {
                    console.log(`[Relayer] Fractal payment found: ${received} sats to ${address} (tx: ${tx.txid?.slice(0, 12)}...)`);
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error(`[Relayer] Fractal API error for ${address}:`, e.message);
            return false;
        }
    }

    /**
     * Call relayerComplete() on-chain via OPNet SDK.
     * Routes escrowed BTC to the correct recipient based on direction:
     *   BTC_TO_FB → taker gets BTC (they sent FB)
     *   FB_TO_BTC → creator gets BTC (they sent FB)
     */
    async completeOrderOnChain(orderId, order) {
        if (!this.sdkReady) {
            console.log(`[Relayer] Order #${orderId}: SDK not ready, skipping on-chain call`);
            return false;
        }
        if (this.completingOrder) {
            console.log(`[Relayer] Order #${orderId}: another completion in progress, will retry next poll`);
            return false;
        }

        this.completingOrder = true;
        try {
            // Determine BTC recipient based on direction
            // BTC_TO_FB: taker sent FB → BTC goes to taker
            // FB_TO_BTC: maker sent FB → BTC goes to creator
            const recipientHex = order.direction === DIR_BTC_TO_FB
                ? order.taker   // taker's on-chain address (MLDSA hash)
                : order.creator; // creator's on-chain address (MLDSA hash)

            const recipientScript = buildP2OPScript(recipientHex);
            const btcAmount = order.btcAmount;

            console.log(`[Relayer] Order #${orderId}: completing on-chain`);
            console.log(`[Relayer]   Direction: ${order.direction === DIR_BTC_TO_FB ? 'BTC→FB' : 'FB→BTC'}`);
            console.log(`[Relayer]   BTC amount: ${btcAmount} sats → recipient ${recipientHex.slice(0, 16)}...`);

            // Get contract with sender address
            const contract = this.getContract(
                CROSSCHAIN_ADDRESS, RELAYER_ABI,
                this.sdkProvider, this.network, this.senderAddr
            );

            // Set transaction details for simulation (BTC output to recipient)
            contract.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: btcAmount,
                    index: 1,
                    flags: this.TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: recipientScript,
                    to: this.wallet.p2tr, // placeholder, scriptPubKey match is primary
                }],
            });

            // Simulate
            console.log(`[Relayer] Order #${orderId}: simulating relayerComplete...`);
            const sim = await contract.relayerComplete(BigInt(orderId));
            if (sim.revert) {
                console.error(`[Relayer] Order #${orderId}: SIMULATION REVERT: ${sim.revert}`);
                return false;
            }
            console.log(`[Relayer] Order #${orderId}: simulation OK`);

            // Send transaction
            console.log(`[Relayer] Order #${orderId}: sending TX...`);
            const result = await sim.sendTransaction({
                signer: this.wallet.keypair,
                mldsaSigner: this.wallet.mldsaKeypair,
                refundTo: this.wallet.p2tr,
                network: this.network,
                feeRate: 10,
                priorityFee: BigInt(5000),
                maximumAllowedSatToSpend: btcAmount + 100_000n,
                extraOutputs: [{ script: recipientScript, value: Number(btcAmount) }],
            });

            console.log(`[Relayer] Order #${orderId}: TX SENT!`);
            console.log(`[Relayer]   txId: ${result.transactionId}`);
            console.log(`[Relayer]   peers: ${result.peerAcknowledgements}`);
            return true;
        } catch (e) {
            console.error(`[Relayer] Order #${orderId}: TX FAILED: ${e.message}`);
            return false;
        } finally {
            this.completingOrder = false;
        }
    }

    async pollOrders() {
        try {
            const nextId = await this.getNextOrderId();
            const currentBlock = await this.getBlockNumber();

            for (let i = 1; i < nextId; i++) {
                if (this.processedOrders.has(i)) continue;

                const order = await this.getOrder(i);
                if (!order || order.status !== STATUS_TAKEN) {
                    if (order && order.status !== STATUS_TAKEN) {
                        this.processedOrders.add(i);
                    }
                    continue;
                }

                if (order.expiry > 0 && currentBlock >= order.expiry) {
                    console.log(`[Relayer] Order #${i} expired, skipping`);
                    this.processedOrders.add(i);
                    continue;
                }

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

                const paid = await this.checkFractalPayment(fractalAddr, order.wantAmount);
                if (paid) {
                    console.log(`[Relayer] Order #${i}: Fractal payment detected! Auto-completing...`);

                    const success = await this.completeOrderOnChain(i, order);
                    if (success) {
                        this.processedOrders.add(i);
                        console.log(`[Relayer] Order #${i}: COMPLETED on-chain!`);
                    } else {
                        console.log(`[Relayer] Order #${i}: completion failed, will retry next poll`);
                    }
                }
            }
        } catch (e) {
            console.error('[Relayer] Poll error:', e.message);
        }
    }

    async start() {
        if (this.running) return;
        this.running = true;
        console.log('[FractalSwap Relayer] Started — polling every', POLL_INTERVAL_MS / 1000, 'seconds');
        console.log('[FractalSwap Relayer] Contract:', CROSSCHAIN_ADDRESS);

        // Initialize SDK (async, non-blocking)
        await this.initSDK();

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
