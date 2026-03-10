#!/usr/bin/env node
/**
 * Fund Wallet B with 0.02 BTC from Wallet A.
 * Piggybacks BTC transfer on a cheap increaseAllowance call.
 */
import { createHash } from 'crypto';
import { Mnemonic, Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract, TransactionOutputFlags } from 'opnet';

const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) { console.error('Set OPNET_MNEMONIC env var'); process.exit(1); }

const RPC_URL = 'https://testnet.opnet.org';
const SEND_AMOUNT = 2_000_000n; // 0.02 BTC

const MINE_ADDR = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
const MINE_PK = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

const FN = 'function', U256 = 'UINT256', ADDR = 'ADDRESS';
const TOKEN_ABI = [
    { name: 'increaseAllowance', inputs: [{ name: 'spender', type: ADDR }, { name: 'amount', type: U256 }], outputs: [], type: FN },
    { name: 'balanceOf', constant: true, inputs: [{ name: 'owner', type: ADDR }], outputs: [{ name: 'balance', type: U256 }], type: FN },
];

function p2op(hashHex) {
    const b = new Uint8Array(34);
    b[0] = 0x60; b[1] = 0x20;
    for (let i = 0; i < 32; i++) b[2 + i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
    return b;
}

async function main() {
    const baseNet = networks.opnetTestnet;
    const net = { ...baseNet, bech32: baseNet.bech32Opnet };

    const mn = new Mnemonic(MNEMONIC, '', net);
    const walletA = mn.deriveOPWallet(undefined, 0);
    const walletB = mn.deriveOPWallet(undefined, 1);
    const hashA = createHash('sha256').update(Buffer.from(walletA.mldsaKeypair.publicKey)).digest().toString('hex');
    const hashB = createHash('sha256').update(Buffer.from(walletB.mldsaKeypair.publicKey)).digest().toString('hex');
    const tweakA = Buffer.from(walletA._tweakedKey || walletA.keypair.publicKey).toString('hex');
    const tweakB = Buffer.from(walletB._tweakedKey || walletB.keypair.publicKey).toString('hex');
    const addrA = Address.fromString(hashA, tweakA);
    const addrB = Address.fromString(hashB, tweakB);

    console.log('Wallet A (sender):', walletA.p2tr);
    console.log('Wallet B (receiver):', walletB.p2tr);
    console.log('B MLDSA hash:', hashB.slice(0, 16) + '...');
    console.log(`Sending ${Number(SEND_AMOUNT)} sats (${Number(SEND_AMOUNT) / 1e8} BTC) to B\n`);

    const provider = new JSONRpcProvider({ url: RPC_URL, network: net });
    const MINE = Address.fromString(MINE_PK);

    // Do a cheap increaseAllowance and piggyback BTC transfer to B via extraOutputs
    const c = getContract(MINE_ADDR, TOKEN_ABI, provider, net, addrA);
    const bP2OP = p2op(hashB);

    c.setTransactionDetails({
        inputs: [],
        outputs: [{
            value: SEND_AMOUNT,
            index: 1,
            flags: TransactionOutputFlags.hasScriptPubKey,
            scriptPubKey: bP2OP,
            to: walletB.p2tr,
        }],
    });

    console.log('Simulating increaseAllowance (carrier TX)...');
    const sim = await c.increaseAllowance(MINE, 1n); // dummy allowance
    if (sim.revert) throw new Error(`REVERT: ${sim.revert}`);

    console.log('Sending TX with BTC transfer...');
    const tx = await sim.sendTransaction({
        signer: walletA.keypair,
        mldsaSigner: walletA.mldsaKeypair,
        refundTo: walletA.p2tr,
        network: net,
        feeRate: 10,
        priorityFee: 5000n,
        maximumAllowedSatToSpend: SEND_AMOUNT + 100_000n,
        extraOutputs: [{ script: bP2OP, value: SEND_AMOUNT }],
    });

    console.log(`TX: ${tx.transactionId?.slice(0, 20)}... | Peers: ${tx.peerAcknowledgements}`);
    console.log(`\nDone! Sent ${Number(SEND_AMOUNT) / 1e8} BTC to Wallet B.`);
    console.log('Wait for next block (~5-15 min) to see updated balance.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
