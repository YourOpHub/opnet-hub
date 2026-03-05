/**
 * NativeSwap E2E Test — 2 wallets
 *
 * Usage: OPNET_MNEMONIC="12 words..." node deploy/test-nativeswap.mjs [phase]
 *
 * Phases:
 *   status   — check pool state, balances, LP positions
 *   1a       — Wallet A: approve MINE → NativeSwap
 *   1b       — Wallet A: addLiquidity (100 MINE + 50,000 sats BTC)
 *   2a       — Wallet B: reserveBuyToken (10,000 sats BTC)
 *   2b       — Wallet B: executeBuyToken (pay BTC, receive MINE)
 *   3a       — Wallet B: approve MINE → NativeSwap (for sell)
 *   3b       — Wallet B: sellTokenForBTC (sell some MINE back)
 *   4        — Wallet A: removeLiquidity (partial withdrawal)
 *   5        — Wallet A: cancelReservation (test cancel flow)
 */
import { Mnemonic, Address } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { JSONRpcProvider, getContract, TransactionOutputFlags, ABIDataTypes, BitcoinAbiTypes } from '../node_modules/opnet/build/index.js';
import crypto from 'crypto';

const RPC_URL = 'https://testnet.opnet.org';
const RPC = `${RPC_URL}/api/v1/json-rpc`;

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const phase = process.argv[2] || 'status';

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonicObj = new Mnemonic(phrase, '', network);
const walletA = mnemonicObj.deriveOPWallet(undefined, 0);
const walletB = mnemonicObj.deriveOPWallet(undefined, 1);

const MLDSA_A = crypto.createHash('sha256').update(walletA.mldsaKeypair.publicKey).digest('hex');
const MLDSA_B = crypto.createHash('sha256').update(walletB.mldsaKeypair.publicKey).digest('hex');
const TWEAKED_A = Buffer.from(walletA._tweakedKey).toString('hex');
const TWEAKED_B = Buffer.from(walletB._tweakedKey).toString('hex');

// Contract addresses
const NATIVESWAP = 'opt1sqral2q69evhz02lt8yrytfqheyjqy9rk4scf86p8';
const NATIVESWAP_PK = '0x227a8a279f61c463d835e0635480927047be7bc948452431e95403ddf256b4c7';
const NATIVESWAP_HEX = '227a8a279f61c463d835e0635480927047be7bc948452431e95403ddf256b4c7';
const MINE = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
const MINE_PK = '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

const opnetProvider = new JSONRpcProvider({ url: RPC, network });

const F = BitcoinAbiTypes.Function;
const U = ABIDataTypes.UINT256;
const A = ABIDataTypes.ADDRESS;
const B = ABIDataTypes.BOOL;

const TX_PARAMS_A = { signer: walletA.keypair, mldsaSigner: walletA.mldsaKeypair, refundTo: walletA.p2tr, network, feeRate: 10, priorityFee: 5000n, maximumAllowedSatToSpend: 200_000n };
const TX_PARAMS_B = { signer: walletB.keypair, mldsaSigner: walletB.mldsaKeypair, refundTo: walletB.p2tr, network, feeRate: 10, priorityFee: 5000n, maximumAllowedSatToSpend: 200_000n };

async function rpc(method, params = []) {
    const r = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
}

function buildP2OPScript(mldsaHex) {
    const buf = Buffer.alloc(34);
    buf[0] = 0x60; buf[1] = 0x20;
    Buffer.from(mldsaHex, 'hex').copy(buf, 2);
    return new Uint8Array(buf);
}

async function sendTx(sim, params, label) {
    if (!sim.calldata) { console.log(`  ${label} SIM FAIL:`, sim.revert); return null; }
    console.log(`  ${label} sim OK, gas: ${sim.estimatedGas}, gasSats: ${sim.estimatedSatGas}`);
    try {
        const receipt = await sim.sendTransaction(params);
        console.log(`  ${label} TX: ${receipt.transactionId}`);
        return receipt.transactionId;
    } catch (e) {
        console.log(`  ${label} SEND FAIL:`, e.message?.slice(0, 200));
        return null;
    }
}

