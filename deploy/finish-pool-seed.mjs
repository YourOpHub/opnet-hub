/**
 * Finish SimplePool seeding — transfer VIBE + call sync()
 * Pool already deployed and MINE transferred. Just need VIBE + sync.
 */
import { Mnemonic, TransactionFactory, ChallengeSolution, OPNetLimitedProvider, BinaryWriter, Address } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';

const RPC_URL = 'https://testnet.opnet.org';

const MINE_ADDRESS = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
const VIBE_ADDRESS = 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl';
const VIBE_HEX = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';

// New pool address from deploy
const POOL_ADDRESS = 'opt1sqz6acsz9tkyfzzlg337x35swysmtp4u8kye8u2pv';
const POOL_PUBKEY = '0xb4c67df83e48afab333c1c9d0a9120924bd99342f6c1ecf2a1d42bf6db8d393e';
const POOL_HEX = 'b4c67df83e48afab333c1c9d0a9120924bd99342f6c1ecf2a1d42bf6db8d393e';

// Seed amounts
const MINE_LIQUIDITY = 500_000n * 100_000_000n;  // 500K MINE (reduced, low on sats)
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

const step = process.argv[2] || 'mine';

if (step === 'mine') {
    console.log('\n=== Transfer MINE to pool ===');
    const challenge = await getChallenge();
    const utxos = await provider.fetchUTXO({ address: wallet.p2tr, minAmount: 5000n, requestedAmount: 200000n });
    console.log(`UTXOs: ${utxos.length} (${utxos.reduce((a, u) => a + u.value, 0n)} sats)`);

    const w = new BinaryWriter();
    w.writeSelector(TRANSFER_SELECTOR);
    w.writeAddress(Address.fromString(POOL_PUBKEY));
    w.writeU256(MINE_LIQUIDITY);

    const result = await factory.signInteraction({
        signer: wallet.keypair, mldsaSigner: wallet.mldsaKeypair, network, utxos,
        from: wallet.p2tr, to: MINE_ADDRESS, contract: MINE_HEX,
        calldata: w.getBuffer(), feeRate: 1, priorityFee: 500n, gasSatFee: 5_000n,
        challenge, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: true,
    });
    await broadcastInteraction(result, 'MINE transfer');
    console.log('MINE transferred to pool');

} else if (step === 'vibe') {
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

} else if (step === 'fund-staking') {
    const STAKING_ADDRESS = 'opt1sqzfsz6csap8jpv8ueac5n2u0vx2a85epuyk9ez5c';
    const STAKING_PUBKEY = '0x6b92dfca57e7415b6e89868ee1e2c51dcda8f8b4bf9a28b19900e1bfba2121ae';
    const STAKING_HEX = '6b92dfca57e7415b6e89868ee1e2c51dcda8f8b4bf9a28b19900e1bfba2121ae';
    const REWARD_AMOUNT = 500_000n * 100_000_000n; // 500K MINE for rewards

    console.log('\n=== Fund SimpleStaking v3 with MINE rewards ===');
    const challenge = await getChallenge();
    const utxos = await provider.fetchUTXO({ address: wallet.p2tr, minAmount: 5000n, requestedAmount: 200000n });
    console.log(`UTXOs: ${utxos.length} (${utxos.reduce((a, u) => a + u.value, 0n)} sats)`);

    const w = new BinaryWriter();
    w.writeSelector(TRANSFER_SELECTOR);
    w.writeAddress(Address.fromString(STAKING_PUBKEY));
    w.writeU256(REWARD_AMOUNT);

    const result = await factory.signInteraction({
        signer: wallet.keypair, mldsaSigner: wallet.mldsaKeypair, network, utxos,
        from: wallet.p2tr, to: MINE_ADDRESS, contract: MINE_HEX,
        calldata: w.getBuffer(), feeRate: 1, priorityFee: 500n, gasSatFee: 5_000n,
        challenge, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: true,
    });
    await broadcastInteraction(result, 'MINE → Staking rewards');
    console.log(`${Number(REWARD_AMOUNT / 100_000_000n)}M MINE transferred to staking for rewards`);

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
