/**
 * OPNet Hub — Deploy P2PMarket contract (v8 — fixed BTC payment verification)
 * Usage: OPNET_MNEMONIC="12 words..." node deploy/deploy-market.mjs
 */
import { Mnemonic, TransactionFactory, ChallengeSolution, OPNetLimitedProvider } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks, fromBase64 } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = 'https://testnet.opnet.org';
const RPC = `${RPC_URL}/api/v1/json-rpc`;

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);
const wallet = mnemonic.deriveOPWallet(undefined, 0);
console.log('Wallet:', wallet.p2tr);

const provider = new OPNetLimitedProvider(RPC_URL);
const factory = new TransactionFactory();

async function rpc(method, params = []) {
    const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
}

async function getChallenge() {
    const e = await rpc('btc_latestEpoch');
    console.log('Epoch:', e.epochNumber);
    return new ChallengeSolution({
        epochNumber: e.epochNumber,
        mldsaPublicKey: e.proposer.mldsaPublicKey,
        legacyPublicKey: e.proposer.legacyPublicKey,
        solution: e.proposer.solution,
        salt: e.proposer.salt,
        graffiti: e.proposer.graffiti,
        difficulty: Number(e.difficultyScaled),
        verification: {
            epochHash: e.epochHash,
            epochRoot: e.epochRoot,
            targetHash: e.targetHash,
            targetChecksum: e.targetHash,
            startBlock: e.startBlock,
            endBlock: e.endBlock,
            proofs: e.proofs,
        },
    });
}

async function getUTXOs() {
    // Use JSON-RPC to fetch UTXOs (REST API returns empty for opt1 addresses)
    const data = await rpc('btc_getUTXOs', [wallet.p2tr, false, false, true]);
    const allUtxos = [...(data.confirmed || []), ...(data.pending || [])];
    const spentSet = new Set((data.spentTransactions || []).map(s => `${s.transactionId}:${s.outputIndex}`));
    const unspent = allUtxos.filter(u => !spentSet.has(`${u.transactionId}:${u.outputIndex}`));

    if (unspent.length === 0) throw new Error('No UTXOs available');

    // Build UTXO objects compatible with TransactionFactory
    const rawTxns = data.raw || [];
    const utxos = [];
    for (const u of unspent) {
        const rawIdx = Number(u.raw);
        if (rawIdx >= 0 && rawIdx < rawTxns.length) {
            utxos.push({
                transactionId: u.transactionId,
                outputIndex: u.outputIndex,
                value: BigInt(u.value),
                scriptPubKey: u.scriptPubKey,
                nonWitnessUtxo: fromBase64(rawTxns[rawIdx]),
            });
        }
    }

    const total = utxos.reduce((a, u) => a + u.value, 0n);
    console.log(`UTXOs: ${utxos.length} (${total} sats)`);
    return utxos;
}

async function broadcastPair(txs, label) {
    console.log(`Broadcasting ${label} funding tx...`);
    const b1 = await provider.broadcastTransaction(txs[0], false);
    console.log('   Funding:', JSON.stringify(b1));
    await new Promise(r => setTimeout(r, 3000));
    console.log(`Broadcasting ${label} tx...`);
    const b2 = await provider.broadcastTransaction(txs[1], false);
    console.log('   Result:', JSON.stringify(b2));
    return b2;
}

// ══════════════════════════════════════════════════════════════════════════════
// Deploy P2PMarket.wasm (no constructor calldata needed — onDeployment sets nextOrderId=1)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== Deploy P2PMarket v8 ===');
const challenge = await getChallenge();
const utxos = await getUTXOs();

const bytecode = new Uint8Array(readFileSync(join(__dirname, 'OP_20/build/P2PMarket.wasm')));
console.log(`P2PMarket WASM: ${bytecode.length} bytes`);

const result = await factory.signDeployment({
    signer: wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    network,
    utxos,
    from: wallet.p2tr,
    feeRate: 2,
    priorityFee: 1000n,
    gasSatFee: 10_000n,
    bytecode,
    calldata: new Uint8Array(0),
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey: true,
});

await broadcastPair(result.transaction, 'P2PMarket v8 deployment');

const info = {
    network: 'testnet',
    contract: 'P2PMarket v8',
    address: result.contractAddress,
    pubkey: result.contractPubKey,
    selectors: {
        createSellOrder: '0x35db31a0',
        fillSellOrder: '0x8d7e1c91',
        createBuyOrder: '0x310ce017',
        acceptBuyOrder: '0x9736c4d9',
        executeBuyOrder: '0x1e08843b',
        cancelOrder: '0xeb5aa830',
        getOrder: '0xe9489555',
        getNextOrderId: '0xf4920cae',
    },
    deployedAt: new Date().toISOString(),
};

writeFileSync(join(__dirname, 'market-deployed.json'), JSON.stringify(info, null, 2));
console.log('\n================================');
console.log(`P2PMarket v8 deployed at: ${result.contractAddress}`);
console.log(`Pubkey: ${result.contractPubKey}`);
console.log('Saved to deploy/market-deployed.json');
console.log('================================');
