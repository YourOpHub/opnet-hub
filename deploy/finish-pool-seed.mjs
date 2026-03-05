/**
 * Finish SimplePool seeding — transfer VIBE + call sync()
 * Pool already deployed and MINE transferred. Just need VIBE + sync.
 */
import { Mnemonic, TransactionFactory, ChallengeSolution, OPNetLimitedProvider, BinaryWriter, Address } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';

const RPC_URL = 'https://testnet.opnet.org';

const VIBE_ADDRESS = 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl';
const VIBE_HEX = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';

// New pool address from deploy
const POOL_ADDRESS = 'opt1sqplvfq5ytgtwzes6tc4ys77f90279rsz8q4dg7ex';
const POOL_PUBKEY = '0xcc89d6c4764ed98b097860c5d8bc6b5432ece5ef11aa3eb7d9b8d65de5262bdc';
const POOL_HEX = 'cc89d6c4764ed98b097860c5d8bc6b5432ece5ef11aa3eb7d9b8d65de5262bdc';

// Smaller seed: 25M VIBE to match 5M MINE (1:5 ratio)
const VIBE_LIQUIDITY = 25_000_000n * 100_000_000n;
const TRANSFER_SELECTOR = 0x3b88ef57;
const SYNC_SELECTOR = 0x4ffcd515;

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);
const wallet = mnemonic.deriveOPWallet(undefined, 0);
console.log('Wallet:', wallet.p2tr);

const provider = new OPNetLimitedProvider(RPC_URL);
const factory = new TransactionFactory();

async function getChallenge() {
    const res = await fetch(`${RPC_URL}/api/v1/json-rpc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'btc_latestEpoch', params: [], id: 1 }),
        signal: AbortSignal.timeout(12000),
    });
    const { result: e } = await res.json();
    console.log('Epoch:', e.epochNumber);
    return new ChallengeSolution({
        epochNumber: e.epochNumber,
        mldsaPublicKey: e.proposer.mldsaPublicKey,
        legacyPublicKey: e.proposer.legacyPublicKey,
        solution: e.proposer.solution, salt: e.proposer.salt, graffiti: e.proposer.graffiti,
        difficulty: Number(e.difficultyScaled),
        verification: { epochHash: e.epochHash, epochRoot: e.epochRoot, targetHash: e.targetHash, targetChecksum: e.targetHash, startBlock: e.startBlock, endBlock: e.endBlock, proofs: e.proofs },
    });
}

async function broadcastInteraction(result, label) {
    if (result.fundingTransaction) {
        console.log(`Broadcasting ${label} funding...`);
        const b1 = await provider.broadcastTransaction(result.fundingTransaction, false);
        console.log('   Funding:', JSON.stringify(b1));
        await new Promise(r => setTimeout(r, 3000));
    }
    console.log(`Broadcasting ${label}...`);
    const b2 = await provider.broadcastTransaction(result.interactionTransaction, false);
    console.log('   Result:', JSON.stringify(b2));
    return b2;
}

const step = process.argv[2] || 'vibe';

if (step === 'vibe') {
    console.log('\n=== Transfer VIBE to pool ===');
    const challenge = await getChallenge();
    const utxos = await provider.fetchUTXO({ address: wallet.p2tr, minAmount: 5000n, requestedAmount: 200000n });
    console.log(`UTXOs: ${utxos.length} (${utxos.reduce((a, u) => a + u.value, 0n)} sats)`);

    const w = new BinaryWriter();
    w.writeSelector(TRANSFER_SELECTOR);
    w.writeAddress(Address.fromString(POOL_PUBKEY));
    w.writeU256(VIBE_LIQUIDITY);

    const result = await factory.signInteraction({
        signer: wallet.keypair, mldsaSigner: wallet.mldsaKeypair, network, utxos,
        from: wallet.p2tr, to: VIBE_ADDRESS, contract: VIBE_HEX,
        calldata: w.getBuffer(), feeRate: 1, priorityFee: 500n, gasSatFee: 10_000n,
        challenge, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: true,
    });
    await broadcastInteraction(result, 'VIBE transfer');
    console.log('VIBE transferred to pool');

} else if (step === 'sync') {
    console.log('\n=== Call sync() on pool ===');
    const challenge = await getChallenge();
    const utxos = await provider.fetchUTXO({ address: wallet.p2tr, minAmount: 5000n, requestedAmount: 200000n });
    console.log(`UTXOs: ${utxos.length} (${utxos.reduce((a, u) => a + u.value, 0n)} sats)`);

    const w = new BinaryWriter();
    w.writeSelector(SYNC_SELECTOR);

    const result = await factory.signInteraction({
        signer: wallet.keypair, mldsaSigner: wallet.mldsaKeypair, network, utxos,
        from: wallet.p2tr, to: POOL_ADDRESS, contract: POOL_HEX,
        calldata: w.getBuffer(), feeRate: 1, priorityFee: 500n, gasSatFee: 10_000n,
        challenge, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: true,
    });
    await broadcastInteraction(result, 'sync()');
    console.log('sync() called — reserves set');
}
