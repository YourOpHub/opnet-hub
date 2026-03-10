#!/usr/bin/env node
/**
 * OPNet Hub — Real E2E Test v2: Marketplace + CrossChain
 *
 * Two wallets (A, B) executing REAL on-chain operations:
 * - P2PMarket: sell orders, buy orders, fills, accepts, cancels
 * - FractalSwap: BTC_TO_FB, FB_TO_BTC, take, complete, cancel
 * - Balance verification before/after each phase
 *
 * KEY LEARNINGS:
 * - Orders need EPOCH finalization (~5 blocks) before state is readable
 * - Use polling (waitForCondition) instead of single-block waits
 * - Wallet B has limited UTXOs — use lower maxSat (50K)
 * - fillSellOrder fails if order not yet confirmed — must verify ACTIVE first
 *
 * Run: OPNET_MNEMONIC="..." node e2e/real-e2e-test.mjs
 */

import { createHash } from 'crypto';
import { Mnemonic, Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract, TransactionOutputFlags } from 'opnet';

// ─── Config ──────────────────────────────────────────────────────────────────
const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }

const RPC_URL = 'https://testnet.opnet.org';
const RPC_JSONRPC = RPC_URL + '/api/v1/json-rpc';
const POLL_TIMEOUT = 900_000;  // 15 min max wait for state changes
const POLL_INTERVAL = 20_000;  // 20 sec between polls
const TX_DELAY = 2000;         // delay between TXs