// ABIs
const tokenABI = [
    { name: 'balanceOf', inputs: [{ name: 'owner', type: A }], outputs: [{ name: 'balance', type: U }], type: F },
    { name: 'increaseAllowance', inputs: [{ name: 'spender', type: A }, { name: 'addedValue', type: U }], outputs: [], type: F },
    { name: 'allowance', inputs: [{ name: 'owner', type: A }, { name: 'spender', type: A }], outputs: [{ name: 'remaining', type: U }], type: F },
];

const nativeswapABI = [
    { name: 'addLiquidity', inputs: [{ name: 'tokenAmount', type: U }, { name: 'btcAmount', type: U }], outputs: [{ name: 'shares', type: U }], type: F },
    { name: 'removeLiquidity', inputs: [{ name: 'shares', type: U }], outputs: [{ name: 'tokenOut', type: U }, { name: 'btcOut', type: U }], type: F },
    { name: 'reserveBuyToken', inputs: [{ name: 'btcAmount', type: U }, { name: 'minTokenOut', type: U }], outputs: [{ name: 'reservationId', type: U }, { name: 'tokenAmount', type: U }], type: F },
    { name: 'executeBuyToken', inputs: [{ name: 'reservationId', type: U }], outputs: [{ name: 'success', type: B }], type: F },
    { name: 'cancelReservation', inputs: [{ name: 'reservationId', type: U }], outputs: [{ name: 'success', type: B }], type: F },
    { name: 'sellTokenForBTC', inputs: [{ name: 'tokenAmount', type: U }, { name: 'minBtcOut', type: U }], outputs: [{ name: 'btcOut', type: U }], type: F },
    { name: 'getReserves', inputs: [], outputs: [{ name: 'btcReserve', type: U }, { name: 'tokenReserve', type: U }], type: F },
    { name: 'getQuoteBuyToken', inputs: [{ name: 'btcAmount', type: U }], outputs: [{ name: 'tokenAmount', type: U }], type: F },
    { name: 'getQuoteSellToken', inputs: [{ name: 'tokenAmount', type: U }], outputs: [{ name: 'btcAmount', type: U }], type: F },
    { name: 'liquidityOf', inputs: [{ name: 'account', type: A }], outputs: [{ name: 'shares', type: U }, { name: 'tokenAmount', type: U }, { name: 'btcAmount', type: U }], type: F },
    { name: 'getReservation', inputs: [{ name: 'reservationId', type: U }], outputs: [{ name: 'owner', type: U }, { name: 'btcAmount', type: U }, { name: 'tokenAmount', type: U }, { name: 'expiry', type: U }, { name: 'status', type: U }], type: F },
    { name: 'getPoolInfo', inputs: [], outputs: [{ name: 'totalShares', type: U }, { name: 'feeRateBps', type: U }, { name: 'totalReservedTokens', type: U }, { name: 'nextReservationId', type: U }], type: F },
    { name: 'getToken', inputs: [], outputs: [{ name: 'token', type: A }], type: F },
];

