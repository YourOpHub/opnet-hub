#!/usr/bin/env node
/**
 * Fund Wallet B with 0.02 BTC from Wallet A.
 * Uses HIGH-LEVEL SDK (opnet getContract + sendTransaction) with script-based extraOutputs.
 * Piggybacks on a MINE publicMint(1) call as carrier transaction.
 *
 * P2TR script: [OP_1(0x51), PUSH32(0x20), <tweaked_pubkey>] = 34 bytes.
 * extraOutputs MUST use { script: Buffer, value: bigint } — NOT { address, value }.
 */
import { createHash } from 'crypto';
import { Mnemonic, Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract } from 'opnet';

const RPC_URL = 'https://testnet.opnet.org';
const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };

const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const mnemonic = new Mnemonic(phrase, '', network);
const walletA = mnemonic.deriveOPWallet(undefined, 0);
const walletB = mnemonic.deriveOPWallet(undefined, 1);

// Address.fromString needs (sha256(mldsaPubKey), tweakedKey)
const hashA = createHash('sha256').update(Buffer.from(walletA.mldsaKeypair.publicKey)).digest().toString('hex');
const tweakA = Buffer.from(walletA._tweakedKey).toString('hex');
const addrA = Address.fromString(hashA, tweakA);

console.log('Wallet A (sender):', walletA.p2tr);
console.log('Wallet B (receiver):', walletB.p2tr);

// P2TR scriptPubKey: OP_1 PUSH32 <tweaked_key>
function p2trScript(tweakedKey) {
    const buf = new Uint8Array(34);
    buf[0] = 0x51; // OP_1
    buf[1] = 0x20; // PUSH 32 bytes
    buf.set(new Uint8Array(tweakedKey), 2);
    return Buffer.from(buf);
}

const receiverScript = p2trScript(walletB._tweakedKey);
console.log('Receiver P2TR script:', receiverScript.toString('hex'));

// ─── ABI ──────────────────────────────────────────────────────────────────────
const TOKEN_ABI = [
    { name: 'publicMint', inputs: [{ name: 'amount', type: 'UINT256' }], outputs: [], type: 'function' },
];

const MINE_ADDR = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
const SEND_AMOUNT = 1_500_000n; // 0.015 BTC

console.log(`\nSending ${Number(SEND_AMOUNT)} sats (${Number(SEND_AMOUNT) / 1e8} BTC) to Wallet B via P2TR...\n`);

// ─── Setup provider ───────────────────────────────────────────────────────────
const provider = new JSONRpcProvider({ url: RPC_URL, network });

// ─── Get contract and simulate ────────────────────────────────────────────────
const mine = getContract(MINE_ADDR, TOKEN_ABI, provider, network, addrA);
console.log('Simulating publicMint(1)...');
const sim = await mine.publicMint(1n);

if (sim.revert) {
    console.log(`publicMint reverted: ${sim.revert} — but that's OK, using as carrier TX`);
}

console.log('Sending TX with extraOutput to Wallet B...');
const tx = await sim.sendTransaction({
    signer: walletA.keypair,
    mldsaSigner: walletA.mldsaKeypair,
    refundTo: walletA.p2tr,
    network,
    feeRate: 10,
    priorityFee: 5000n,
    maximumAllowedSatToSpend: 200_000n,
    extraOutputs: [{
        script: receiverScript,
        value: SEND_AMOUNT,
    }],
});

console.log(`TX: ${tx.transactionId}`);
console.log(`Peers: ${tx.peerAcknowledgements}`);
console.log(`\nDone! Sent ${Number(SEND_AMOUNT) / 1e8} BTC (${Number(SEND_AMOUNT)} sats) to Wallet B.`);
console.log('Wait for next block (~5-15 min) to see updated balance.');