const C = {
    MINE:       { addr: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa', pk: 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d' },
    MARKET:     { addr: 'opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt', pk: 'd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595' },
    CROSSCHAIN: { addr: 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu', pk: '526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2' },
};

const DEPLOYER_MLDSA = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';

// ─── ABIs ────────────────────────────────────────────────────────────────────
const FN = 'function', U256 = 'UINT256', ADDR = 'ADDRESS', BOOL = 'BOOL';

const TOKEN_ABI = [
    { name: 'balanceOf', constant: true, inputs: [{ name: 'owner', type: ADDR }], outputs: [{ name: 'balance', type: U256 }], type: FN },
    { name: 'increaseAllowance', inputs: [{ name: 'spender', type: ADDR }, { name: 'amount', type: U256 }], outputs: [], type: FN },
    { name: 'publicMint', inputs: [{ name: 'amount', type: U256 }], outputs: [], type: FN },
];

const MARKET_ABI = [
    { name: 'createSellOrder', inputs: [{ name: 'token', type: ADDR }, { name: 'amount', type: U256 }, { name: 'pricePerToken', type: U256 }], outputs: [{ name: 'orderId', type: U256 }], type: FN },
    { name: 'fillSellOrder', inputs: [{ name: 'orderId', type: U256 }, { name: 'fillAmount', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'createBuyOrder', inputs: [{ name: 'token', type: ADDR }, { name: 'amount', type: U256 }, { name: 'pricePerToken', type: U256 }], outputs: [{ name: 'orderId', type: U256 }], type: FN },
    { name: 'acceptBuyOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'cancelOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'getOrder', constant: true, inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'orderType', type: U256 }, { name: 'status', type: U256 }, { name: 'creator', type: U256 }, { name: 'token', type: U256 }, { name: 'amount', type: U256 }, { name: 'filled', type: U256 }, { name: 'pricePerToken', type: U256 }, { name: 'seller', type: U256 }], type: FN },
    { name: 'getNextOrderId', constant: true, inputs: [], outputs: [{ name: 'nextOrderId', type: U256 }], type: FN },
];

const CROSSCHAIN_ABI = [
    { name: 'createOrder', inputs: [{ name: 'direction', type: U256 }, { name: 'btcAmount', type: U256 }, { name: 'wantAmount', type: U256 }, { name: 'expiry', type: U256 }, { name: 'fractalAddr', type: U256 }], outputs: [{ name: 'orderId', type: U256 }], type: FN },
    { name: 'takeOrder', inputs: [{ name: 'orderId', type: U256 }, { name: 'takerAddr', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'completeOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'cancelOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'getOrder', constant: true, inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'direction', type: U256 }, { name: 'status', type: U256 }, { name: 'creator', type: U256 }, { name: 'taker', type: U256 }, { name: 'btcAmount', type: U256 }, { name: 'wantAmount', type: U256 }, { name: 'expiry', type: U256 }, { name: 'makerAddr', type: U256 }, { name: 'takerAddr', type: U256 }, { name: 'feePaid', type: U256 }], type: FN },
    { name: 'getNextOrderId', constant: true, inputs: [], outputs: [{ name: 'nextOrderId', type: U256 }], type: FN },
    { name: 'getFeeInfo', constant: true, inputs: [], outputs: [{ name: 'feeRecipient', type: U256 }, { name: 'feeBps', type: U256 }], type: FN },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const results = [];
const phaseResults = {};
let currentPhase = '';

function log(msg) { console.log(msg); }

function record(test, ok, detail = '') {
    results.push({ test, ok, detail, phase: currentPhase });
    if (!phaseResults[currentPhase]) phaseResults[currentPhase] = { pass: 0, fail: 0 };
    ok ? phaseResults[currentPhase].pass++ : phaseResults[currentPhase].fail++;
    log(`  ${ok ? '✅' : '❌'} ${test}${detail ? ' — ' + detail : ''}`);
}

function p2op(hashHex) {
    const b = new Uint8Array(34);
    b[0] = 0x60; b[1] = 0x20;
    for (let i = 0; i < 32; i++) b[2 + i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
    return b;
}

function strToU256(s) {
    const buf = Buffer.alloc(32, 0);
    buf.write(s, 0, Math.min(s.length, 32), 'utf-8');
    return BigInt('0x' + buf.toString('hex'));
}

const cAddr = (pk) => Address.fromString(pk);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => (Number(v) / 1e8).toLocaleString('en', { maximumFractionDigits: 2 });
const fmtSat = v => Number(v).toLocaleString('en');

async function rpc(method, params = []) {
    const r = await fetch(RPC_JSONRPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.error) throw new Error(JSON.stringify(d.error));
    return d.result;
}

async function getBlockNumber() {
    return Number(await rpc('btc_blockNumber', []));
}

async function send(sim, wallet, network, extra = [], maxSat = 80_000n) {
    if (sim.revert) throw new Error(`REVERT: ${sim.revert}`);
    log(`     Sim OK, sending TX...`);
    const tx = await sim.sendTransaction({
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        refundTo: wallet.p2tr,
        network, feeRate: 10, priorityFee: 5000n,
        maximumAllowedSatToSpend: maxSat,
        ...(extra.length ? { extraOutputs: extra } : {}),
    });
    log(`     TX: ${tx.transactionId?.slice(0, 20)}... | Peers: ${tx.peerAcknowledgements}`);
    return tx;
}

/**
 * Poll a condition function until it returns truthy, with timeout.
 * Shows block progress while waiting.
 */
async function waitForCondition(label, condFn, timeout = POLL_TIMEOUT) {
    const start = Date.now();
    let lastBlock = await getBlockNumber();
    log(`\n  ⏳ Waiting: ${label} (block ${lastBlock})...`);

    while (Date.now() - start < timeout) {
        await sleep(POLL_INTERVAL);
        const now = await getBlockNumber();
        if (now !== lastBlock) {
            log(`     Block ${lastBlock} → ${now}`);
            lastBlock = now;
        }

        try {
            const result = await condFn();
            if (result) {
                const elapsed = Math.round((Date.now() - start) / 1000);
                log(`     ✓ Condition met after ${elapsed}s (block ${lastBlock})`);
                return { ok: true, block: lastBlock };
            }
        } catch (_) {}

        const elapsed = Math.round((Date.now() - start) / 1000);
        log(`     ... polling (${elapsed}s)`);
    }
    return { ok: false, block: lastBlock };
}

async function getBalance(provider, net, tokenAddr, ownerAddr) {
    const c = getContract(tokenAddr, TOKEN_ABI, provider, net, ownerAddr);
    const r = await c.balanceOf(ownerAddr);
    return r.properties?.balance ?? 0n;
}

async function getMarketOrder(provider, net, senderAddr, orderId) {
    const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, senderAddr);
    const r = await c.getOrder(BigInt(orderId));
    return {
        orderType: r.properties?.orderType,
        status: r.properties?.status,
        creator: r.properties?.creator,
        amount: r.properties?.amount,
        filled: r.properties?.filled,
        pricePerToken: r.properties?.pricePerToken,
    };
}

async function getCCOrder(provider, net, senderAddr, orderId) {
    const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, senderAddr);
    const r = await c.getOrder(BigInt(orderId));
    return {
        direction: r.properties?.direction,
        status: r.properties?.status,
        creator: r.properties?.creator,
        taker: r.properties?.taker,
        btcAmount: r.properties?.btcAmount,
        wantAmount: r.properties?.wantAmount,
        expiry: r.properties?.expiry,
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    log('╔═══════════════════════════════════════════════════════╗');
    log('║  OPNet Hub — Real E2E v2: Marketplace + CrossChain   ║');
    log('║  Two wallets, real TXs, state polling, balance verify║');
    log('╚═══════════════════════════════════════════════════════╝\n');

    const baseNet = networks.opnetTestnet;
    const net = { ...baseNet, bech32: baseNet.bech32Opnet };

    const mkWallet = (idx) => {
        const mn = new Mnemonic(MNEMONIC, '', net);
        const w = mn.deriveOPWallet(undefined, idx);
        const h = createHash('sha256').update(Buffer.from(w.mldsaKeypair.publicKey)).digest().toString('hex');
        const t = Buffer.from(w._tweakedKey || w.keypair.publicKey).toString('hex');
        return { wallet: w, hash: h, addr: Address.fromString(h, t), p2tr: w.p2tr };
    };

    const A = mkWallet(0);
    const B = mkWallet(1);
    const MINE = cAddr(C.MINE.pk);
    const MARKET = cAddr(C.MARKET.pk);
    const provider = new JSONRpcProvider({ url: RPC_URL, network: net });

    log(`  Wallet A: ${A.p2tr}`);
    log(`  Wallet B: ${B.p2tr}`);
    log(`  A hash: ${A.hash.slice(0, 16)}...`);
    log(`  B hash: ${B.hash.slice(0, 16)}...`);

    let block = await getBlockNumber();
    log(`  Block: ${block}\n`);

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 1: Setup — verify balances, mint if needed
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 1: Setup';
    log(`▸ ${currentPhase}\n`);

    const MIN_BALANCE = 500n * 10n ** 8n;

    let balA = await getBalance(provider, net, C.MINE.addr, A.addr);
    let balB = await getBalance(provider, net, C.MINE.addr, B.addr);
    record('Initial balances', true, `A=${fmt(balA)}, B=${fmt(balB)}`);

    // Mint only if needed
    let mintsSent = 0;
    for (const [label, who, addr] of [['A', A, A.addr], ['B', B, B.addr]]) {
        const bal = label === 'A' ? balA : balB;
        if (bal < MIN_BALANCE) {
            try {
                log(`  Mint 1M MINE for ${label}...`);
                const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, addr);
                await send(await c.publicMint(1_000_000n * 10n ** 8n), who.wallet, net);
                record(`Mint MINE (${label})`, true);
                mintsSent++;
            } catch (e) { record(`Mint MINE (${label})`, false, e.message.slice(0, 80)); }
            await sleep(TX_DELAY);
        } else {
            record(`Mint MINE (${label})`, true, `SKIP — ${fmt(bal)} MINE`);
        }
    }

    if (mintsSent > 0) {
        const r = await waitForCondition('mints confirmed', async () => {
            const a = await getBalance(provider, net, C.MINE.addr, A.addr);
            return a !== balA;
        });
        record('Mints confirmed', r.ok);
        balA = await getBalance(provider, net, C.MINE.addr, A.addr);
        balB = await getBalance(provider, net, C.MINE.addr, B.addr);
    }

    record('A has enough MINE', balA >= MIN_BALANCE, fmt(balA));
    record('B has enough MINE', balB >= MIN_BALANCE, fmt(balB));

    if (balA < MIN_BALANCE || balB < MIN_BALANCE) {
        log('\n  ⚠ Insufficient MINE balance — cannot proceed with market tests.');
        log('  Jumping to CrossChain tests...\n');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 2: Sell Order — A creates, B fills
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 2: Sell A→B';
    log(`\n▸ ${currentPhase}\n`);

    const SELL_AMT = 100n * 10n ** 8n;
    const SELL_PRICE = 50n;
    const SELL_BTC = 100n * SELL_PRICE; // 5000 sats
    let sellOrderId = -1n;

    // A: increaseAllowance + createSellOrder in same mempool batch
    try {
        log('  [A] increaseAllowance MINE→Market...');
        const ct = getContract(C.MINE.addr, TOKEN_ABI, provider, net, A.addr);
        await send(await ct.increaseAllowance(MARKET, SELL_AMT), A.wallet, net);
        record('A: allowance→Market', true);
    } catch (e) { record('A: allowance→Market', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Read nextOrderId to know what ID to expect
    let nextIdBefore = 0n;
    try {
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        nextIdBefore = (await c.getNextOrderId()).properties?.nextOrderId ?? 0n;
        log(`  nextOrderId before: ${nextIdBefore}`);
    } catch (_) {}

    try {
        log(`  [A] createSellOrder: ${fmt(SELL_AMT)} MINE @ ${SELL_PRICE} sat...`);
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const sim = await c.createSellOrder(MINE, SELL_AMT, SELL_PRICE);
        sellOrderId = sim.properties?.orderId ?? nextIdBefore;
        await send(sim, A.wallet, net);
        record('A: createSellOrder', true, `orderId=${sellOrderId}`);
    } catch (e) { record('A: createSellOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait until order is ACTIVE (status=1)
    if (sellOrderId >= 0n) {
        const r = await waitForCondition(`order #${sellOrderId} ACTIVE`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, sellOrderId);
            return o.status === 1n;
        });
        record('Sell order confirmed ACTIVE', r.ok, `block=${r.block}`);
        block = r.block;

        if (r.ok) {
            const order = await getMarketOrder(provider, net, A.addr, sellOrderId);
            record('Sell order amount', order.amount === SELL_AMT, fmt(order.amount));
            record('Sell order price', order.pricePerToken === SELL_PRICE, `${order.pricePerToken}`);
        }
    }

    // Record balances before fill
    balA = await getBalance(provider, net, C.MINE.addr, A.addr);
    balB = await getBalance(provider, net, C.MINE.addr, B.addr);
    const balA_preFill = balA, balB_preFill = balB;

    // B: fillSellOrder
    if (sellOrderId >= 0n) {
        try {
            log(`  [B] fillSellOrder #${sellOrderId}: pay ${fmtSat(SELL_BTC)} sats to A...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
            const sellerP2OP = p2op(A.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: SELL_BTC,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: sellerP2OP,
                    to: A.p2tr,
                }],
            });

            const sim = await c.fillSellOrder(sellOrderId, SELL_AMT);
            await send(sim, B.wallet, net, [{ script: sellerP2OP, value: SELL_BTC }], 50_000n);
            record('B: fillSellOrder', true, `paid ${fmtSat(SELL_BTC)} sats`);
        } catch (e) { record('B: fillSellOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        // Wait for FILLED (status=2)
        const r = await waitForCondition(`order #${sellOrderId} FILLED`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, sellOrderId);
            return o.status === 2n;
        });
        record('Sell order FILLED', r.ok, `block=${r.block}`);
        block = r.block;

        // Verify balances
        if (r.ok) {
            balA = await getBalance(provider, net, C.MINE.addr, A.addr);
            balB = await getBalance(provider, net, C.MINE.addr, B.addr);
            const diffA = balA - balA_preFill;
            const diffB = balB - balB_preFill;
            record('A lost MINE (seller)', diffA < 0n, `diff=${fmt(diffA)}`);
            record('B gained MINE (buyer)', diffB > 0n, `diff=${fmt(diffB)}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 3: Sell Order — B creates, A fills (reverse)
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 3: Sell B→A';
    log(`\n▸ ${currentPhase}\n`);

    const SELL2_AMT = 50n * 10n ** 8n;
    const SELL2_PRICE = 30n;
    const SELL2_BTC = 50n * SELL2_PRICE; // 1500 sats
    let sellOrderId2 = -1n;

    try {
        log('  [B] increaseAllowance MINE→Market...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, B.addr);
        await send(await c.increaseAllowance(MARKET, SELL2_AMT), B.wallet, net, [], 50_000n);
        record('B: allowance→Market', true);
    } catch (e) { record('B: allowance→Market', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    try {
        log(`  [B] createSellOrder: ${fmt(SELL2_AMT)} MINE @ ${SELL2_PRICE} sat...`);
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
        const sim = await c.createSellOrder(MINE, SELL2_AMT, SELL2_PRICE);
        sellOrderId2 = sim.properties?.orderId ?? -1n;
        await send(sim, B.wallet, net, [], 50_000n);
        record('B: createSellOrder', true, `orderId=${sellOrderId2}`);
    } catch (e) { record('B: createSellOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    if (sellOrderId2 >= 0n) {
        const r = await waitForCondition(`order #${sellOrderId2} ACTIVE`, async () => {
            const o = await getMarketOrder(provider, net, B.addr, sellOrderId2);
            return o.status === 1n;
        });
        record('B sell order ACTIVE', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // A fills B's sell order
    const balA_pre3 = await getBalance(provider, net, C.MINE.addr, A.addr);
    const balB_pre3 = await getBalance(provider, net, C.MINE.addr, B.addr);

    if (sellOrderId2 >= 0n) {
        try {
            log(`  [A] fillSellOrder #${sellOrderId2}: pay ${fmtSat(SELL2_BTC)} sats to B...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
            const sellerP2OP = p2op(B.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: SELL2_BTC,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: sellerP2OP,
                    to: B.p2tr,
                }],
            });

            const sim = await c.fillSellOrder(sellOrderId2, SELL2_AMT);
            await send(sim, A.wallet, net, [{ script: sellerP2OP, value: SELL2_BTC }], 60_000n);
            record('A: fillSellOrder (B order)', true);
        } catch (e) { record('A: fillSellOrder (B order)', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        const r = await waitForCondition(`order #${sellOrderId2} FILLED`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, sellOrderId2);
            return o.status === 2n;
        });
        record('B sell order FILLED', r.ok, `block=${r.block}`);
        block = r.block;

        if (r.ok) {
            const balA_post = await getBalance(provider, net, C.MINE.addr, A.addr);
            const balB_post = await getBalance(provider, net, C.MINE.addr, B.addr);
            record('A gained MINE (buyer)', balA_post > balA_pre3, `${fmt(balA_pre3)} → ${fmt(balA_post)}`);
            record('B lost MINE (seller)', balB_post < balB_pre3, `${fmt(balB_pre3)} → ${fmt(balB_post)}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 4: Buy Order — A creates (locks BTC), B accepts (sends MINE)
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 4: Buy A←B';
    log(`\n▸ ${currentPhase}\n`);

    const BUY_AMT = 100n * 10n ** 8n;
    const BUY_PRICE = 30n;
    const BUY_BTC = 100n * BUY_PRICE; // 3000 sats
    let buyOrderId = -1n;

    try {
        log(`  [A] createBuyOrder: ${fmt(BUY_AMT)} MINE @ ${BUY_PRICE} sat (lock ${fmtSat(BUY_BTC)} sats)...`);
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const mktP2OP = p2op(C.MARKET.pk);

        c.setTransactionDetails({
            inputs: [],
            outputs: [{
                value: BUY_BTC,
                index: 1,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: mktP2OP,
                to: A.p2tr,
            }],
        });

        const sim = await c.createBuyOrder(MINE, BUY_AMT, BUY_PRICE);
        buyOrderId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: mktP2OP, value: BUY_BTC }], BUY_BTC + 60_000n);
        record('A: createBuyOrder', true, `orderId=${buyOrderId}, locked ${fmtSat(BUY_BTC)} sats`);
    } catch (e) { record('A: createBuyOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    if (buyOrderId >= 0n) {
        const r = await waitForCondition(`buy order #${buyOrderId} ACTIVE`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, buyOrderId);
            return o.status === 1n;
        });
        record('Buy order ACTIVE', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // B: allowance + acceptBuyOrder
    const balA_pre4 = await getBalance(provider, net, C.MINE.addr, A.addr);
    const balB_pre4 = await getBalance(provider, net, C.MINE.addr, B.addr);

    if (buyOrderId >= 0n) {
        try {
            log('  [B] increaseAllowance MINE→Market...');
            const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, B.addr);
            await send(await c.increaseAllowance(MARKET, BUY_AMT), B.wallet, net, [], 50_000n);
            record('B: allowance for buy', true);
        } catch (e) { record('B: allowance for buy', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        try {
            log(`  [B] acceptBuyOrder #${buyOrderId}...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
            const sim = await c.acceptBuyOrder(buyOrderId);
            await send(sim, B.wallet, net, [], 50_000n);
            record('B: acceptBuyOrder', true);
        } catch (e) { record('B: acceptBuyOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        const r = await waitForCondition(`buy order #${buyOrderId} FILLED`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, buyOrderId);
            return o.status === 2n;
        });
        record('Buy order FILLED', r.ok, `block=${r.block}`);
        block = r.block;

        if (r.ok) {
            const balA_post = await getBalance(provider, net, C.MINE.addr, A.addr);
            const balB_post = await getBalance(provider, net, C.MINE.addr, B.addr);
            record('A gained MINE (buyer)', balA_post > balA_pre4, `${fmt(balA_pre4)} → ${fmt(balA_post)}`);
            record('B lost MINE (acceptor)', balB_post < balB_pre4, `${fmt(balB_pre4)} → ${fmt(balB_post)}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 5: Cancel Order
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 5: Cancel';
    log(`\n▸ ${currentPhase}\n`);

    let cancelId = -1n;

    try {
        log('  [A] increaseAllowance for cancel test...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, A.addr);
        await send(await c.increaseAllowance(MARKET, 10n * 10n ** 8n), A.wallet, net);
        record('A: allowance (cancel)', true);
    } catch (e) { record('A: allowance (cancel)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    try {
        log('  [A] createSellOrder: 10 MINE @ 100 sat (to cancel)...');
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const sim = await c.createSellOrder(MINE, 10n * 10n ** 8n, 100n);
        cancelId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net);
        record('A: createSellOrder (cancel target)', true, `orderId=${cancelId}`);
    } catch (e) { record('A: createSellOrder (cancel target)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    if (cancelId >= 0n) {
        const r = await waitForCondition(`cancel target #${cancelId} ACTIVE`, async () => {
            const o = await getMarketOrder(provider, net, A.addr, cancelId);
            return o.status === 1n;
        });
        record('Cancel target ACTIVE', r.ok, `block=${r.block}`);
        block = r.block;

        if (r.ok) {
            try {
                log(`  [A] cancelOrder #${cancelId}...`);
                const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
                await send(await c.cancelOrder(cancelId), A.wallet, net);
                record('A: cancelOrder TX sent', true);
            } catch (e) { record('A: cancelOrder', false, e.message.slice(0, 80)); }
            await sleep(TX_DELAY);

            const r2 = await waitForCondition(`order #${cancelId} CANCELLED`, async () => {
                const o = await getMarketOrder(provider, net, A.addr, cancelId);
                return o.status === 3n;
            });
            record('Order CANCELLED', r2.ok, `block=${r2.block}`);
            block = r2.block;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 6: CrossChain BTC_TO_FB — A creates, B takes, B completes
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 6: CC BTC→FB';
    log(`\n▸ ${currentPhase}\n`);

    const CC_BTC = 5000n;
    let expiry = BigInt(block) + 200n;
    let ccId1 = -1n;

    // Read fee info
    let feeBps = 100n;
    try {
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        feeBps = (await c.getFeeInfo()).properties?.feeBps ?? 100n;
        log(`  Fee: ${feeBps} bps`);
    } catch (_) {}

    // A: createOrder BTC_TO_FB
    try {
        log(`  [A] createOrder BTC→FB: ${fmtSat(CC_BTC)} sats, expiry=${expiry}...`);
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        const ccP2OP = p2op(C.CROSSCHAIN.pk);

        c.setTransactionDetails({
            inputs: [],
            outputs: [{
                value: CC_BTC,
                index: 1,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: ccP2OP,
                to: A.p2tr,
            }],
        });

        const sim = await c.createOrder(1n, CC_BTC, CC_BTC, expiry, strToU256('tb1q_fractalA'));
        ccId1 = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: ccP2OP, value: CC_BTC }], CC_BTC + 60_000n);
        record('A: CC create BTC→FB', true, `orderId=${ccId1}`);
    } catch (e) { record('A: CC create BTC→FB', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait for Open
    if (ccId1 >= 0n) {
        const r = await waitForCondition(`CC #${ccId1} Open`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccId1);
            return o.status === 1n;
        });
        record('CC order Open', r.ok, `dir=${1}, block=${r.block}`);
        block = r.block;
    }

    // B: takeOrder + fee
    if (ccId1 >= 0n) {
        const feeSats = (() => {
            const calc = CC_BTC * feeBps / 10000n;
            return calc < 330n ? 330n : calc;
        })();

        try {
            log(`  [B] takeOrder #${ccId1}: fee=${fmtSat(feeSats)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, B.addr);
            const feeP2OP = p2op(DEPLOYER_MLDSA);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: feeSats,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: feeP2OP,
                    to: B.p2tr,
                }],
            });

            const sim = await c.takeOrder(ccId1, strToU256('tb1q_fractalB'));
            await send(sim, B.wallet, net, [{ script: feeP2OP, value: feeSats }], 50_000n);
            record('B: CC takeOrder', true, `fee=${fmtSat(feeSats)} sats`);
        } catch (e) { record('B: CC takeOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        // Wait for Taken
        const r = await waitForCondition(`CC #${ccId1} Taken`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccId1);
            return o.status === 2n;
        });
        record('CC order Taken', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // B: completeOrder + claim BTC
    if (ccId1 >= 0n) {
        try {
            log(`  [B] completeOrder #${ccId1}: claim ${fmtSat(CC_BTC)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, B.addr);
            const claimP2OP = p2op(B.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: CC_BTC,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: claimP2OP,
                    to: B.p2tr,
                }],
            });

            const sim = await c.completeOrder(ccId1);
            await send(sim, B.wallet, net, [{ script: claimP2OP, value: CC_BTC }], 50_000n);
            record('B: CC completeOrder', true, `claimed ${fmtSat(CC_BTC)}`);
        } catch (e) { record('B: CC completeOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        const r = await waitForCondition(`CC #${ccId1} Completed`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccId1);
            return o.status === 3n;
        });
        record('CC BTC→FB COMPLETED', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 7: CrossChain FB_TO_BTC — B creates, A takes+completes
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 7: CC FB→BTC';
    log(`\n▸ ${currentPhase}\n`);

    const CC2_BTC = 3000n;
    let ccId2 = -1n;
    expiry = BigInt(block) + 200n;

    // B: createOrder FB_TO_BTC (no BTC lock)
    try {
        log(`  [B] createOrder FB→BTC: ${fmtSat(CC2_BTC)} sats, expiry=${expiry}...`);
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, B.addr);
        const sim = await c.createOrder(2n, CC2_BTC, CC2_BTC, expiry, strToU256('tb1q_fracB2'));
        ccId2 = sim.properties?.orderId ?? -1n;
        await send(sim, B.wallet, net, [], 50_000n);
        record('B: CC create FB→BTC', true, `orderId=${ccId2}`);
    } catch (e) { record('B: CC create FB→BTC', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    if (ccId2 >= 0n) {
        const r = await waitForCondition(`CC #${ccId2} Open`, async () => {
            const o = await getCCOrder(provider, net, B.addr, ccId2);
            return o.status === 1n;
        });
        record('CC2 order Open', r.ok, `dir=2, block=${r.block}`);
        block = r.block;
    }

    // A: takeOrder + fee + BTC lock
    if (ccId2 >= 0n) {
        const feeSats = (() => {
            const calc = CC2_BTC * feeBps / 10000n;
            return calc < 330n ? 330n : calc;
        })();

        try {
            log(`  [A] takeOrder #${ccId2}: fee=${fmtSat(feeSats)}, lock ${fmtSat(CC2_BTC)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
            const feeP2OP = p2op(DEPLOYER_MLDSA);
            const lockP2OP = p2op(C.CROSSCHAIN.pk);

            c.setTransactionDetails({
                inputs: [],
                outputs: [
                    { value: feeSats, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeP2OP, to: A.p2tr },
                    { value: CC2_BTC, index: 2, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: lockP2OP, to: A.p2tr },
                ],
            });

            const sim = await c.takeOrder(ccId2, strToU256('tb1q_fracA2'));
            await send(sim, A.wallet, net, [
                { script: feeP2OP, value: feeSats },
                { script: lockP2OP, value: CC2_BTC },
            ], feeSats + CC2_BTC + 60_000n);
            record('A: CC take FB→BTC', true, `fee+lock=${fmtSat(feeSats + CC2_BTC)}`);
        } catch (e) { record('A: CC take FB→BTC', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        const r = await waitForCondition(`CC #${ccId2} Taken`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccId2);
            return o.status === 2n;
        });
        record('CC2 order Taken', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // A: completeOrder + claim BTC
    if (ccId2 >= 0n) {
        try {
            log(`  [A] completeOrder #${ccId2}: claim ${fmtSat(CC2_BTC)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
            const claimP2OP = p2op(A.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: CC2_BTC,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: claimP2OP,
                    to: A.p2tr,
                }],
            });

            const sim = await c.completeOrder(ccId2);
            await send(sim, A.wallet, net, [{ script: claimP2OP, value: CC2_BTC }], CC2_BTC + 60_000n);
            record('A: CC complete FB→BTC', true, `claimed ${fmtSat(CC2_BTC)}`);
        } catch (e) { record('A: CC complete FB→BTC', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        const r = await waitForCondition(`CC #${ccId2} Completed`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccId2);
            return o.status === 3n;
        });
        record('CC FB→BTC COMPLETED', r.ok, `block=${r.block}`);
        block = r.block;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 8: CrossChain Cancel
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 8: CC Cancel';
    log(`\n▸ ${currentPhase}\n`);

    let ccCancelId = -1n;

    try {
        log('  [A] createOrder BTC→FB (to cancel): 2000 sats...');
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        const ccP2OP = p2op(C.CROSSCHAIN.pk);
        const cancelExpiry = BigInt(block) + 200n;

        c.setTransactionDetails({
            inputs: [],
            outputs: [{
                value: 2000n,
                index: 1,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: ccP2OP,
                to: A.p2tr,
            }],
        });

        const sim = await c.createOrder(1n, 2000n, 2000n, cancelExpiry, strToU256('tb1q_cancel'));
        ccCancelId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: ccP2OP, value: 2000n }], 62_000n);
        record('A: CC create (to cancel)', true, `orderId=${ccCancelId}`);
    } catch (e) { record('A: CC create (to cancel)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    if (ccCancelId >= 0n) {
        const r = await waitForCondition(`CC #${ccCancelId} Open`, async () => {
            const o = await getCCOrder(provider, net, A.addr, ccCancelId);
            return o.status === 1n;
        });
        record('CC cancel target Open', r.ok, `block=${r.block}`);
        block = r.block;

        if (r.ok) {
            try {
                log(`  [A] cancelOrder #${ccCancelId}...`);
                const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
                const refundP2OP = p2op(A.hash);

                c.setTransactionDetails({
                    inputs: [],
                    outputs: [{
                        value: 2000n,
                        index: 1,
                        flags: TransactionOutputFlags.hasScriptPubKey,
                        scriptPubKey: refundP2OP,
                        to: A.p2tr,
                    }],
                });

                const sim = await c.cancelOrder(ccCancelId);
                await send(sim, A.wallet, net, [{ script: refundP2OP, value: 2000n }], 62_000n);
                record('A: CC cancelOrder', true, 'refund 2000 sats');
            } catch (e) { record('A: CC cancelOrder', false, e.message.slice(0, 80)); }
            await sleep(TX_DELAY);

            const r2 = await waitForCondition(`CC #${ccCancelId} Cancelled`, async () => {
                const o = await getCCOrder(provider, net, A.addr, ccCancelId);
                return o.status === 4n;
            });
            record('CC order CANCELLED', r2.ok, `block=${r2.block}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Final
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Final';
    log('\n▸ Final Balances\n');

    try {
        const a = await getBalance(provider, net, C.MINE.addr, A.addr);
        const b = await getBalance(provider, net, C.MINE.addr, B.addr);
        record('Final MINE(A)', true, fmt(a));
        record('Final MINE(B)', true, fmt(b));
    } catch (e) { record('Final balances', false, e.message.slice(0, 80)); }

    // ── Summary ──
    log('\n╔═══════════════════════════════════════════════════════╗');
    log('║                    TEST RESULTS                       ║');
    log('╚═══════════════════════════════════════════════════════╝\n');

    const totalPass = results.filter(r => r.ok).length;
    const totalFail = results.filter(r => !r.ok).length;

    for (const [phase, c] of Object.entries(phaseResults)) {
        const icon = c.fail === 0 ? '✅' : '❌';
        log(`  ${icon} ${phase}: ${c.pass}/${c.pass + c.fail} passed`);
    }

    log(`\n  Total: ${totalPass}/${results.length} passed, ${totalFail} failed`);
    log(`  Rate:  ${(totalPass / results.length * 100).toFixed(0)}%`);

    if (totalFail > 0) {
        log('\n  Failed:');
        for (const r of results) if (!r.ok) log(`    ❌ [${r.phase}] ${r.test}: ${r.detail}`);
    }

    log('\n  Tested: createSellOrder, fillSellOrder, createBuyOrder, acceptBuyOrder, cancelOrder');
    log('          CC: create(BTC→FB), create(FB→BTC), takeOrder, completeOrder, cancelOrder');
    log('          Tokens: publicMint, balanceOf, increaseAllowance');
    log('          Full cycles with balance verification + 2 wallets\n');

    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
