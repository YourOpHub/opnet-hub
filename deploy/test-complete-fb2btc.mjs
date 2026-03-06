/**
 * Complete Order #2 (FB_TO_BTC) — Wallet A (maker) claims locked BTC
 * Usage: OPNET_MNEMONIC="..." node deploy/test-complete-fb2btc.mjs
 */
import { Mnemonic } from '../node_modules/@btc-vision/transaction/build/index.js';
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

const CONTRACT_ADDRESS = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
const provider = new JSONRpcProvider(RPC_URL, network);

const ABI = [
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

async function waitBlock(maxWait = 600000) {
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
    const ORDER_ID = 2;
    const senderA = getSenderAddr(walletA);
    console.log('Wallet A:', walletA.p2tr);
    console.log('Sender A:', senderA.toString());

    const blockNum = await provider.getBlockNumber();
    console.log('Block:', blockNum);

    const marketView = getContract(CONTRACT_ADDRESS, ABI, provider, network);
    const orderResult = await marketView.getOrder(BigInt(ORDER_ID));
    const p = orderResult.properties;
    console.log('Order #2 status:', Number(p.status), 'direction:', Number(p.direction));
    console.log('Order #2 btcAmount:', Number(p.btcAmount));

    if (Number(p.status) !== 2) {
        console.error('Order not TAKEN, cannot complete');
        process.exit(1);
    }

    // FB_TO_BTC: maker claims BTC → output goes to maker (wallet A)
    const makerMldsaHash = createHash('sha256').update(Buffer.from(walletA.mldsaKeypair.publicKey)).digest().toString('hex');
    const makerScript = buildP2OPScript(makerMldsaHash);
    const btcAmount = BigInt(Number(p.btcAmount));

    const marketA = getContract(CONTRACT_ADDRESS, ABI, provider, network, senderA);
    marketA.setTransactionDetails({
        inputs: [],
        outputs: [{
            value: btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: makerScript,
            to: walletA.p2tr,
        }],
    });

    console.log(`\nSimulating completeOrder(${ORDER_ID})...`);
    const sim = await marketA.completeOrder(BigInt(ORDER_ID));
    if (sim.revert) {
        console.error('REVERT:', sim.revert);
        process.exit(1);
    }
    console.log('Simulation OK!');

    console.log('Sending TX...');
    const result = await sim.sendTransaction({
        signer: walletA.keypair,
        mldsaSigner: walletA.mldsaKeypair,
        refundTo: walletA.p2tr,
        network,
        feeRate: 10,
        priorityFee: BigInt(5000),
        maximumAllowedSatToSpend: btcAmount + 100_000n,
        extraOutputs: [{ script: makerScript, value: Number(btcAmount) }],
    });
    console.log('TX:', JSON.stringify({ transactionId: result.transactionId, peers: result.peerAcknowledgements }));

    console.log('\nWaiting for confirmation...');
    await waitBlock();

    const orderFinal = await marketView.getOrder(BigInt(ORDER_ID));
    const finalStatus = Number(orderFinal.properties?.status);
    console.log('Final status:', finalStatus);
    if (finalStatus === 3) {
        console.log('ORDER #2 COMPLETED! Maker (Wallet A) claimed BTC!');
    } else {
        console.log('Waiting for epoch...');
        await waitBlock();
        const orderFinal2 = await marketView.getOrder(BigInt(ORDER_ID));
        console.log('Status:', Number(orderFinal2.properties?.status));
    }
}

main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
