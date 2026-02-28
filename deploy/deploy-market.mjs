/**
 * OPNet Hub — Deploy P2PMarket contract
 * Usage: OPNET_MNEMONIC="12 words..." node deploy/deploy-market.mjs
 */
import { Mnemonic, TransactionFactory, ChallengeSolution, OPNetLimitedProvider } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = 'https://testnet.opnet.org';

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);
const wallet = mnemonic.deriveOPWallet(undefined, 0);
console.log('Wallet:', wallet.p2tr);

const provider = new OPNetLimitedProvider(RPC_URL);
const factory = new TransactionFactory();

async function getChallenge() {
    const res = await fetch(`${RPC_URL}/api/v1/json-rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'btc_latestEpoch', params: [], id: 1 }),
        signal: AbortSignal.timeout(12000),
    });
    const { result: e } = await res.json();
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
    const utxos = await provider.fetchUTXO({
        address: wallet.p2tr,
        minAmount: 10000n,
        requestedAmount: 400000n,
    });
    console.log(`UTXOs: ${utxos.length} (${utxos.reduce((a, u) => a + u.value, 0n)} sats)`);
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
console.log('\n=== Deploy P2PMarket ===');
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
    gasSatFee: 100_000n,
    bytecode,
    calldata: new Uint8Array(0),
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey: true,
});

await broadcastPair(result.transaction, 'P2PMarket deployment');

const info = {
    network: 'testnet',
    contract: 'P2PMarket',
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
console.log(`P2PMarket deployed at: ${result.contractAddress}`);
console.log(`Pubkey: ${result.contractPubKey}`);
console.log('Saved to deploy/market-deployed.json');
console.log('================================');
