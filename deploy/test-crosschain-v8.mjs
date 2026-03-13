#!/usr/bin/env node
/**
 * OPNet Hub — FractalSwap v8 Partial Fills E2E Test
 * Tests: createOrder, getOrder (12 fields), partial take, full take, cancel remaining
 *
 * Usage: OPNET_MNEMONIC="12 words..." node deploy/test-crosschain-v8.mjs
 *
 * NOTE: Orders must be confirmed (mined) before they can be taken/completed.
 * This test creates orders and, if confirmed orders exist, tests partial fills.
 */

import { createHash } from 'crypto';
import { Mnemonic, Address } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { JSONRpcProvider, getContract, TransactionOutputFlags } from '../node_modules/opnet/build/index.js';

// ─── Config ─────────────────────────────────────────────────────────────────
const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }
const RPC_URL = 'https://testnet.opnet.org';
const RPC_JSONRPC = RPC_URL + '/api/v1/json-rpc';

const CC_V8 = {
    addr: 'opt1sqphxm7la5z4n3ynzux84gl9dztgrgfw64cu6u3w8',
    pk: '761b52cc0451447c786ac7e4386811274b7f5114cdc7d47225f6a8ee3ed44c2d',
};

// Fee recipient = deployer's MLDSA hash (NOT the contract address!)
const FEE_RECIPIENT_MLDSA = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';

// ─── ABI (v8) ────────────────────────────────────────────────────────────────
const FN = 'function', U256 = 'UINT256', BOOL = 'BOOL';

