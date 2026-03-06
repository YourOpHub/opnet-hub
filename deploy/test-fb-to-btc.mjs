/**
 * Test FB_TO_BTC direction — Wallet A creates "sell FB, want BTC", Wallet B takes (locks BTC + fee)
 * Then Wallet A completes (claims BTC)
 * Usage: OPNET_MNEMONIC="..." node deploy/test-fb-to-btc.mjs
 */
import { Mnemonic, OPNetLimitedProvider } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { createHash } from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getContract, JSONRpcProvider, ABIDataTypes, BitcoinAbiTypes, TransactionOutputFlags } = require('opnet');
const { Address } = require('@btc-vision/transaction');

const RPC_URL = 'https://testnet.opnet.org';
const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);

const walletA = mnemonic.deriveOPWallet(undefined, 0);
const walletB = mnemonic.deriveOPWallet(undefined, 1);
console.log('Wallet A:', walletA.p2tr);
console.log('Wallet B:', walletB.p2tr);

const CONTRACT_ADDRESS = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
const CONTRACT_PUBKEY = '0x526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';
const DEPLOYER_MLDSA_HEX = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';

const provider = new JSONRpcProvider(RPC_URL, network);

const ABI = [
    {
        name: 'createOrder', type: BitcoinAbiTypes.Function,
        inputs: [
            { name: 'direction', type: ABIDataTypes.UINT256 },
            { name: 'btcAmount', type: ABIDataTypes.UINT256 },
            { name: 'wantAmount', type: ABIDataTypes.UINT256 },
            { name: 'expiry', type: ABIDataTypes.UINT256 },
            { name: 'fractalAddr', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'takeOrder', type: BitcoinAbiTypes.Function,
        inputs: [
            { name: 'orderId', type: ABIDataTypes.UINT256 },
            { name: 'takerAddr', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'completeOrder', type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'getOrder', type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
        outputs: [
            { name: 'direction', type: ABIDataTypes.UINT256 },
            { name: 'status', type: ABIDataTypes.UINT256 },
            { name: 'creator', type: ABIDataTypes.UINT256 },
            { name: 'taker', type: ABIDataTypes.UINT256 },
            { name: 'btcAmount', type: ABIDataTypes.UINT256 },
            { name: 'wantAmount', type: ABIDataTypes.UINT256 },
            { name: 'expiry', type: ABIDataTypes.UINT256 },
            { name: 'makerAddr', type: ABIDataTypes.UINT256 },
            { name: 'takerAddr', type: ABIDataTypes.UINT256 },
            { name: 'feePaid', type: ABIDataTypes.UINT256 },
        ],
    },
    {
        name: 'getNextOrderId', type: BitcoinAbiTypes.Function,
        inputs: [],
        outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }],
    },
];

function buildP2OPScript(mldsaHex) {
    const bytes = new Uint8Array(34);
    bytes[0] = 0x60; bytes[1] = 0x20;
    for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
    return Buffer.from(bytes);
}

function getSenderAddr(wallet) {
    const mldsaHash = createHash('sha256').update(Buffer.from(wallet.mldsaKeypair.publicKey)).digest().toString('hex');
    const tweaked = wallet._tweakedKey || wallet.keypair.publicKey;
    return Address.fromString(mldsaHash, Buffer.from(tweaked).toString('hex'));
}

function getMLDSAHashHex(wallet) {
    return createHash('sha256').update(Buffer.from(wallet.mldsaKeypair.publicKey)).digest().toString('hex');
}

function stringToU256(str) {
    const bytes = new TextEncoder().encode(str);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    let val = 0n;
    for (let i = 0; i < 32; i++) val = (val << 8n) | BigInt(padded[i]);
    return val;
}

async function waitBlock(maxWait = 480000) {
    const start = Date.now();
    let startBlock;
    try { startBlock = await provider.getBlockNumber(); } catch { return; }
    console.log(`   Waiting for block > ${startBlock}...`);
    while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 15000));
        try {
            const current = await provider.getBlockNumber();
            if (current > startBlock) { console.log(`   Block ${current} confirmed!`); return; }
            const elapsed = Math.round((Date.now() - start) / 1000);
            process.stdout.write(`   Still waiting... (${elapsed}s, block=${current})\r`);
        } catch {}
    }
    console.log('   Block wait timed out');
}