// ══════════════════════════════════════════════════════════════
// STATUS — check pool, balances, LP positions
// ══════════════════════════════════════════════════════════════
async function checkStatus() {
    const block = await rpc('btc_blockNumber');
    console.log('Block:', Number(block));

    // BTC balances
    const [bA, bB] = await Promise.all([rpc('btc_getBalance', [walletA.p2tr]), rpc('btc_getBalance', [walletB.p2tr])]);
    console.log('BTC A:', Number(bA), 'sats | B:', Number(bB), 'sats');

    // MINE balances via contract call
    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const senderB = Address.fromString('0x' + MLDSA_B, '0x' + TWEAKED_B);
    const mineA = getContract(MINE, tokenABI, opnetProvider, network, senderA);
    const mineB = getContract(MINE, tokenABI, opnetProvider, network, senderB);

    try {
        const balA = await mineA.balanceOf(senderA);
        const balB = await mineB.balanceOf(senderB);
        console.log('MINE A:', (Number(balA.properties?.balance || 0) / 1e8).toFixed(0),
            '| B:', (Number(balB.properties?.balance || 0) / 1e8).toFixed(0));
    } catch (e) { console.log('MINE balance query failed:', e.message?.slice(0, 100)); }

    // NativeSwap pool info
    const nsA = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderA);

    try {
        const reserves = await nsA.getReserves();
        const rp = reserves.properties || {};
        console.log('\n--- NativeSwap Pool ---');
        console.log('BTC reserve:', Number(rp.btcReserve || 0), 'sats');
        console.log('Token reserve:', (Number(rp.tokenReserve || 0) / 1e8).toFixed(4), 'MINE');

        const info = await nsA.getPoolInfo();
        const ip = info.properties || {};
        console.log('Total shares:', Number(ip.totalShares || 0));
        console.log('Fee rate:', Number(ip.feeRateBps || 0), 'bps');
        console.log('Reserved tokens:', (Number(ip.totalReservedTokens || 0) / 1e8).toFixed(4));
        console.log('Next reservation ID:', Number(ip.nextReservationId || 0));

        // LP positions
        const lpA = await nsA.liquidityOf(senderA);
        const lpAp = lpA.properties || {};
        console.log('\nLP A: shares=', Number(lpAp.shares || 0), 'token=', (Number(lpAp.tokenAmount || 0) / 1e8).toFixed(4), 'btc=', Number(lpAp.btcAmount || 0));

        const nsB = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderB);
        const lpB = await nsB.liquidityOf(senderB);
        const lpBp = lpB.properties || {};
        console.log('LP B: shares=', Number(lpBp.shares || 0), 'token=', (Number(lpBp.tokenAmount || 0) / 1e8).toFixed(4), 'btc=', Number(lpBp.btcAmount || 0));

        // Quote: what does 10,000 sats buy?
        if (Number(rp.btcReserve || 0) > 0) {
            const quote = await nsA.getQuoteBuyToken(10_000n);
            console.log('\nQuote: 10,000 sats →', (Number(quote.properties?.tokenAmount || 0) / 1e8).toFixed(4), 'MINE');
        }
    } catch (e) { console.log('NativeSwap query failed:', e.message?.slice(0, 200)); }
}

// ══════════════════════════════════════════════════════════════
// PHASE 1a: Wallet A approve MINE → NativeSwap
// ══════════════════════════════════════════════════════════════
async function phase1a() {
    console.log('\n=== PHASE 1a: Wallet A approve MINE → NativeSwap ===\n');
    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const mineA = getContract(MINE, tokenABI, opnetProvider, network, senderA);
    const nativeswapAddr = Address.fromString(NATIVESWAP_PK);

    // Check current allowance
    try {
        const allowRes = await mineA.allowance(senderA, nativeswapAddr);
        const current = BigInt(String(allowRes.properties?.remaining || 0));
        console.log('  Current allowance:', (Number(current) / 1e8).toFixed(0), 'MINE');
        if (current > 1_000_000_0000_0000n) {
            console.log('  Already sufficient, skipping.');
            return;
        }
    } catch (e) { console.log('  Allowance check error:', e.message?.slice(0, 100)); }

    const MAX_UINT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const sim = await mineA.increaseAllowance(nativeswapAddr, MAX_UINT);
    await sendTx(sim, TX_PARAMS_A, 'increaseAllowance(MINE→NativeSwap)');
    console.log('\n  Done! Wait for block confirmation, then run phase 1b.');
}

// ══════════════════════════════════════════════════════════════
// PHASE 1b: Wallet A addLiquidity (100 MINE + 50,000 sats BTC)
// ══════════════════════════════════════════════════════════════
async function phase1b() {
    console.log('\n=== PHASE 1b: Wallet A addLiquidity (100 MINE + 50,000 sats) ===\n');
    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const nsA = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderA);

    const tokenAmount = 100_0000_0000n; // 100 MINE (8 decimals)
    const btcAmount = 50_000n;          // 50,000 sats

    // Build P2OP script for contract
    const contractScript = buildP2OPScript(NATIVESWAP_HEX);
    const contractP2OP = Address.fromString(NATIVESWAP_PK).p2op(network);

    // Set transaction details BEFORE simulate
    nsA.setTransactionDetails({
        inputs: [],
        outputs: [{
            to: contractP2OP,
            scriptPubKey: contractScript,
            value: btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
        }],
    });

    console.log(`  Adding: ${Number(tokenAmount) / 1e8} MINE + ${Number(btcAmount)} sats BTC`);
    const sim = await nsA.addLiquidity(tokenAmount, btcAmount);

    if (sim.calldata) {
        console.log(`  Shares to receive: ${sim.properties?.shares?.toString() || 'N/A'}`);
    }

    await sendTx(sim, {
        ...TX_PARAMS_A,
        extraOutputs: [{ script: Buffer.from(contractScript), value: btcAmount }],
        maximumAllowedSatToSpend: btcAmount + 150_000n,
    }, 'addLiquidity');
    console.log('\n  Done! Wait for block, then run status to check reserves.');
}

