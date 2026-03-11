#!/usr/bin/env node
/**
 * Fund Wallet B with 0.02 BTC from Wallet A.
 * Uses LOW-LEVEL SDK (TransactionFactory) with address-based extraOutputs.
 * This creates standard P2TR outputs (OP_1) that are spendable as UTXOs.
 *
 * P2OP outputs (OP_16) are NOT standard UTXOs — they can't be used for gas.
 */
import crypto from 'crypto';
import {
    Mnemonic, TransactionFactory, ChallengeSolution,
    OPNetLimitedProvider, BinaryWriter,
} from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const RPC_URL = 'https://testnet.opnet.org';
const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const mnemonic = new Mnemonic(phrase, '', network);
const walletA = mnemonic.deriveOPWallet(undefined, 0);
const walletB = mnemonic.deriveOPWallet(undefined, 1);

console.log('Wallet A (sender):', walletA.p2tr);
console.log('Wallet B (receiver):', walletB.p2tr);

const provider = new OPNetLimitedProvider(RPC_URL);
const factory = new TransactionFactory();

async function rpcCall(method, params = []) {
    const res = await fetch(`${RPC_URL}/api/v1/json-rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.result;
}

async function getChallenge() {
    const e = await rpcCall('btc_latestEpoch');
    return new ChallengeSolution({
        epochNumber: e.epochNumber,
        mldsaPublicKey: e.proposer.mldsaPublicKey,
        legacyPublicKey: e.proposer.legacyPublicKey,
        solution: e.proposer.solution,
        salt: e.proposer.salt,
        graffiti: e.proposer.graffiti,
        difficulty: Number(e.difficultyScaled),
        verification: {
            epochHash: e.epochHash, epochRoot: e.epochRoot,
            targetHash: e.targetHash, targetChecksum: e.targetHash,
            startBlock: e.startBlock, endBlock: e.endBlock, proofs: e.proofs,
        },
    });
}

// MINE token — use a dummy publicMint call as carrier for the BTC transfer
const MINE_ADDR = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
const SEL_publicMint = 0x94d0d1a5;

// Build dummy calldata (publicMint 1 token — may fail but that's OK, we just need the carrier TX)
const w = new BinaryWriter();
w.writeSelector(SEL_publicMint);
w.writeU256(1n);
const calldata = new Uint8Array(w.getBuffer());

const SEND_AMOUNT = 2_000_000n; // 0.02 BTC

console.log(`\nSending ${Number(SEND_AMOUNT)} sats (${Number(SEND_AMOUNT) / 1e8} BTC) to Wallet B via P2TR...\n`);

console.log('Fetching UTXOs for Wallet A...');
const utxos = await provider.fetchUTXO({
    address: walletA.p2tr,
    minAmount: 10000n,
    requestedAmount: SEND_AMOUNT + 200000n,
});
const totalUtxo = utxos.reduce((a, u) => a + u.value, 0n);
console.log(`  UTXOs: ${utxos.length} (${totalUtxo} sats = ${Number(totalUtxo) / 1e8} BTC)`);

if (totalUtxo < SEND_AMOUNT + 100_000n) {
    console.error(`Insufficient BTC: ${totalUtxo} sats (need ${SEND_AMOUNT + 100_000n})`);
    process.exit(1);
}

const challenge = await getChallenge();
console.log('Challenge OK, signing...');

const result = await factory.signInteraction({
    signer: walletA.keypair,
    mldsaSigner: walletA.mldsaKeypair,
    network,
    utxos,
    from: walletA.p2tr,
    to: MINE_ADDR,
    contract: MINE_HEX,
    calldata,
    feeRate: 10,
    priorityFee: 5000n,
    gasSatFee: 100_000n,
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey: true,
    // KEY: Use address format to create standard P2TR output (NOT P2OP script)
    extraOutputs: [{
        address: walletB.p2tr,
        value: SEND_AMOUNT,
    }],
});

if (result.fundingTransaction) {
    console.log('Broadcasting funding tx...');
    const b1 = await provider.broadcastTransaction(result.fundingTransaction, false);
    console.log('  Funding:', JSON.stringify(b1));
    await new Promise(r => setTimeout(r, 2000));
}

console.log('Broadcasting interaction tx...');
const b2 = await provider.broadcastTransaction(result.interactionTransaction, false);
console.log('  Result:', JSON.stringify(b2));
console.log(`\nDone! Sent ${Number(SEND_AMOUNT) / 1e8} BTC (${Number(SEND_AMOUNT)} sats) to Wallet B.`);
console.log('Wait for next block (~5-15 min) to see updated balance.');
