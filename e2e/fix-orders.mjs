/**
 * fix-orders.mjs — Create new properly-encoded FractalSwap orders
 *
 * Creates BTC↔FB orders from Wallet A with correct witness program encoding.
 * Pattern copied from server/full-e2e-test.mjs (TESTED AND WORKING).
 */
import { createHash } from 'crypto';
import { Mnemonic, Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract, TransactionOutputFlags } from 'opnet';
import { bech32m } from 'bech32';

// ─── Network (EXACT pattern from full-e2e-test.mjs) ─────────────────────────
const baseNet = networks.opnetTestnet;
const net = { ...baseNet, bech32: baseNet.bech32Opnet };

// ─── Provider (NO /api/v1/json-rpc suffix — provider handles it) ─────────────
const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: net });

// ─── Constants ───────────────────────────────────────────────────────────────
const CROSSCHAIN_ADDR = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
const CROSSCHAIN_PK   = '526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';

const MNEMONIC = process.env.OPNET_MNEMONIC || 'veteran sunset borrow ecology artist magnet endorse tube tobacco soda odor okay';

// ─── ABI (short form, matches full-e2e-test.mjs) ────────────────────────────
const FN = 'function', U256 = 'UINT256', BOOL = 'BOOL';
const ABI = [
  { name: 'createOrder', type: FN, inputs: [
    { name: 'direction', type: U256 }, { name: 'btcAmount', type: U256 },
    { name: 'wantAmount', type: U256 }, { name: 'expiry', type: U256 },
    { name: 'fractalAddr', type: U256 },
  ], outputs: [{ name: 'orderId', type: U256 }] },
  { name: 'cancelOrder', type: FN, inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }] },
  { name: 'refundExpired', type: FN, inputs: [{ name: 'orderId', type: U256 }], outputs: [{ name: 'success', type: BOOL }] },
  { name: 'getOrder', constant: true, type: FN, inputs: [{ name: 'orderId', type: U256 }], outputs: [
    { name: 'direction', type: U256 }, { name: 'status', type: U256 },
    { name: 'creator', type: U256 }, { name: 'taker', type: U256 },
    { name: 'btcAmount', type: U256 }, { name: 'wantAmount', type: U256 },
    { name: 'expiry', type: U256 }, { name: 'makerAddr', type: U256 },
    { name: 'takerAddr', type: U256 }, { name: 'feePaid', type: U256 },
  ]},
  { name: 'getNextOrderId', constant: true, type: FN, inputs: [], outputs: [{ name: 'nextOrderId', type: U256 }] },
];

// ─── Helpers (EXACT pattern from full-e2e-test.mjs) ─────────────────────────
function p2op(hashHex) {
  const b = new Uint8Array(34);
  b[0] = 0x60; b[1] = 0x20;
  for (let i = 0; i < 32; i++) b[2 + i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  return b; // Uint8Array, NOT Buffer.from(b)
}

function encodeFractalAddr(addr) {
  const decoded = bech32m.decode(addr, 90);
  const version = decoded.words[0];
  const program = bech32m.fromWords(decoded.words.slice(1));
  if (version !== 1 || program.length !== 32) throw new Error(`Only P2TR supported: v=${version} len=${program.length}`);
  let result = 0n;
  for (let i = 0; i < 32; i++) result = (result << 8n) | BigInt(program[i]);
  return result;
}

function decodeFractalAddr(hex64) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex64.slice(i * 2, i * 2 + 2), 16);
  if (bytes.every(b => b === 0)) return '';
  const words = [1, ...bech32m.toWords(bytes)];
  return bech32m.encode('bc', words, 90);
}

// ─── Wallet setup (EXACT pattern from full-e2e-test.mjs) ────────────────────
function mkWallet(idx) {
  const mn = new Mnemonic(MNEMONIC, '', net);
  const w = mn.deriveOPWallet(undefined, idx);
  const h = createHash('sha256').update(Buffer.from(w.mldsaKeypair.publicKey)).digest().toString('hex');
  const t = Buffer.from(w._tweakedKey || w.keypair.publicKey).toString('hex');
  return { wallet: w, hash: h, addr: Address.fromString(h, t) };
}

// ─── Send TX (EXACT pattern from full-e2e-test.mjs) ─────────────────────────
async function send(sim, wallet, extra = [], maxSat = 100_000n) {
  if (sim.revert) throw new Error(`REVERT: ${sim.revert}`);
  console.log('   Sim OK, sending...');
  const tx = await sim.sendTransaction({
    signer: wallet.keypair,
    mldsaSigner: wallet.mldsaKeypair,
    refundTo: wallet.p2tr,  // wallet.p2tr returns opt1p... because net.bech32 = bech32Opnet
    network: net,
    feeRate: 10,
    priorityFee: 5000n,
    maximumAllowedSatToSpend: maxSat,
    ...(extra.length ? { extraOutputs: extra } : {}),
  });
  console.log(`   TX: ${tx.transactionId?.slice(0, 16)}... | Peers: ${tx.peerAcknowledgements}`);
  return tx;
}

