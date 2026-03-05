/**
 * OPNet Hub — Deploy NativeSwapPool contract
 * Constructor calldata: token address (32 bytes)
 *
 * Usage: OPNET_MNEMONIC="12 words..." node deploy/deploy-nativeswap.mjs [tokenPubkey]
 * Default token: MINE
 */
import { Mnemonic, TransactionFactory, ChallengeSolution, OPNetLimitedProvider } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks, fromBase64 } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = 'https://testnet.opnet.org';
const RPC = `${RPC_URL}/api/v1/json-rpc`;

// Default: MINE token pubkey
const TOKEN_PUBKEY = process.argv[2] || 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);
const wallet = mnemonic.deriveOPWallet(undefined, 0);
console.log('Wallet:', wallet.p2tr);
console.log('Token pubkey:', TOKEN_PUBKEY);

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
    const data = await rpc('btc_getUTXOs', [wallet.p2tr, false, false, true]);
    const allUtxos = [...(data.confirmed || []), ...(data.pending || [])];
    const spentSet = new Set((data.spentTransactions || []).map(s => `${s.transactionId}:${s.outputIndex}`));
    const unspent = allUtxos.filter(u => !spentSet.has(`${u.transactionId}:${u.outputIndex}`));

    if (unspent.length === 0) throw new Error('No UTXOs available');

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

// ══════════════════════════════════════════════════════════════════
// Deploy NativeSwapPool with token address as constructor calldata
// ══════════════════════════════════════════════════════════════════
console.log('\n=== Deploy NativeSwapPool ===');
const challenge = await getChallenge();
const utxos = await getUTXOs();

const bytecode = new Uint8Array(readFileSync(join(__dirname, 'OP_20/build/NativeSwapPool.wasm')));
console.log(`NativeSwapPool WASM: ${bytecode.length} bytes`);

// Constructor calldata: token address (32 bytes, hex to bytes)
const tokenBytes = new Uint8Array(32);
const cleanHex = TOKEN_PUBKEY.replace('0x', '');
for (let i = 0; i < 32; i++) {
    tokenBytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
}

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
    calldata: tokenBytes,
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey: true,
});

await broadcastPair(result.transaction, 'NativeSwapPool deployment');

const info = {
    network: 'testnet',
    contract: 'NativeSwapPool',
    address: result.contractAddress,
    pubkey: result.contractPubKey,
    token: TOKEN_PUBKEY,
    deployedAt: new Date().toISOString(),
};

writeFileSync(join(__dirname, 'nativeswap-deployed.json'), JSON.stringify(info, null, 2));
console.log('\n================================');
console.log(`NativeSwapPool deployed at: ${result.contractAddress}`);
console.log(`Pubkey: ${result.contractPubKey}`);
console.log('Saved to deploy/nativeswap-deployed.json');
console.log('================================');