// ══════════════════════════════════════════════════════════════
// PHASE 2a: Wallet B reserveBuyToken (10,000 sats)
// ══════════════════════════════════════════════════════════════
async function phase2a() {
    console.log('\n=== PHASE 2a: Wallet B reserveBuyToken (10,000 sats) ===\n');
    const senderB = Address.fromString('0x' + MLDSA_B, '0x' + TWEAKED_B);
    const nsB = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderB);

    const btcAmount = 10_000n; // 10,000 sats
    const minTokenOut = 1n;    // minimum 1 sat-unit of token (basically no slippage protection for test)

    console.log(`  Reserving: ${Number(btcAmount)} sats BTC for MINE tokens`);
    const sim = await nsB.reserveBuyToken(btcAmount, minTokenOut);

    if (sim.calldata) {
        console.log(`  Reservation ID: ${sim.properties?.reservationId?.toString() || 'N/A'}`);
        console.log(`  Token amount: ${(Number(sim.properties?.tokenAmount || 0) / 1e8).toFixed(4)} MINE`);
    }

    await sendTx(sim, TX_PARAMS_B, 'reserveBuyToken');
    console.log('\n  Done! Wait for block, then run 2b (executeBuyToken).');
}

// ══════════════════════════════════════════════════════════════
// PHASE 2b: Wallet B executeBuyToken (pay BTC, get MINE)
// ══════════════════════════════════════════════════════════════
async function phase2b() {
    const resIdArg = process.argv[3] ? BigInt(process.argv[3]) : null;
    console.log('\n=== PHASE 2b: Wallet B executeBuyToken ===\n');
    const senderB = Address.fromString('0x' + MLDSA_B, '0x' + TWEAKED_B);
    const nsB = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderB);

    // Find active reservation for wallet B
    let resId = resIdArg;
    let btcAmount = 0n;

    if (!resId) {
        const info = await nsB.getPoolInfo();
        const nextId = Number(info.properties?.nextReservationId || 1);
        console.log(`  Scanning reservations 1..${nextId - 1}`);

        const senderBKey = BigInt('0x' + MLDSA_B);
        for (let i = nextId - 1; i >= 1; i--) {
            const res = await nsB.getReservation(BigInt(i));
            const p = res.properties || {};
            const statusNames = { 1: 'ACTIVE', 2: 'EXECUTED', 3: 'CANCELLED' };
            console.log(`  Res ${i}: status=${statusNames[Number(p.status)] || Number(p.status)} btc=${Number(p.btcAmount)} token=${(Number(p.tokenAmount || 0) / 1e8).toFixed(4)}`);
            if (Number(p.status) === 1) { // ACTIVE
                resId = BigInt(i);
                btcAmount = BigInt(String(p.btcAmount || 0));
                break;
            }
        }
    } else {
        const res = await nsB.getReservation(resId);
        btcAmount = BigInt(String(res.properties?.btcAmount || 0));
    }

    if (!resId) { console.log('  No active reservation found!'); return; }
    if (btcAmount === 0n) { console.log('  BTC amount is 0!'); return; }

    console.log(`  Executing reservation ${resId} with ${Number(btcAmount)} sats BTC`);

    // Build P2OP for contract (BTC goes to contract)
    const contractScript = buildP2OPScript(NATIVESWAP_HEX);
    const contractP2OP = Address.fromString(NATIVESWAP_PK).p2op(network);

    nsB.setTransactionDetails({
        inputs: [],
        outputs: [{
            to: contractP2OP,
            scriptPubKey: contractScript,
            value: btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
        }],
    });

    const sim = await nsB.executeBuyToken(resId);
    await sendTx(sim, {
        ...TX_PARAMS_B,
        extraOutputs: [{ script: Buffer.from(contractScript), value: btcAmount }],
        maximumAllowedSatToSpend: btcAmount + 150_000n,
    }, 'executeBuyToken');
    console.log('\n  Done! Wait for block, check status for updated reserves + MINE balance.');
}

