import { Compressor, EcKeyPair, DeploymentGenerator } from '@btc-vision/transaction';
import { networks, payments, initEccLib } from '@btc-vision/bitcoin';
import * as ecc from '@bitcoinerlab/secp256k1';
import { readFileSync } from 'fs';

initEccLib(ecc);

const WIF = 'cVVjcKm9g2ZuBVMo7HD4PrfcPmVvr3kRuPkapjVkqqX1JkKgsrTP';
const opnetTestnet = { ...networks.testnet, bech32: 'opt' };

// Parse key
const kp = EcKeyPair.fromWIF(WIF, opnetTestnet);
const pub = kp.publicKey;
const xonly = pub.subarray(1, 33);
const { address } = payments.p2tr({ internalPubkey: xonly, network: opnetTestnet });

console.log('═══ $MINE Token Deploy ═══');
console.log('Address:', address);
console.log('PubKey:', pub.toString('hex').slice(0, 20) + '...');

// Load and compress WASM
const wasm = readFileSync('OP_20/build/MyToken.wasm');
console.log('WASM:', wasm.length, 'bytes');

const bytecode = await Compressor.compress(wasm);
console.log('Compressed:', bytecode.length, 'bytes');

// Fetch UTXOs from RPC
async function rpc(method, params = []) {
    const r = await fetch('https://testnet.opnet.org/api/v1/json-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
    });
    const d = await r.json();
    if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
    return d.result;
}

const bal = parseInt(await rpc('btc_getBalance', [address]), 16);
console.log('Balance:', bal, 'sats');

const utxoData = await rpc('btc_getUTXOs', [address, { optimized: false }]);
console.log('UTXOs:', utxoData.confirmed?.length || 0, 'confirmed');

if (!utxoData.confirmed?.length) {
    console.log('ERROR: No UTXOs found');
    process.exit(1);
}

// Format UTXOs
const utxos = utxoData.confirmed.map(u => ({
    transactionId: u.transactionId,
    outputIndex: u.outputIndex,
    value: BigInt(u.value),
    scriptPubKey: {
        hex: u.scriptPubKey.hex,
        address: u.scriptPubKey.address,
    },
}));

console.log('Formatted UTXOs:', utxos.length);
for (const u of utxos) {
    console.log(`  ${u.transactionId.slice(0, 16)}... idx:${u.outputIndex} val:${u.value}`);
}

// Try deployment
try {
    const dg = new DeploymentGenerator(pub, opnetTestnet);
    console.log('DeploymentGenerator created');
    
    // Generate deployment transaction
    const result = dg.compile({
        bytecode,
        utxos,
        signer: kp,
        network: opnetTestnet,
        feeRate: 10,
        priorityFee: 500n,
        from: address,
        to: address,
    });
    
    console.log('Deployment compiled');
    console.log('TX:', JSON.stringify(result).slice(0, 300));
    
    // Broadcast
    const broadcastResult = await rpc('btc_sendRawTransaction', [result.hex || result]);
    console.log('Broadcast result:', broadcastResult);
    
} catch (e) {
    console.log('Deploy error:', e.message);
    console.log('Stack:', e.stack?.split('\n').slice(0, 5).join('\n'));
    
    // Fallback: show what we have and suggest OP_WALLET
    console.log('');
    console.log('═══ Manual Deploy Instructions ═══');
    console.log('The WASM is compiled and ready at: deploy/OP_20/build/MyToken.wasm');
    console.log('');
    console.log('To deploy via OP_WALLET:');
    console.log('1. Install OP_WALLET extension');
    console.log('2. Import WIF key');
    console.log('3. Go to Deploy tab');
    console.log('4. Upload MyToken.wasm');
    console.log('5. Send transaction');
    console.log('');
    console.log('Address:', address);
    console.log('Balance:', bal, 'sats');
    console.log('WASM size:', wasm.length, '→ compressed:', bytecode.length);
}