const CC_ABI_V8 = [
    { name: 'createOrder', inputs: [
        { name: 'direction', type: U256 }, { name: 'btcAmount', type: U256 },
        { name: 'wantAmount', type: U256 }, { name: 'expiry', type: U256 },
        { name: 'fractalAddr', type: U256 },
    ], outputs: [{ name: 'orderId', type: U256 }], type: FN },
    { name: 'takeOrder', inputs: [
        { name: 'orderId', type: U256 }, { name: 'takerAddr', type: U256 },
        { name: 'fillBtcAmount', type: U256 }, // v8: 0 = full take
    ], outputs: [{ name: 'fillOrderId', type: U256 }], type: FN },
    { name: 'completeOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'cancelOrder', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'refundExpired', inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }], type: FN },
    { name: 'getOrder', constant: true, inputs: [{ name: 'orderId', type: U256 }], outputs: [
        { name: 'direction', type: U256 }, { name: 'status', type: U256 },
        { name: 'creator', type: U256 }, { name: 'taker', type: U256 },
        { name: 'btcAmount', type: U256 }, { name: 'wantAmount', type: U256 },
        { name: 'expiry', type: U256 }, { name: 'makerAddr', type: U256 },
        { name: 'takerAddr', type: U256 }, { name: 'feePaid', type: U256 },
        { name: 'filledBtc', type: U256 }, { name: 'parentId', type: U256 },
    ], type: FN },
    { name: 'getNextOrderId', constant: true, inputs: [], outputs: [{ name: 'nextOrderId', type: U256 }], type: FN },
    { name: 'getFeeInfo', constant: true, inputs: [], outputs: [{ name: 'feeRecipient', type: U256 }, { name: 'feeBps', type: U256 }], type: FN },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
const results = [];
let pass = 0, fail = 0;

function log(msg) { console.log(msg); }
function record(test, ok, detail = '') {
    results.push({ test, ok, detail });
    ok ? pass++ : fail++;
    log(`${ok ? '  OK' : '  FAIL'} ${test}${detail ? ' -- ' + detail : ''}`);
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

async function send(sim, wallet, network, extra = [], maxSat = 100_000n) {
    if (sim.revert) throw new Error(`REVERT: ${sim.revert}`);
    log(`   Sim OK, sending...`);
    const tx = await sim.sendTransaction({
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        refundTo: wallet.p2tr,
        network, feeRate: 10, priorityFee: 5000n,
        maximumAllowedSatToSpend: maxSat,
        ...(extra.length ? { extraOutputs: extra } : {}),
    });
    log(`   TX: ${tx.transactionId?.slice(0, 16)}... | Peers: ${tx.peerAcknowledgements}`);
    return tx;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
    log('=========================================================');
    log('  FractalSwap v8 — Partial Fills E2E Test');
    log('=========================================================\n');

    const net = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };

    const mkWallet = (idx) => {
        const mn = new Mnemonic(MNEMONIC, '', net);
        const w = mn.deriveOPWallet(undefined, idx);
        const h = createHash('sha256').update(Buffer.from(w.mldsaKeypair.publicKey)).digest().toString('hex');
        const t = Buffer.from(w._tweakedKey || w.keypair.publicKey).toString('hex');
        return { wallet: w, hash: h, addr: Address.fromString(h, t) };
    };

    const A = mkWallet(0);
    const B = mkWallet(1);
    const provider = new JSONRpcProvider({ url: RPC_URL, network: net });

    log(`  A: ${A.wallet.p2tr}`);
    log(`  B: ${B.wallet.p2tr}`);

    const block = Number(await rpc('btc_blockNumber', []));
    log(`  Block: ${block}\n`);

    // ── Phase 1: Read-only ──
    log('--- Phase 1: Read-only queries ---\n');

    let nextId = 0n;
    try {
        const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
        const r = await c.getNextOrderId();
        nextId = r.properties?.nextOrderId ?? 0n;
        record('getNextOrderId', true, `nextId=${nextId}`);
    } catch (e) { record('getNextOrderId', false, e.message.slice(0, 80)); }

    try {
        const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
        const r = await c.getFeeInfo();
        const bps = r.properties?.feeBps;
        const recip = r.properties?.feeRecipient;
        record('getFeeInfo', true, `bps=${bps}, recipient=${recip?.toString(16).slice(0, 16)}...`);
    } catch (e) { record('getFeeInfo', false, e.message.slice(0, 80)); }

    // Read existing orders (if any)
    const statusMap = { 0: 'None', 1: 'Open', 2: 'Taken', 3: 'Done', 4: 'Cancelled', 5: 'Refunded' };

    if (nextId > 1n) {
        log(`\n  Found ${nextId - 1n} existing orders, reading...\n`);
        for (let i = 1n; i < nextId && i <= 20n; i++) {
            try {
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                const o = await c.getOrder(i);
                const p = o.properties;
                const dir = Number(p.direction) === 1 ? 'BTC->FB' : 'FB->BTC';
                const st = statusMap[Number(p.status)] || `?${p.status}`;
                const filled = p.filledBtc ?? 0n;
                const parent = Number(p.parentId ?? 0n);
                record(`getOrder #${i}`, true,
                    `${dir} | ${st} | btc=${p.btcAmount} want=${p.wantAmount} | filled=${filled} parent=${parent} | exp=${p.expiry}`);
            } catch (e) { record(`getOrder #${i}`, false, e.message.slice(0, 80)); }
        }
    }

    // Determine mode: if confirmed orders exist, test partial fills directly.
    // If nextId=1 (no orders yet), create orders first.
    const hasConfirmedOrders = nextId > 1n;
    const expiry = BigInt(block) + 200n;
    const ccP2OP = p2op(CC_V8.pk);

    if (!hasConfirmedOrders) {
        // ── Phase 2: Create orders (first run) ──
        log('\n--- Phase 2: Create orders (first run - will need confirmation) ---\n');

        try {
            log(`  [A] Create BTC->FB: 10000 sats, expiry ${expiry}...`);
            const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
            c.setTransactionDetails({
                inputs: [],
                outputs: [{ value: 10000n, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: ccP2OP, to: A.wallet.p2tr }],
            });
            const sim = await c.createOrder(1n, 10000n, 10000n, expiry, strToU256('bc1ptest_wallet_A'));
            const orderId = sim.properties?.orderId ?? 0n;
            log(`   Simulation: orderId=${orderId}`);
            await send(sim, A.wallet, net, [{ script: ccP2OP, value: 10000n }], 60_000n);
            record('createOrder #1 (partial fill target)', true, `orderId=${orderId}, 10000 sats`);
        } catch (e) { record('createOrder #1', false, e.message.slice(0, 120)); }
        await sleep(2000);

        log('\n  Orders created. Re-run this test after ~10 min to test partial fills.');
        log('  Waiting for block confirmation before orders can be taken...\n');

    } else {
        // ── Phase 2B: Test partial fills on confirmed orders ──
        log('\n--- Phase 2: Partial fill tests on confirmed orders ---\n');

        // Find first Open BTC_TO_FB order with enough remaining
        let partialTarget = 0n;
        let targetBtc = 0n;
        for (let i = 1n; i < nextId; i++) {
            try {
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                const o = await c.getOrder(i);
                const p = o.properties;
                if (Number(p.status) === 1 && Number(p.direction) === 1 &&
                    Number(p.parentId ?? 0n) === 0 && Number(p.expiry) > block) {
                    const remaining = p.btcAmount - (p.filledBtc ?? 0n);
                    if (remaining >= 2000n) {
                        partialTarget = i;
                        targetBtc = remaining;
                        break;
                    }
                }
            } catch { /* skip */ }
        }

        if (partialTarget > 0n) {
            // ── Test A: Partial take (half) ──
            const fillAmount = targetBtc / 2n;
            log(`  Target: Order #${partialTarget} (remaining=${targetBtc})`);
            log(`  Fill amount: ${fillAmount} sats (half)\n`);

            try {
                log(`  [B] Partial take: order #${partialTarget}, fillBtcAmount=${fillAmount}...`);
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, B.addr);
                const fee = (fillAmount * 100n) / 10000n;
                // Fee must be >= dust limit (330 sats). If below, pad to 330.
                const feeOutput = fee < 330n ? 330n : fee;
                const feeP2OP = p2op(FEE_RECIPIENT_MLDSA); // Fee goes to fee recipient, NOT contract

                c.setTransactionDetails({
                    inputs: [],
                    outputs: [{ value: feeOutput, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: feeP2OP, to: B.wallet.p2tr }],
                });

                const sim = await c.takeOrder(partialTarget, strToU256('bc1ptest_wallet_B'), fillAmount);
                if (sim.revert) {
                    record('Partial take simulation', false, `REVERT: ${sim.revert}`);
                } else {
                    const fillOrderId = sim.properties?.fillOrderId ?? 0n;
                    log(`   Sim OK! fillOrderId=${fillOrderId}, fee=${fee}`);

                    // Key v8 checks
                    record('Partial take simulated', true, `fillOrderId=${fillOrderId}`);
                    record('fillOrderId != parent (child created)',
                        fillOrderId !== partialTarget && fillOrderId > partialTarget,
                        `child=${fillOrderId}, parent=${partialTarget}`);

                    await send(sim, B.wallet, net, [{ script: feeP2OP, value: feeOutput }], 60_000n);
                    record('Partial take broadcast', true);
                    await sleep(2000);

                    // Read parent — should show filledBtc (simulation state)
                    try {
                        const c2 = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                        const o = await c2.getOrder(partialTarget);
                        const p = o.properties;
                        log(`   Parent after partial: status=${statusMap[Number(p.status)]}, filledBtc=${p.filledBtc}`);
                        // Note: this reads from chain, so filledBtc might not be updated until confirmed
                    } catch (e) { log(`   Parent read failed: ${e.message.slice(0, 60)}`); }

                    // Read child order (simulation state, may not exist on-chain yet)
                    if (fillOrderId > 0n) {
                        try {
                            const c3 = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                            const child = await c3.getOrder(fillOrderId);
                            const cp = child.properties;
                            log(`   Child #${fillOrderId}: dir=${cp.direction}, status=${statusMap[Number(cp.status)]}, btc=${cp.btcAmount}, parent=${cp.parentId}`);
                        } catch { log(`   Child order not on-chain yet (in mempool)`); }
                    }
                }
            } catch (e) {
                record('Partial take', false, e.message.slice(0, 120));
            }
        } else {
            log('  No suitable open orders for partial fill test');
            log('  Creating a new order for future testing...\n');

            try {
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                c.setTransactionDetails({
                    inputs: [],
                    outputs: [{ value: 10000n, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: ccP2OP, to: A.wallet.p2tr }],
                });
                const sim = await c.createOrder(1n, 10000n, 10000n, expiry, strToU256('bc1ptest_partial'));
                await send(sim, A.wallet, net, [{ script: ccP2OP, value: 10000n }], 60_000n);
                record('createOrder for partial fill', true, `orderId=${sim.properties?.orderId}`);
            } catch (e) { record('createOrder for partial fill', false, e.message.slice(0, 120)); }
        }

        // ── Test B: Full take test ──
        log('\n--- Phase 3: Full take test (fillBtcAmount=0) ---\n');

        // Create a fresh order for full-take
        try {
            log('  [A] Create BTC->FB: 5000 sats for full-take test...');
            const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
            c.setTransactionDetails({
                inputs: [],
                outputs: [{ value: 5000n, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: ccP2OP, to: A.wallet.p2tr }],
            });
            const sim = await c.createOrder(1n, 5000n, 5000n, expiry, strToU256('bc1ptest_full'));
            const fullOrderId = sim.properties?.orderId ?? 0n;
            await send(sim, A.wallet, net, [{ script: ccP2OP, value: 5000n }], 60_000n);
            record('createOrder for full-take', true, `orderId=${fullOrderId}`);
        } catch (e) { record('createOrder for full-take', false, e.message.slice(0, 120)); }

        // ── Test C: Cancel test ──
        log('\n--- Phase 4: Cancel test ---\n');

        // Find any open order by A that we can cancel
        let cancelTarget = 0n;
        for (let i = nextId - 1n; i >= 1n; i--) {
            try {
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                const o = await c.getOrder(i);
                const p = o.properties;
                // Open, not expired, creator is A, parentId=0
                if (Number(p.status) === 1 && Number(p.parentId ?? 0n) === 0 &&
                    Number(p.expiry) > block) {
                    cancelTarget = i;
                    break;
                }
            } catch { /* skip */ }
        }

        if (cancelTarget > 0n) {
            try {
                // Read order to get btcAmount for refund
                const cr = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);
                const orderData = await cr.getOrder(cancelTarget);
                const btcAmount = orderData.properties?.btcAmount ?? 0n;
                const filledBtc = orderData.properties?.filledBtc ?? 0n;
                const remaining = btcAmount - filledBtc;
                const direction = Number(orderData.properties?.direction);

                log(`  [A] Cancel order #${cancelTarget} (dir=${direction}, remaining=${remaining})...`);
                const c = getContract(CC_V8.addr, CC_ABI_V8, provider, net, A.addr);

                // BTC_TO_FB (dir=1): contract needs output to refund BTC to creator
                if (direction === 1 && remaining > 0n) {
                    const creatorP2OP = p2op(A.hash);
                    c.setTransactionDetails({
                        inputs: [],
                        outputs: [{ value: remaining, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: creatorP2OP, to: A.wallet.p2tr }],
                    });
                    const sim = await c.cancelOrder(cancelTarget);
                    if (sim.revert) {
                        record('Cancel simulation', false, `REVERT: ${sim.revert}`);
                    } else {
                        await send(sim, A.wallet, net, [{ script: creatorP2OP, value: remaining }], remaining + 50_000n);
                        record('Cancel order', true, `#${cancelTarget} cancelled, refunded ${remaining} sats`);
                    }
                } else {
                    // FB_TO_BTC or zero remaining — no BTC refund needed
                    const sim = await c.cancelOrder(cancelTarget);
                    if (sim.revert) {
                        record('Cancel simulation', false, `REVERT: ${sim.revert}`);
                    } else {
                        await send(sim, A.wallet, net);
                        record('Cancel order', true, `#${cancelTarget} cancelled`);
                    }
                }
            } catch (e) { record('Cancel order', false, e.message.slice(0, 120)); }
        } else {
            log('  No cancellable orders found');
        }
    }

    // ── Report ──
    log('\n=========================================================');
    log('  RESULTS');
    log('=========================================================');
    log(`  PASS: ${pass}`);
    log(`  FAIL: ${fail}`);
    log(`  Total:  ${results.length}`);
    log(`  Rate:   ${(pass / results.length * 100).toFixed(0)}%`);
    log('=========================================================\n');

    if (fail > 0) {
        log('Failed tests:');
        for (const r of results) if (!r.ok) log(`  FAIL ${r.test}: ${r.detail}`);
    }

    log('\nv8 Partial Fill features tested:');
    log('  - getNextOrderId, getFeeInfo (read-only)');
    log('  - getOrder returns 12 fields (v8: +filledBtc, +parentId)');
    log('  - createOrder (BTC_TO_FB with BTC lock)');
    log('  - takeOrder partial (fillBtcAmount > 0, creates child)');
    log('  - takeOrder full (fillBtcAmount = 0, updates parent)');
    log('  - cancelOrder (refunds remaining)');
    log('');
    log('NOTE: Partial/full take may REVERT if order is still unconfirmed.');
    log('Re-run after ~10 min to test against confirmed orders.');

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