// ══════════════════════════════════════════════════════════════
// PHASE 3a: Wallet B approve MINE → NativeSwap (for sell)
// ══════════════════════════════════════════════════════════════
async function phase3a() {
    console.log('\n=== PHASE 3a: Wallet B approve MINE → NativeSwap ===\n');
    const senderB = Address.fromString('0x' + MLDSA_B, '0x' + TWEAKED_B);
    const mineB = getContract(MINE, tokenABI, opnetProvider, network, senderB);
    const nativeswapAddr = Address.fromString(NATIVESWAP_PK);

    const MAX_UINT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const sim = await mineB.increaseAllowance(nativeswapAddr, MAX_UINT);
    await sendTx(sim, TX_PARAMS_B, 'increaseAllowance(B MINE→NativeSwap)');
    console.log('\n  Done! Wait for block, then run 3b (sellTokenForBTC).');
}

// ══════════════════════════════════════════════════════════════
// PHASE 3b: Wallet B sellTokenForBTC (sell 5 MINE for BTC)
// ══════════════════════════════════════════════════════════════
async function phase3b() {
    console.log('\n=== PHASE 3b: Wallet B sellTokenForBTC (5 MINE) ===\n');
    const senderB = Address.fromString('0x' + MLDSA_B, '0x' + TWEAKED_B);
    const nsB = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderB);

    const tokenAmount = 5_0000_0000n; // 5 MINE
    const minBtcOut = 1n;             // minimum 1 sat (test mode)

    // First get a quote to know BTC output amount
    const sellerScript = buildP2OPScript(MLDSA_B);
    const sellerP2OP = Address.fromString('0x' + MLDSA_B).p2op(network);

    let btcOutEstimate = 1_000n;
    try {
        const quote = await nsB.getQuoteSellToken(tokenAmount);
        btcOutEstimate = BigInt(String(quote.properties?.btcAmount || 1000));
        console.log(`  Quote: sell 5 MINE → ${Number(btcOutEstimate)} sats BTC`);
    } catch (e) { console.log('  Quote failed:', e.message?.slice(0, 100)); }

    // Set BTC output to SELLER with quoted amount
    nsB.setTransactionDetails({
        inputs: [],
        outputs: [{
            to: sellerP2OP,
            scriptPubKey: sellerScript,
            value: btcOutEstimate,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
        }],
    });

    const sim = await nsB.sellTokenForBTC(tokenAmount, minBtcOut);
    if (sim.calldata) {
        const actualBtcOut = BigInt(String(sim.properties?.btcOut || btcOutEstimate));
        console.log(`  Actual BTC out: ${Number(actualBtcOut)} sats`);
        const finalBtc = actualBtcOut < 330n ? 330n : actualBtcOut;
        await sendTx(sim, {
            ...TX_PARAMS_B,
            extraOutputs: [{ script: Buffer.from(sellerScript), value: finalBtc }],
            maximumAllowedSatToSpend: finalBtc + 150_000n,
        }, 'sellTokenForBTC');
    } else {
        console.log(`  SIM FAIL:`, sim.revert);
    }
    console.log('\n  Done! Wait for block and check status.');
}

