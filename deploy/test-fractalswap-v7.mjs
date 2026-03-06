/**
 * Test FractalSwap v7 — create order from wallet A
 * Usage: OPNET_MNEMONIC="..." node deploy/test-fractalswap-v7.mjs
 */
import { Mnemonic, OPNetLimitedProvider, ChallengeSolution } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';

const RPC_URL = 'https://testnet.opnet.org';
const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mnemonic = new Mnemonic(phrase, '', network);

// Wallet A (index 0)
const walletA = mnemonic.deriveOPWallet(undefined, 0);
console.log('Wallet A:', walletA.p2tr);
console.log('Wallet A MLDSA:', Buffer.from(walletA.mldsaKeypair.publicKey).toString('hex').slice(0, 64));

// Wallet B (index 1)
const walletB = mnemonic.deriveOPWallet(undefined, 1);
console.log('Wallet B:', walletB.p2tr);
console.log('Wallet B MLDSA:', Buffer.from(walletB.mldsaKeypair.publicKey).toString('hex').slice(0, 64));

// Contract v7
const CONTRACT_PUBKEY = '0x526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';

const provider = new OPNetLimitedProvider(RPC_URL);

// Check contract state
async function rpc(method, params) {
    const res = await fetch(`${RPC_URL}/api/v1/json-rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.result;
}

// Check current state
const blockResult = await rpc('btc_blockNumber', []);
const blockNum = parseInt(blockResult, 16);
console.log('\nCurrent block:', blockNum);

// Call getNextOrderId
const callResult = await rpc('btc_call', [CONTRACT_PUBKEY, 'f4920cae']);
const resultBuf = Buffer.from(callResult.result, 'base64');
const nextId = Number(BigInt('0x' + resultBuf.toString('hex')));
console.log('Next order ID:', nextId);

// Call getFeeInfo
const feeResult = await rpc('btc_call', [CONTRACT_PUBKEY, 'f22d798d']);
const feeBuf = Buffer.from(feeResult.result, 'base64');
console.log('Fee recipient:', feeBuf.slice(0, 32).toString('hex'));
console.log('Fee bps:', Number(BigInt('0x' + feeBuf.slice(32, 64).toString('hex'))));

// Check UTXOs for both wallets
const utxosA = await provider.fetchUTXO({ address: walletA.p2tr, minAmount: 1000n, requestedAmount: 100000n });
const utxosB = await provider.fetchUTXO({ address: walletB.p2tr, minAmount: 1000n, requestedAmount: 100000n });
console.log(`\nWallet A UTXOs: ${utxosA.length} (${utxosA.reduce((a, u) => a + u.value, 0n)} sats)`);
console.log(`Wallet B UTXOs: ${utxosB.length} (${utxosB.reduce((a, u) => a + u.value, 0n)} sats)`);

console.log('\n=== FractalSwap v7 contract is ready! ===');
console.log('Create orders via the UI at https://opnethub.xyz');
