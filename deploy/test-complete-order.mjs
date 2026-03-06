/**
 * Test completeOrder — Wallet B (taker) claims locked BTC from Order #1
 * Usage: OPNET_MNEMONIC="..." node deploy/test-complete-order.mjs
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

const walletB = mnemonic.deriveOPWallet(undefined, 1);
console.log('Wallet B:', walletB.p2tr);

const CONTRACT_ADDRESS = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';

const provider = new JSONRpcProvider(RPC_URL, network);

// ABI (just completeOrder + getOrder)
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
    bytes[0] = 0x60;
    bytes[1] = 0x20;
    for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
    return Buffer.from(bytes);
}

function getSenderAddr(wallet) {
    const mldsaHash = createHash('sha256').update(Buffer.from(wallet.mldsaKeypair.publicKey)).digest().toString('hex');
    const tweaked = wallet._tweakedKey || wallet.keypair.publicKey;
    return Address.fromString(mldsaHash, Buffer.from(tweaked).toString('hex'));
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
            if (current > startBlock) {
                console.log(`   Block ${current} confirmed!`);
                return;
            }
            const elapsed = Math.round((Date.now() - start) / 1000);
            process.stdout.write(`   Still waiting... (${elapsed}s, block=${current})\r`);
        } catch { /* */ }
    }
    console.log('   Block wait timed out');
}

async function main() {
    const ORDER_ID = 1;
    const senderB = getSenderAddr(walletB);
    console.log('Sender B:', senderB.toString());

    const blockNum = await provider.getBlockNumber();
    console.log('Current block:', blockNum);

    // Read order to verify it's Taken
    const marketView = getContract(CONTRACT_ADDRESS, ABI, provider, network);
    const orderResult = await marketView.getOrder(BigInt(ORDER_ID));
    const p = orderResult.properties;
    console.log('Order #1 status:', Number(p.status), '(expected 2=Taken)');
    console.log('Order #1 btcAmount:', Number(p.btcAmount));

    if (Number(p.status) !== 2) {
        console.error('Order is not in TAKEN status! Cannot complete.');
        process.exit(1);
    }

    // BTC_TO_FB direction: taker claims BTC → output goes to taker (wallet B)
    // Build P2OP script for wallet B's MLDSA hash (SHA256 of full pubkey)
    const takerMldsaHash = createHash('sha256').update(Buffer.from(walletB.mldsaKeypair.publicKey)).digest().toString('hex');
    console.log('Taker MLDSA hash:', takerMldsaHash);
    const takerScript = buildP2OPScript(takerMldsaHash);

    const btcAmount = BigInt(Number(p.btcAmount));

    // Set transaction details for simulation
    const marketB = getContract(CONTRACT_ADDRESS, ABI, provider, network, senderB);
    marketB.setTransactionDetails({
        inputs: [],
        outputs: [{
            value: btcAmount,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: takerScript,
            to: walletB.p2tr,
        }],
    });

    console.log(`\nSimulating completeOrder(${ORDER_ID})...`);
    const sim = await marketB.completeOrder(BigInt(ORDER_ID));
    if (sim.revert) {
        console.error('COMPLETE REVERT:', sim.revert);
        process.exit(1);
    }
    console.log('Simulation OK!');

    console.log('Sending completeOrder TX...');
    const txParams = {
        signer: walletB.keypair,
        mldsaSigner: walletB.mldsaKeypair,
        refundTo: walletB.p2tr,
        network,
        feeRate: 10,
        priorityFee: BigInt(5000),
        maximumAllowedSatToSpend: btcAmount + 100_000n,
        extraOutputs: [{ script: takerScript, value: Number(btcAmount) }],
    };
    const result = await sim.sendTransaction(txParams);
    console.log('TX result:', JSON.stringify({
        transactionId: result.transactionId,
        peerAcknowledgements: result.peerAcknowledgements,
    }));

    console.log('\nWaiting for confirmation...');
    await waitBlock();

    // Check final status
    const orderFinal = await marketView.getOrder(BigInt(ORDER_ID));
    const finalStatus = Number(orderFinal.properties?.status);
    console.log('Order #1 final status:', finalStatus);
    if (finalStatus === 3) {
        console.log('ORDER COMPLETED! BTC claimed by taker.');
    } else {
        console.log('Status not yet 3, waiting for epoch...');
        // Wait for more blocks
        await waitBlock();
        const orderFinal2 = await marketView.getOrder(BigInt(ORDER_ID));
        console.log('Order #1 status after 2nd wait:', Number(orderFinal2.properties?.status));
    }
}

main().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