// ══════════════════════════════════════════════════════════════
// PHASE 4: Wallet A removeLiquidity (25% of LP shares)
// ══════════════════════════════════════════════════════════════
async function phase4() {
    console.log('\n=== PHASE 4: Wallet A removeLiquidity (25% of shares) ===\n');
    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const nsA = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderA);

    // Get LP position
    const lp = await nsA.liquidityOf(senderA);
    const shares = BigInt(String(lp.properties?.shares || 0));
    if (shares === 0n) { console.log('  No LP shares!'); return; }

    const burnShares = shares / 4n; // withdraw 25%
    console.log(`  Total shares: ${shares}, burning: ${burnShares} (25%)`);

    // BTC goes to LP (Wallet A)
    const lpScript = buildP2OPScript(MLDSA_A);
    const lpP2OP = Address.fromString('0x' + MLDSA_A).p2op(network);

    // Get expected BTC output
    const reserves = await nsA.getReserves();
    const info = await nsA.getPoolInfo();
    const btcReserve = BigInt(String(reserves.properties?.btcReserve || 0));
    const totalShares = BigInt(String(info.properties?.totalShares || 1));
    const expectedBtcOut = (burnShares * btcReserve) / totalShares;
    const btcOut = expectedBtcOut < 330n ? 330n : expectedBtcOut; // dust minimum

    console.log(`  Expected BTC out: ${Number(btcOut)} sats`);

    nsA.setTransactionDetails({
        inputs: [],
        outputs: [{
            to: lpP2OP,
            scriptPubKey: lpScript,
            value: btcOut,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
        }],
    });

    const sim = await nsA.removeLiquidity(burnShares);
    if (sim.calldata) {
        const tp = sim.properties || {};
        console.log(`  Token out: ${(Number(tp.tokenOut || 0) / 1e8).toFixed(4)} MINE`);
        console.log(`  BTC out: ${Number(tp.btcOut || 0)} sats`);

        const actualBtcOut = BigInt(String(tp.btcOut || btcOut));
        await sendTx(sim, {
            ...TX_PARAMS_A,
            extraOutputs: [{ script: Buffer.from(lpScript), value: actualBtcOut < 330n ? 330n : actualBtcOut }],
            maximumAllowedSatToSpend: (actualBtcOut < 330n ? 330n : actualBtcOut) + 150_000n,
        }, 'removeLiquidity');
    }
    console.log('\n  Done! Wait for block and check status.');
}

// ══════════════════════════════════════════════════════════════
// PHASE 5: Wallet A test cancelReservation
// First create a reservation, then immediately cancel it
// ══════════════════════════════════════════════════════════════
async function phase5() {
    console.log('\n=== PHASE 5: Wallet A create + cancel reservation ===\n');
    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const nsA = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderA);

    console.log('  Step 1: Creating test reservation (10,000 sats)...');
    const sim = await nsA.reserveBuyToken(10_000n, 1n);
    if (!sim.calldata) { console.log('  SIM FAIL:', sim.revert); return; }

    const resId = sim.properties?.reservationId;
    console.log(`  Reservation ID: ${resId?.toString()}`);

    const txId = await sendTx(sim, TX_PARAMS_A, 'reserveBuyToken(for cancel)');
    if (!txId) return;

    console.log('\n  Step 2: Wait a moment, then cancel...');
    console.log(`  Run: node deploy/test-nativeswap.mjs 5c ${resId}`);
    console.log('  (Need to wait for block before cancelling)');
}

async function phase5c() {
    const resIdArg = process.argv[3];
    if (!resIdArg) { console.log('Usage: node deploy/test-nativeswap.mjs 5c <reservationId>'); return; }
    console.log(`\n=== PHASE 5c: cancelReservation #${resIdArg} ===\n`);

    const senderA = Address.fromString('0x' + MLDSA_A, '0x' + TWEAKED_A);
    const nsA = getContract(NATIVESWAP, nativeswapABI, opnetProvider, network, senderA);

    const sim = await nsA.cancelReservation(BigInt(resIdArg));
    await sendTx(sim, TX_PARAMS_A, 'cancelReservation');
    console.log('\n  Done! Check status for CANCELLED reservation.');
}

// ══════════════════════════════════════════════════════════════
// Run
// ══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  NativeSwap E2E Test — Phase: ${phase}`);
console.log(`${'═'.repeat(50)}\n`);
console.log('Wallet A:', walletA.p2tr);
console.log('Wallet B:', walletB.p2tr);

const phases = {
    'status': checkStatus,
    '1a': phase1a, '1b': phase1b,
    '2a': phase2a, '2b': phase2b,
    '3a': phase3a, '3b': phase3b,
    '4': phase4,
    '5': phase5, '5c': phase5c,
};
const fn = phases[phase];
if (fn) await fn();
else console.log('Unknown phase:', phase, '\nAvailable:', Object.keys(phases).join(', '));
