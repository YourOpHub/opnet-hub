#!/usr/bin/env node
/** Quick read of all FractalSwap v8 orders */
import { createHash } from 'crypto';
import { Mnemonic, Address } from '../node_modules/@btc-vision/transaction/build/index.js';
import { networks } from '../node_modules/@btc-vision/bitcoin/build/index.js';
import { JSONRpcProvider, getContract } from '../node_modules/opnet/build/index.js';

const CC_V8 = { addr: 'opt1sqphxm7la5z4n3ynzux84gl9dztgrgfw64cu6u3w8' };
const FN = 'function', U256 = 'UINT256';
const CC_ABI = [
    { name: 'getOrder', constant: true, inputs: [{ name: 'orderId', type: U256 }], outputs: [
        { name: 'direction', type: U256 }, { name: 'status', type: U256 },
        { name: 'creator', type: U256 }, { name: 'taker', type: U256 },
        { name: 'btcAmount', type: U256 }, { name: 'wantAmount', type: U256 },
        { name: 'expiry', type: U256 }, { name: 'makerAddr', type: U256 },
        { name: 'takerAddr', type: U256 }, { name: 'feePaid', type: U256 },
        { name: 'filledBtc', type: U256 }, { name: 'parentId', type: U256 },
    ], type: FN },
    { name: 'getNextOrderId', constant: true, inputs: [], outputs: [{ name: 'nextOrderId', type: U256 }], type: FN },
];

const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) { console.error('Set OPNET_MNEMONIC'); process.exit(1); }

const net = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };
const mn = new Mnemonic(MNEMONIC, '', net);
const w = mn.deriveOPWallet(undefined, 0);
const h = createHash('sha256').update(Buffer.from(w.mldsaKeypair.publicKey)).digest().toString('hex');
const t = Buffer.from(w._tweakedKey || w.keypair.publicKey).toString('hex');
const addr = Address.fromString(h, t);
const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: net });
const statusMap = { 0: 'None', 1: 'Open', 2: 'Taken', 3: 'Done', 4: 'Cancelled', 5: 'Refunded' };

const c = getContract(CC_V8.addr, CC_ABI, provider, net, addr);
const r = await c.getNextOrderId();
const nextId = Number(r.properties.nextOrderId);
console.log('nextOrderId:', nextId);

for (let i = 1; i <= Math.min(nextId - 1, 20); i++) {
    const o = await c.getOrder(BigInt(i));
    const p = o.properties;
    const dir = Number(p.direction) === 1 ? 'BTC->FB' : Number(p.direction) === 2 ? 'FB->BTC' : `dir=${p.direction}`;
    console.log(`#${i}: ${dir} | ${statusMap[Number(p.status)] || '?'} | btc=${p.btcAmount} want=${p.wantAmount} | filled=${p.filledBtc ?? 0n} parent=${Number(p.parentId ?? 0n)} | exp=${p.expiry} | fee=${p.feePaid ?? 0n}`);
}