async function waitBlock(label) {
  const start = Number(await provider.getBlockNumber());
  console.log(`  [${label}] Waiting for block > ${start}...`);
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const now = Number(await provider.getBlockNumber());
    if (now > start) { console.log(`  [${label}] Block ${now} confirmed!`); return; }
  }
  console.log(`  [${label}] Timeout waiting for block`);
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════
async function main() {
  const A = mkWallet(0);
  const walletA = A.wallet;
  const senderA = A.addr;

  console.log('Wallet A p2tr:', walletA.p2tr);
  console.log('Wallet A MLDSA hash:', A.hash);

  // Derive Fractal address from tweaked key
  const xonly = walletA._tweakedKey.length === 33 ? walletA._tweakedKey.slice(1) : walletA._tweakedKey;
  const walletAFractal = bech32m.encode('bc', [1, ...bech32m.toWords(Buffer.from(xonly))], 90);
  console.log('Wallet A Fractal:', walletAFractal);

  const block = Number(await provider.getBlockNumber());
  console.log('Current block:', block);
  console.log();

  console.log('SKIP Phase 1: User must cancel own orders #3-#6 from UI (contract requires creator)');

  // ═══════════════════════════════════════════════════════
  // PHASE 2: Create new orders with proper encoding
  // ═══════════════════════════════════════════════════════
  console.log('\n=== PHASE 2: Create new orders ===');

  const fractalAddrU256 = encodeFractalAddr(walletAFractal);
  console.log('Wallet A Fractal encoded:', fractalAddrU256.toString(16));
  console.log('Roundtrip:', decodeFractalAddr(fractalAddrU256.toString(16).padStart(64, '0')));

  const expiry = BigInt(block + 200); // ~33 hours
  const ccP2OP = p2op(CROSSCHAIN_PK);

  // Order 1: BTC→FB, 10000 sats, 1:1 rate
  {
    console.log('\n--- Creating BTC→FB order: 10000 sats ---');
    const contract = getContract(CROSSCHAIN_ADDR, ABI, provider, net, senderA);
    const btcAmount = 10000n;
    const wantAmount = 10000n;

    contract.setTransactionDetails({ inputs: [], outputs: [
      { value: btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: ccP2OP, to: walletA.p2tr }
    ]});

    const sim = await contract.createOrder(1n, btcAmount, wantAmount, expiry, fractalAddrU256);
    if (sim.revert) { console.log('REVERT:', sim.revert); } else {
      await send(sim, walletA, [{ script: ccP2OP, value: btcAmount }], btcAmount + 50_000n);
      console.log('✅ BTC→FB order created! (10K sats, expiry block', Number(expiry) + ')');
    }
  }

  await waitBlock('order1');

  // Order 2: FB→BTC, 10000 sats, 1:1 rate
  {
    console.log('\n--- Creating FB→BTC order: 10000 sats ---');
    const contract = getContract(CROSSCHAIN_ADDR, ABI, provider, net, senderA);
    const btcAmount = 10000n;
    const wantAmount = 10000n;
    // FB→BTC: no BTC lock needed
    const sim = await contract.createOrder(2n, btcAmount, wantAmount, expiry, fractalAddrU256);
    if (sim.revert) { console.log('REVERT:', sim.revert); } else {
      await send(sim, walletA, [], 50_000n);
      console.log('✅ FB→BTC order created! (10K sats, expiry block', Number(expiry) + ')');
    }
  }

  await waitBlock('order2');

  // Order 3: BTC→FB, 25000 sats
  {
    console.log('\n--- Creating BTC→FB order: 25000 sats ---');
    const contract = getContract(CROSSCHAIN_ADDR, ABI, provider, net, senderA);
    const btcAmount = 25000n;
    const wantAmount = 25000n;

    contract.setTransactionDetails({ inputs: [], outputs: [
      { value: btcAmount, index: 1, flags: TransactionOutputFlags.hasScriptPubKey, scriptPubKey: ccP2OP, to: walletA.p2tr }
    ]});

    const sim = await contract.createOrder(1n, btcAmount, wantAmount, expiry, fractalAddrU256);
    if (sim.revert) { console.log('REVERT:', sim.revert); } else {
      await send(sim, walletA, [{ script: ccP2OP, value: btcAmount }], btcAmount + 50_000n);
      console.log('✅ BTC→FB order created! (25K sats, expiry block', Number(expiry) + ')');
    }
  }

  await waitBlock('order3');

  // Verify all new orders
  console.log('\n=== Verification ===');
  const c = getContract(CROSSCHAIN_ADDR, ABI, provider, net);
  const nextId = Number((await c.getNextOrderId()).properties.nextOrderId);
  console.log('Next order ID:', nextId);
  for (let i = nextId - 3; i < nextId; i++) {
    try {
      const r = await c.getOrder(BigInt(i));
      const p = r.properties;
      const st = ['', 'Open', 'Taken', 'Completed', 'Cancelled'][Number(p.status)];
      const dir = Number(p.direction) === 1 ? 'BTC→FB' : 'FB→BTC';
      const makerHex = p.makerAddr.toString(16).padStart(64, '0');
      const decoded = decodeFractalAddr(makerHex);
      console.log(`#${i}: ${dir} ${st} btc=${Number(p.btcAmount)} makerAddr=${decoded.slice(0, 20)}...${decoded.slice(-8)}`);
    } catch (e) { console.log(`#${i}: error`, e.message?.slice(0, 50)); }
  }

  console.log('\n✅ Done!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