async function main() {
    const senderA = getSenderAddr(walletA);
    const senderB = getSenderAddr(walletB);
    const blockNum = await provider.getBlockNumber();
    console.log('Block:', blockNum);
    console.log('Sender A:', senderA.toString());
    console.log('Sender B:', senderB.toString());

    const contractMldsaHex = CONTRACT_PUBKEY.replace('0x', '');
    const contractP2OP = buildP2OPScript(contractMldsaHex);
    const feeScript = buildP2OPScript(DEPLOYER_MLDSA_HEX);

    const buildTx = async (wallet, maxSpend = 200_000n) => ({
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        refundTo: wallet.p2tr,
        network,
        feeRate: 10,
        priorityFee: BigInt(5000),
        maximumAllowedSatToSpend: BigInt(maxSpend),
    });

    // ═══════════════════════════════════════
    // FB_TO_BTC: Wallet A creates "sell FB, want BTC"
    // No BTC lock on create — just intent
    // ═══════════════════════════════════════
    console.log('\n═══════════════════════════════════════');
    console.log('TEST: FB_TO_BTC — Create Order (Wallet A)');
    console.log('═══════════════════════════════════════');

    const btcAmount = 2000n;
    const wantAmount = 2000n;
    const expiry = BigInt(Number(blockNum) + 200);
    const fractalAddr = stringToU256('tb1qmaker_a_fb_addr');

    // FB_TO_BTC: NO BTC lock on create, so NO extraOutput to contract
    const marketA = getContract(CONTRACT_ADDRESS, ABI, provider, network, senderA);

    console.log('Simulating createOrder (FB_TO_BTC, direction=2)...');
    const simCreate = await marketA.createOrder(2n, btcAmount, wantAmount, expiry, fractalAddr);
    if (simCreate.revert) {
        console.error('CREATE REVERT:', simCreate.revert);
        process.exit(1);
    }
    console.log('Simulation OK! Order ID:', simCreate.properties?.orderId?.toString());

    console.log('Sending createOrder TX...');
    const txA = await buildTx(walletA);
    const createResult = await simCreate.sendTransaction(txA);
    console.log('TX:', JSON.stringify({ transactionId: createResult.transactionId, peers: createResult.peerAcknowledgements }));

    console.log('\nWaiting for confirmation...');
    await waitBlock();

    // Verify
    const marketView = getContract(CONTRACT_ADDRESS, ABI, provider, network);
    const nextIdResult = await marketView.getNextOrderId();
    const nextId = Number(nextIdResult.properties?.nextOrderId ?? 1n);
    const orderId = nextId - 1;
    console.log('Next order ID:', nextId, '→ created order #' + orderId);

    const orderResult = await marketView.getOrder(BigInt(orderId));
    const p = orderResult.properties;
    console.log('Status:', Number(p.status), 'Direction:', Number(p.direction), 'BTC:', Number(p.btcAmount));

    if (Number(p.status) !== 1 || Number(p.direction) !== 2) {
        console.error('ERROR: order not created correctly');
        process.exit(1);
    }
    console.log('Order #' + orderId + ' is OPEN (FB_TO_BTC)');

    // ═══════════════════════════════════════
    // TAKE: Wallet B takes — LOCKS BTC in contract + pays fee
    // ═══════════════════════════════════════
    console.log('\n--- Taking order with Wallet B (locking BTC + fee) ---');
    const marketB = getContract(CONTRACT_ADDRESS, ABI, provider, network, senderB);
    const takerAddr = stringToU256('tb1qtaker_b_fb_addr');
    const feeSats = (btcAmount * 100n) / 10000n;
    const actualFee = feeSats < 330n ? 330n : feeSats;

    // FB_TO_BTC: taker locks BTC in contract AND pays fee
    marketB.setTransactionDetails({
        inputs: [],
        outputs: [
            {
                value: btcAmount,
                index: 1,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: contractP2OP,
                to: CONTRACT_ADDRESS,
            },
            {
                value: actualFee,
                index: 2,
                flags: TransactionOutputFlags.hasScriptPubKey,
                scriptPubKey: feeScript,
                to: 'opt1sfjnexj8d35sut49m4nw7nljwk7ctpvhdf906s8j5t40mc764ft4qptud3g',
            },
        ],
    });

    console.log(`Simulating takeOrder (BTC lock: ${btcAmount}, fee: ${actualFee})...`);
    const simTake = await marketB.takeOrder(BigInt(orderId), takerAddr);
    if (simTake.revert) {
        console.error('TAKE REVERT:', simTake.revert);
        process.exit(1);
    }
    console.log('Simulation OK!');

    console.log('Sending takeOrder TX...');
    const txB = await buildTx(walletB, 200_000n);
    txB.extraOutputs = [
        { script: contractP2OP, value: Number(btcAmount) },
        { script: feeScript, value: Number(actualFee) },
    ];
    txB.maximumAllowedSatToSpend = btcAmount + actualFee + 100_000n;
    const takeResult = await simTake.sendTransaction(txB);
    console.log('TX:', JSON.stringify({ transactionId: takeResult.transactionId, peers: takeResult.peerAcknowledgements }));

    console.log('\nWaiting for confirmation...');
    await waitBlock();

    const orderAfterTake = await marketView.getOrder(BigInt(orderId));
    const statusAfterTake = Number(orderAfterTake.properties?.status);
    console.log('Status after take:', statusAfterTake);
    if (statusAfterTake !== 2) {
        console.error('ERROR: expected status 2 (Taken), got', statusAfterTake);
        process.exit(1);
    }
    console.log('Order #' + orderId + ' is TAKEN');

    // ═══════════════════════════════════════
    // COMPLETE: Wallet A (maker) claims BTC
    // FB_TO_BTC: maker sent FB off-chain → maker claims BTC
    // ═══════════════════════════════════════
    console.log('\n--- Completing order with Wallet A (claiming locked BTC) ---');
    const marketA2 = getContract(CONTRACT_ADDRESS, ABI, provider, network, senderA);
    const makerMldsaHash = getMLDSAHashHex(walletA);
    const makerScript = buildP2OPScript(makerMldsaHash);

    marketA2.setTransactionDetails({
        inputs: [],
        outputs: [{
            value: btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: makerScript,
            to: walletA.p2tr,
        }],
    });

    console.log('Simulating completeOrder...');
    const simComplete = await marketA2.completeOrder(BigInt(orderId));
    if (simComplete.revert) {
        console.error('COMPLETE REVERT:', simComplete.revert);
        process.exit(1);
    }
    console.log('Simulation OK!');

    console.log('Sending completeOrder TX...');
    const txA2 = await buildTx(walletA);
    txA2.extraOutputs = [{ script: makerScript, value: Number(btcAmount) }];
    txA2.maximumAllowedSatToSpend = btcAmount + 100_000n;
    const completeResult = await simComplete.sendTransaction(txA2);
    console.log('TX:', JSON.stringify({ transactionId: completeResult.transactionId, peers: completeResult.peerAcknowledgements }));

    console.log('\nWaiting for confirmation...');
    await waitBlock();

    const orderFinal = await marketView.getOrder(BigInt(orderId));
    const finalStatus = Number(orderFinal.properties?.status);
    console.log('Final status:', finalStatus);
    if (finalStatus === 3) {
        console.log('ORDER COMPLETED! Maker (Wallet A) claimed BTC!');
    } else {
        console.log('Waiting for epoch finalization...');
        await waitBlock();
        const orderFinal2 = await marketView.getOrder(BigInt(orderId));
        console.log('Status after 2nd wait:', Number(orderFinal2.properties?.status));
    }

    console.log('\n═══════════════════════════════════════');
    console.log('FB_TO_BTC FULL CYCLE TEST COMPLETE');
    console.log('═══════════════════════════════════════');
}

main().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
