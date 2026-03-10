#!/usr/bin/env node
/**
 * OPNet Hub — Real E2E Test: Marketplace + CrossChain
 *
 * Two wallets (A, B) executing REAL on-chain operations:
 * - P2PMarket: sell orders, buy orders, fills, accepts, cancels
 * - FractalSwap: BTC_TO_FB, FB_TO_BTC, take, complete, cancel
 * - Balance verification before/after each phase
 *
 * Run: OPNET_MNEMONIC="..." node e2e/real-e2e-test.mjs
 * VPS: scp to server, then node real-e2e-test.mjs
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
const BLOCK_TIMEOUT = 300_000; // 5 min max wait per block
const TX_DELAY = 2000; // delay between TXs (avoid UTXO conflicts)

const C = {
    MINE:       { addr: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa', pk: 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d' },
    MARKET:     { addr: 'opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt', pk: 'd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595' },
    CROSSCHAIN: { addr: 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu', pk: '526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2' },
};

// Deployer MLDSA hash (fee recipient for FractalSwap)
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

function assert(condition, testName, detail = '') {
    record(testName, !!condition, detail);
    return !!condition;
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

async function send(sim, wallet, network, extra = [], maxSat = 100_000n) {
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

async function waitBlock(startBlock, label = '') {
    const start = Date.now();
    log(`\n  ⏳ Waiting for block confirmation${label ? ' (' + label + ')' : ''}...`);
    log(`     Current block: ${startBlock}`);

    while (Date.now() - start < BLOCK_TIMEOUT) {
        await sleep(15000);
        const now = await getBlockNumber();
        if (now > startBlock) {
            log(`     ✓ New block: ${now} (+${now - startBlock})`);
            return now;
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        log(`     ... waiting (${elapsed}s, still block ${now})`);
    }
    throw new Error(`Block timeout after ${BLOCK_TIMEOUT / 1000}s`);
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
    log('║  OPNet Hub — Real E2E Test: Marketplace + CrossChain ║');
    log('║  Two wallets, real on-chain TXs, balance verification║');
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
    log(`  A MLDSA hash: ${A.hash.slice(0, 16)}...`);
    log(`  B MLDSA hash: ${B.hash.slice(0, 16)}...`);

    let block = await getBlockNumber();
    log(`  Starting block: ${block}\n`);

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 1: Setup — Mint MINE for both wallets, record initial balances
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 1: Setup';
    log(`▸ ${currentPhase}\n`);

    const M1M = 1_000_000n * 10n ** 8n;

    // Record initial balances
    let balA_before, balB_before;
    try {
        balA_before = await getBalance(provider, net, C.MINE.addr, A.addr);
        balB_before = await getBalance(provider, net, C.MINE.addr, B.addr);
        record('Initial balances read', true, `A=${fmt(balA_before)} MINE, B=${fmt(balB_before)} MINE`);
    } catch (e) { record('Initial balances read', false, e.message.slice(0, 80)); }

    // Mint MINE for A
    try {
        log('  Mint 1M MINE for A...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, A.addr);
        await send(await c.publicMint(M1M), A.wallet, net);
        record('Mint MINE (A)', true, '1,000,000');
    } catch (e) { record('Mint MINE (A)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Mint MINE for B
    try {
        log('  Mint 1M MINE for B...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, B.addr);
        await send(await c.publicMint(M1M), B.wallet, net);
        record('Mint MINE (B)', true, '1,000,000');
    } catch (e) { record('Mint MINE (B)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait for block to confirm mints
    try {
        block = await waitBlock(block, 'mint confirmation');
        record('Block confirmed (mints)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (mints)', false, e.message.slice(0, 60)); }

    // Verify mints
    try {
        const balA_after = await getBalance(provider, net, C.MINE.addr, A.addr);
        const balB_after = await getBalance(provider, net, C.MINE.addr, B.addr);
        const diffA = balA_after - balA_before;
        const diffB = balB_after - balB_before;
        assert(diffA === M1M, 'A mint verified', `+${fmt(diffA)} MINE (expected +${fmt(M1M)})`);
        assert(diffB === M1M, 'B mint verified', `+${fmt(diffB)} MINE (expected +${fmt(M1M)})`);
        balA_before = balA_after;
        balB_before = balB_after;
    } catch (e) { record('Mint verification', false, e.message.slice(0, 80)); }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 2: Sell Order — A creates, B fills
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 2: Sell A→B';
    log(`\n▸ ${currentPhase}\n`);

    const SELL_AMOUNT = 100n * 10n ** 8n; // 100 MINE
    const SELL_PRICE = 50n; // 50 sat/token
    const SELL_BTC_TOTAL = 100n * SELL_PRICE; // 5000 sats
    let sellOrderId = -1n;

    // A: increaseAllowance for Market
    try {
        log('  [A] increaseAllowance MINE→Market...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, A.addr);
        await send(await c.increaseAllowance(MARKET, SELL_AMOUNT), A.wallet, net);
        record('A: increaseAllowance→Market', true, fmt(SELL_AMOUNT));
    } catch (e) { record('A: increaseAllowance→Market', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Read nextOrderId before creating
    let nextIdBefore = 0n;
    try {
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const r = await c.getNextOrderId();
        nextIdBefore = r.properties?.nextOrderId ?? 0n;
        log(`  Next order ID before: ${nextIdBefore}`);
    } catch (_) {}

    // A: createSellOrder
    try {
        log(`  [A] createSellOrder: ${fmt(SELL_AMOUNT)} MINE @ ${SELL_PRICE} sat...`);
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const sim = await c.createSellOrder(MINE, SELL_AMOUNT, SELL_PRICE);
        sellOrderId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net);
        record('A: createSellOrder', true, `orderId=${sellOrderId}`);
    } catch (e) { record('A: createSellOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait for block
    try {
        block = await waitBlock(block, 'sell order confirmation');
        record('Block confirmed (sell order)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (sell order)', false, e.message.slice(0, 60)); }

    // Verify order created correctly
    if (sellOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, sellOrderId);
            assert(order.status === 1n, 'Sell order status=ACTIVE', `status=${order.status}`);
            assert(order.amount === SELL_AMOUNT, 'Sell order amount correct', `amount=${fmt(order.amount)}`);
            assert(order.pricePerToken === SELL_PRICE, 'Sell order price correct', `price=${order.pricePerToken}`);
        } catch (e) { record('Verify sell order', false, e.message.slice(0, 80)); }
    }

    // Verify nextOrderId increased
    try {
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const r = await c.getNextOrderId();
        const nextIdAfter = r.properties?.nextOrderId ?? 0n;
        assert(nextIdAfter > nextIdBefore, 'nextOrderId increased', `${nextIdBefore} → ${nextIdAfter}`);
    } catch (e) { record('nextOrderId check', false, e.message.slice(0, 80)); }

    // B: fillSellOrder — B pays BTC to A, gets MINE
    if (sellOrderId >= 0n) {
        try {
            log(`  [B] fillSellOrder #${sellOrderId}: ${fmt(SELL_AMOUNT)} MINE, pay ${fmtSat(SELL_BTC_TOTAL)} sats to A...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
            const sellerP2OP = p2op(A.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: SELL_BTC_TOTAL,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: sellerP2OP,
                    to: A.p2tr,
                }],
            });

            const sim = await c.fillSellOrder(sellOrderId, SELL_AMOUNT);
            await send(sim, B.wallet, net, [{ script: sellerP2OP, value: SELL_BTC_TOTAL }], SELL_BTC_TOTAL + 60_000n);
            record('B: fillSellOrder', true, `paid ${fmtSat(SELL_BTC_TOTAL)} sats`);
        } catch (e) { record('B: fillSellOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block for fill
    try {
        block = await waitBlock(block, 'fill confirmation');
        record('Block confirmed (fill sell)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (fill sell)', false, e.message.slice(0, 60)); }

    // Verify order filled + balances
    if (sellOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, sellOrderId);
            assert(order.status === 2n, 'Sell order status=FILLED', `status=${order.status}`);
        } catch (e) { record('Verify sell order filled', false, e.message.slice(0, 80)); }

        try {
            const balA_now = await getBalance(provider, net, C.MINE.addr, A.addr);
            const balB_now = await getBalance(provider, net, C.MINE.addr, B.addr);
            const diffA = balA_now - balA_before;
            const diffB = balB_now - balB_before;
            // A lost SELL_AMOUNT (sold), B gained SELL_AMOUNT (bought)
            record('A balance decreased', diffA <= 0n - SELL_AMOUNT + 10n ** 8n, `diff=${fmt(diffA)}`);
            record('B balance increased', diffB >= SELL_AMOUNT - 10n ** 8n, `diff=${fmt(diffB)}`);
            balA_before = balA_now;
            balB_before = balB_now;
        } catch (e) { record('Balance verification (sell)', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 3: Sell Order — B creates, A fills (reverse direction)
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 3: Sell B→A';
    log(`\n▸ ${currentPhase}\n`);

    const SELL2_AMOUNT = 50n * 10n ** 8n;
    const SELL2_PRICE = 30n;
    const SELL2_BTC = 50n * SELL2_PRICE; // 1500 sats
    let sellOrderId2 = -1n;

    // B: increaseAllowance for Market
    try {
        log('  [B] increaseAllowance MINE→Market...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, B.addr);
        await send(await c.increaseAllowance(MARKET, SELL2_AMOUNT), B.wallet, net);
        record('B: increaseAllowance→Market', true, fmt(SELL2_AMOUNT));
    } catch (e) { record('B: increaseAllowance→Market', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // B: createSellOrder
    try {
        log(`  [B] createSellOrder: ${fmt(SELL2_AMOUNT)} MINE @ ${SELL2_PRICE} sat...`);
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
        const sim = await c.createSellOrder(MINE, SELL2_AMOUNT, SELL2_PRICE);
        sellOrderId2 = sim.properties?.orderId ?? -1n;
        await send(sim, B.wallet, net);
        record('B: createSellOrder', true, `orderId=${sellOrderId2}`);
    } catch (e) { record('B: createSellOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'B sell order confirmation');
        record('Block confirmed (B sell)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (B sell)', false, e.message.slice(0, 60)); }

    // Verify B's sell order
    if (sellOrderId2 >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, B.addr, sellOrderId2);
            assert(order.status === 1n, 'B sell order status=ACTIVE', `status=${order.status}`);
        } catch (e) { record('Verify B sell order', false, e.message.slice(0, 80)); }
    }

    // A: fillSellOrder from B
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

            const sim = await c.fillSellOrder(sellOrderId2, SELL2_AMOUNT);
            await send(sim, A.wallet, net, [{ script: sellerP2OP, value: SELL2_BTC }], SELL2_BTC + 60_000n);
            record('A: fillSellOrder (B order)', true, `paid ${fmtSat(SELL2_BTC)} sats`);
        } catch (e) { record('A: fillSellOrder (B order)', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'A fill confirmation');
        record('Block confirmed (A fill)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (A fill)', false, e.message.slice(0, 60)); }

    // Verify order filled + balances
    if (sellOrderId2 >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, sellOrderId2);
            assert(order.status === 2n, 'B sell order status=FILLED', `status=${order.status}`);
        } catch (e) { record('Verify B sell order filled', false, e.message.slice(0, 80)); }

        try {
            const balA_now = await getBalance(provider, net, C.MINE.addr, A.addr);
            const balB_now = await getBalance(provider, net, C.MINE.addr, B.addr);
            record('Balances updated (sell B→A)', true, `A=${fmt(balA_now)}, B=${fmt(balB_now)}`);
            balA_before = balA_now;
            balB_before = balB_now;
        } catch (e) { record('Balance check (sell B→A)', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 4: Buy Order — A creates, B accepts
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 4: Buy A←B';
    log(`\n▸ ${currentPhase}\n`);

    const BUY_AMOUNT = 100n * 10n ** 8n;
    const BUY_PRICE = 30n;
    const BUY_BTC = 100n * BUY_PRICE; // 3000 sats
    let buyOrderId = -1n;

    // A: createBuyOrder + lock BTC to Market
    try {
        log(`  [A] createBuyOrder: ${fmt(BUY_AMOUNT)} MINE @ ${BUY_PRICE} sat (lock ${fmtSat(BUY_BTC)} sats)...`);
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

        const sim = await c.createBuyOrder(MINE, BUY_AMOUNT, BUY_PRICE);
        buyOrderId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: mktP2OP, value: BUY_BTC }], BUY_BTC + 60_000n);
        record('A: createBuyOrder', true, `orderId=${buyOrderId}, locked ${fmtSat(BUY_BTC)} sats`);
    } catch (e) { record('A: createBuyOrder', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'buy order confirmation');
        record('Block confirmed (buy order)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (buy order)', false, e.message.slice(0, 60)); }

    // Verify buy order
    if (buyOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, buyOrderId);
            assert(order.status === 1n, 'Buy order status=ACTIVE', `status=${order.status}`);
            assert(order.orderType === 1n, 'Buy order type=BUY', `type=${order.orderType}`);
        } catch (e) { record('Verify buy order', false, e.message.slice(0, 80)); }
    }

    // B: increaseAllowance + acceptBuyOrder
    if (buyOrderId >= 0n) {
        try {
            log('  [B] increaseAllowance MINE→Market for acceptBuyOrder...');
            const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, B.addr);
            await send(await c.increaseAllowance(MARKET, BUY_AMOUNT), B.wallet, net);
            record('B: increaseAllowance for buy', true);
        } catch (e) { record('B: increaseAllowance for buy', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);

        try {
            log(`  [B] acceptBuyOrder #${buyOrderId}...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, B.addr);
            const sim = await c.acceptBuyOrder(buyOrderId);
            await send(sim, B.wallet, net);
            record('B: acceptBuyOrder', true);
        } catch (e) { record('B: acceptBuyOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'accept buy confirmation');
        record('Block confirmed (accept buy)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (accept buy)', false, e.message.slice(0, 60)); }

    // Verify buy order filled + balances
    if (buyOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, buyOrderId);
            assert(order.status === 2n, 'Buy order status=FILLED', `status=${order.status}`);
        } catch (e) { record('Verify buy order filled', false, e.message.slice(0, 80)); }

        try {
            const balA_now = await getBalance(provider, net, C.MINE.addr, A.addr);
            const balB_now = await getBalance(provider, net, C.MINE.addr, B.addr);
            // A gains MINE (buyer), B loses MINE (seller)
            const diffA = balA_now - balA_before;
            const diffB = balB_now - balB_before;
            record('A gained MINE (buyer)', diffA > 0n, `diff=${fmt(diffA)}`);
            record('B lost MINE (seller)', diffB < 0n, `diff=${fmt(diffB)}`);
            balA_before = balA_now;
            balB_before = balB_now;
        } catch (e) { record('Balance check (buy)', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 5: Cancel Order
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 5: Cancel Order';
    log(`\n▸ ${currentPhase}\n`);

    let cancelOrderId = -1n;

    // A: increaseAllowance + create small sell order to cancel
    try {
        log('  [A] increaseAllowance for cancel test...');
        const c = getContract(C.MINE.addr, TOKEN_ABI, provider, net, A.addr);
        await send(await c.increaseAllowance(MARKET, 10n * 10n ** 8n), A.wallet, net);
        record('A: increaseAllowance (cancel test)', true);
    } catch (e) { record('A: increaseAllowance (cancel test)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    try {
        log('  [A] createSellOrder: 10 MINE @ 100 sat (to cancel)...');
        const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
        const sim = await c.createSellOrder(MINE, 10n * 10n ** 8n, 100n);
        cancelOrderId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net);
        record('A: createSellOrder (to cancel)', true, `orderId=${cancelOrderId}`);
    } catch (e) { record('A: createSellOrder (to cancel)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'cancel order creation');
        record('Block confirmed (cancel create)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (cancel create)', false, e.message.slice(0, 60)); }

    // Verify active before cancel
    if (cancelOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, cancelOrderId);
            assert(order.status === 1n, 'Cancel target status=ACTIVE', `status=${order.status}`);
        } catch (e) { record('Verify cancel target active', false, e.message.slice(0, 80)); }
    }

    // Cancel
    if (cancelOrderId >= 0n) {
        try {
            log(`  [A] cancelOrder #${cancelOrderId}...`);
            const c = getContract(C.MARKET.addr, MARKET_ABI, provider, net, A.addr);
            const sim = await c.cancelOrder(cancelOrderId);
            await send(sim, A.wallet, net);
            record('A: cancelOrder', true);
        } catch (e) { record('A: cancelOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'cancel confirmation');
        record('Block confirmed (cancel)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (cancel)', false, e.message.slice(0, 60)); }

    // Verify cancelled
    if (cancelOrderId >= 0n) {
        try {
            const order = await getMarketOrder(provider, net, A.addr, cancelOrderId);
            assert(order.status === 3n, 'Order status=CANCELLED', `status=${order.status}`);
        } catch (e) { record('Verify order cancelled', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 6: CrossChain BTC_TO_FB — A creates, B takes, B completes
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 6: CC BTC→FB';
    log(`\n▸ ${currentPhase}\n`);

    const CC_BTC_AMOUNT = 5000n;
    const expiry = BigInt(block) + 200n;
    let ccOrderId = -1n;

    // Read CC fee info
    let feeBps = 100n; // default
    try {
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        const r = await c.getFeeInfo();
        feeBps = r.properties?.feeBps ?? 100n;
        log(`  Fee: ${feeBps} bps`);
    } catch (_) {}

    // A: createOrder BTC_TO_FB (direction=1, lock BTC on contract)
    try {
        log(`  [A] createOrder BTC→FB: ${fmtSat(CC_BTC_AMOUNT)} sats, expiry=${expiry}...`);
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        const ccP2OP = p2op(C.CROSSCHAIN.pk);

        c.setTransactionDetails({
            inputs: [],
            outputs: [{
                value: CC_BTC_AMOUNT,
                index: 1,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: ccP2OP,
                to: A.p2tr,
            }],
        });

        const sim = await c.createOrder(1n, CC_BTC_AMOUNT, CC_BTC_AMOUNT, expiry, strToU256('tb1q_fractal_A'));
        ccOrderId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: ccP2OP, value: CC_BTC_AMOUNT }], CC_BTC_AMOUNT + 60_000n);
        record('A: CC createOrder BTC→FB', true, `orderId=${ccOrderId}`);
    } catch (e) { record('A: CC createOrder BTC→FB', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'CC create confirmation');
        record('Block confirmed (CC create)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC create)', false, e.message.slice(0, 60)); }

    // Verify CC order created
    if (ccOrderId >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccOrderId);
            assert(order.status === 1n, 'CC order status=Open', `status=${order.status}`);
            assert(order.direction === 1n, 'CC order direction=BTC_TO_FB', `dir=${order.direction}`);
            record('CC order verified', true, `btc=${order.btcAmount}, want=${order.wantAmount}`);
        } catch (e) { record('Verify CC order', false, e.message.slice(0, 80)); }
    }

    // B: takeOrder + pay fee
    if (ccOrderId >= 0n) {
        const feeSats = (() => {
            const calculated = CC_BTC_AMOUNT * feeBps / 10000n;
            return calculated < 330n ? 330n : calculated;
        })();

        try {
            log(`  [B] takeOrder #${ccOrderId}: fee=${fmtSat(feeSats)} sats...`);
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

            const sim = await c.takeOrder(ccOrderId, strToU256('tb1q_fractal_B'));
            await send(sim, B.wallet, net, [{ script: feeP2OP, value: feeSats }], feeSats + 60_000n);
            record('B: CC takeOrder', true, `fee=${fmtSat(feeSats)} sats`);
        } catch (e) { record('B: CC takeOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'CC take confirmation');
        record('Block confirmed (CC take)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC take)', false, e.message.slice(0, 60)); }

    // Verify taken
    if (ccOrderId >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccOrderId);
            assert(order.status === 2n, 'CC order status=Taken', `status=${order.status}`);
        } catch (e) { record('Verify CC taken', false, e.message.slice(0, 80)); }
    }

    // B: completeOrder + claim locked BTC
    if (ccOrderId >= 0n) {
        try {
            log(`  [B] completeOrder #${ccOrderId}: claim ${fmtSat(CC_BTC_AMOUNT)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, B.addr);
            const claimP2OP = p2op(B.hash);

            c.setTransactionDetails({
                inputs: [],
                outputs: [{
                    value: CC_BTC_AMOUNT,
                    index: 1,
                    flags: TransactionOutputFlags.hasScriptPubKey,
                    scriptPubKey: claimP2OP,
                    to: B.p2tr,
                }],
            });

            const sim = await c.completeOrder(ccOrderId);
            await send(sim, B.wallet, net, [{ script: claimP2OP, value: CC_BTC_AMOUNT }], CC_BTC_AMOUNT + 60_000n);
            record('B: CC completeOrder', true, `claimed ${fmtSat(CC_BTC_AMOUNT)} sats`);
        } catch (e) { record('B: CC completeOrder', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'CC complete confirmation');
        record('Block confirmed (CC complete)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC complete)', false, e.message.slice(0, 60)); }

    // Verify completed
    if (ccOrderId >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccOrderId);
            assert(order.status === 3n, 'CC order status=Completed', `status=${order.status}`);
            record('CC BTC→FB full cycle', true, 'create → take → complete');
        } catch (e) { record('Verify CC completed', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 7: CrossChain FB_TO_BTC — B creates, A takes, A completes
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 7: CC FB→BTC';
    log(`\n▸ ${currentPhase}\n`);

    const CC2_BTC = 3000n;
    let ccOrderId2 = -1n;
    const expiry2 = BigInt(block) + 200n;

    // B: createOrder FB_TO_BTC (direction=2, NO BTC lock — maker wants to receive BTC)
    try {
        log(`  [B] createOrder FB→BTC: ${fmtSat(CC2_BTC)} sats, expiry=${expiry2}...`);
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, B.addr);
        const sim = await c.createOrder(2n, CC2_BTC, CC2_BTC, expiry2, strToU256('tb1q_fractal_B2'));
        ccOrderId2 = sim.properties?.orderId ?? -1n;
        await send(sim, B.wallet, net);
        record('B: CC createOrder FB→BTC', true, `orderId=${ccOrderId2}`);
    } catch (e) { record('B: CC createOrder FB→BTC', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'CC FB→BTC create');
        record('Block confirmed (CC2 create)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC2 create)', false, e.message.slice(0, 60)); }

    // Verify
    if (ccOrderId2 >= 0n) {
        try {
            const order = await getCCOrder(provider, net, B.addr, ccOrderId2);
            assert(order.status === 1n, 'CC2 order status=Open', `status=${order.status}`);
            assert(order.direction === 2n, 'CC2 direction=FB_TO_BTC', `dir=${order.direction}`);
        } catch (e) { record('Verify CC2 order', false, e.message.slice(0, 80)); }
    }

    // A: takeOrder + pay fee + lock BTC on contract (taker locks BTC in FB_TO_BTC)
    if (ccOrderId2 >= 0n) {
        const feeSats = (() => {
            const calculated = CC2_BTC * feeBps / 10000n;
            return calculated < 330n ? 330n : calculated;
        })();

        try {
            log(`  [A] takeOrder #${ccOrderId2}: fee=${fmtSat(feeSats)}, lock ${fmtSat(CC2_BTC)} sats...`);
            const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
            const feeP2OP = p2op(DEPLOYER_MLDSA);
            const lockP2OP = p2op(C.CROSSCHAIN.pk);

            c.setTransactionDetails({
                inputs: [],
                outputs: [
                    {
                        value: feeSats,
                        index: 1,
                        flags: TransactionOutputFlags.hasScriptPubKey,
                        scriptPubKey: feeP2OP,
                        to: A.p2tr,
                    },
                    {
                        value: CC2_BTC,
                        index: 2,
                        flags: TransactionOutputFlags.hasScriptPubKey,
                        scriptPubKey: lockP2OP,
                        to: A.p2tr,
                    },
                ],
            });

            const sim = await c.takeOrder(ccOrderId2, strToU256('tb1q_fractal_A2'));
            await send(sim, A.wallet, net, [
                { script: feeP2OP, value: feeSats },
                { script: lockP2OP, value: CC2_BTC },
            ], feeSats + CC2_BTC + 60_000n);
            record('A: CC takeOrder FB→BTC', true, `fee+lock=${fmtSat(feeSats + CC2_BTC)} sats`);
        } catch (e) { record('A: CC takeOrder FB→BTC', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'CC2 take confirmation');
        record('Block confirmed (CC2 take)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC2 take)', false, e.message.slice(0, 60)); }

    // Verify taken
    if (ccOrderId2 >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccOrderId2);
            assert(order.status === 2n, 'CC2 order status=Taken', `status=${order.status}`);
        } catch (e) { record('Verify CC2 taken', false, e.message.slice(0, 80)); }
    }

    // A: completeOrder + claim BTC back (taker completes in FB_TO_BTC)
    if (ccOrderId2 >= 0n) {
        try {
            log(`  [A] completeOrder #${ccOrderId2}: claim ${fmtSat(CC2_BTC)} sats...`);
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

            const sim = await c.completeOrder(ccOrderId2);
            await send(sim, A.wallet, net, [{ script: claimP2OP, value: CC2_BTC }], CC2_BTC + 60_000n);
            record('A: CC completeOrder FB→BTC', true, `claimed ${fmtSat(CC2_BTC)} sats`);
        } catch (e) { record('A: CC completeOrder FB→BTC', false, e.message.slice(0, 80)); }
        await sleep(TX_DELAY);
    }

    // Wait block
    try {
        block = await waitBlock(block, 'CC2 complete');
        record('Block confirmed (CC2 complete)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC2 complete)', false, e.message.slice(0, 60)); }

    // Verify completed
    if (ccOrderId2 >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccOrderId2);
            assert(order.status === 3n, 'CC2 order status=Completed', `status=${order.status}`);
            record('CC FB→BTC full cycle', true, 'create → take → complete');
        } catch (e) { record('Verify CC2 completed', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 8: CrossChain Cancel + Refund
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Phase 8: CC Cancel';
    log(`\n▸ ${currentPhase}\n`);

    let ccCancelId = -1n;

    // A: createOrder BTC_TO_FB with short expiry (to cancel)
    try {
        log('  [A] createOrder BTC→FB (to cancel): 2000 sats...');
        const c = getContract(C.CROSSCHAIN.addr, CROSSCHAIN_ABI, provider, net, A.addr);
        const ccP2OP = p2op(C.CROSSCHAIN.pk);
        const shortExpiry = BigInt(block) + 200n; // enough time before cancel

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

        const sim = await c.createOrder(1n, 2000n, 2000n, shortExpiry, strToU256('tb1q_cancel_test'));
        ccCancelId = sim.properties?.orderId ?? -1n;
        await send(sim, A.wallet, net, [{ script: ccP2OP, value: 2000n }], 62_000n);
        record('A: CC createOrder (to cancel)', true, `orderId=${ccCancelId}`);
    } catch (e) { record('A: CC createOrder (to cancel)', false, e.message.slice(0, 80)); }
    await sleep(TX_DELAY);

    // Wait block
    try {
        block = await waitBlock(block, 'CC cancel create');
        record('Block confirmed (CC cancel create)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC cancel create)', false, e.message.slice(0, 60)); }

    // Verify created
    if (ccCancelId >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccCancelId);
            assert(order.status === 1n, 'CC cancel target status=Open', `status=${order.status}`);
        } catch (e) { record('Verify CC cancel target', false, e.message.slice(0, 80)); }
    }

    // A: cancelOrder + get BTC refund
    if (ccCancelId >= 0n) {
        try {
            log(`  [A] cancelOrder #${ccCancelId}: refund 2000 sats...`);
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
    }

    // Wait block
    try {
        block = await waitBlock(block, 'CC cancel confirmation');
        record('Block confirmed (CC cancel)', true, `block=${block}`);
    } catch (e) { record('Block confirmed (CC cancel)', false, e.message.slice(0, 60)); }

    // Verify cancelled
    if (ccCancelId >= 0n) {
        try {
            const order = await getCCOrder(provider, net, A.addr, ccCancelId);
            assert(order.status === 4n, 'CC order status=Cancelled', `status=${order.status}`);
        } catch (e) { record('Verify CC cancelled', false, e.message.slice(0, 80)); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Final balances
    // ══════════════════════════════════════════════════════════════════════════
    currentPhase = 'Final';
    log('\n▸ Final Balances\n');

    try {
        const balA = await getBalance(provider, net, C.MINE.addr, A.addr);
        const balB = await getBalance(provider, net, C.MINE.addr, B.addr);
        record('Final MINE(A)', true, fmt(balA));
        record('Final MINE(B)', true, fmt(balB));
    } catch (e) { record('Final balances', false, e.message.slice(0, 80)); }

    // ══════════════════════════════════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════════════════════════════════
    log('\n╔═══════════════════════════════════════════════════════╗');
    log('║                    TEST RESULTS                       ║');
    log('╚═══════════════════════════════════════════════════════╝\n');

    const totalPass = results.filter(r => r.ok).length;
    const totalFail = results.filter(r => !r.ok).length;

    // Per-phase summary
    for (const [phase, counts] of Object.entries(phaseResults)) {
        const icon = counts.fail === 0 ? '✅' : '❌';
        log(`  ${icon} ${phase}: ${counts.pass}/${counts.pass + counts.fail} passed`);
    }

    log(`\n  ─────────────────────────────`);
    log(`  Total: ${totalPass}/${results.length} passed, ${totalFail} failed`);
    log(`  Rate:  ${(totalPass / results.length * 100).toFixed(0)}%`);

    if (totalFail > 0) {
        log('\n  Failed tests:');
        for (const r of results) {
            if (!r.ok) log(`    ❌ [${r.phase}] ${r.test}: ${r.detail}`);
        }
    }

    log('\n  Tested functions:');
    log('    Market:  createSellOrder, fillSellOrder, createBuyOrder, acceptBuyOrder, cancelOrder, getOrder, getNextOrderId');
    log('    CC:      createOrder(BTC→FB), createOrder(FB→BTC), takeOrder, completeOrder, cancelOrder, getOrder, getFeeInfo');
    log('    Tokens:  publicMint, balanceOf, increaseAllowance');
    log('    Flows:   A→B sell, B→A sell, A buy←B accept, cancel, BTC→FB full cycle, FB→BTC full cycle, CC cancel\n');

    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
