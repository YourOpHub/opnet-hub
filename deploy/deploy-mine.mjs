/**
 * $MINE Token Deployment on OP_NET Testnet
 * 
 * Usage:
 *   node deploy-mine.mjs
 * 
 * Requires testnet BTC on the wallet. Get from faucet.opnet.org
 */

import { JSONRpcProvider, getContract, OP_20_ABI } from 'opnet';
import { Wallet, EcKeyPair, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import { networks, payments } from '@btc-vision/bitcoin';

const WIF = 'cVVjcKm9g2ZuBVMo7HD4PrfcPmVvr3kRuPkapjVkqqX1JkKgsrTP';
const NETWORK = networks.regtest;
const RPC_URL = 'https://testnet.opnet.org';

// Derive addresses from WIF
const kp = EcKeyPair.fromWIF(WIF, NETWORK);
const pubKey = kp.publicKey;
const xonly = pubKey.subarray(1, 33);
const { address: p2trAddress } = payments.p2tr({ internalPubkey: xonly, network: NETWORK });
const { address: p2wpkhAddress } = payments.p2wpkh({ pubkey: pubKey, network: NETWORK });

console.log('═══ $MINE Token Deployer ═══');
console.log('');
console.log('Wallet Addresses:');
console.log('  P2TR:   ', p2trAddress);
console.log('  P2WPKH: ', p2wpkhAddress);
console.log('');

const provider = new JSONRpcProvider(RPC_URL, NETWORK);

async function checkBalance() {
    const bal = await provider.getBalance(p2trAddress);
    console.log('Balance (P2TR):', bal.toString(), 'sats');
    const bal2 = await provider.getBalance(p2wpkhAddress);
    console.log('Balance (P2WPKH):', bal2.toString(), 'sats');
    return { p2tr: bal, p2wpkh: bal2 };
}

async function checkChain() {
    const block = await provider.getBlockNumber();
    console.log('Block height:', block.toString());
    const chainId = await provider.getChainId();
    console.log('Chain ID:', chainId.toString());
}

async function main() {
    // 1. Check chain
    console.log('[1/4] Checking chain...');
    await checkChain();
    console.log('');

    // 2. Check balance
    console.log('[2/4] Checking balance...');
    const balances = await checkBalance();
    console.log('');

    const totalBal = balances.p2tr + balances.p2wpkh;
    if (totalBal === 0n) {
        console.log('⚠️  NO TESTNET BTC FOUND');
        console.log('');
        console.log('To deploy $MINE, you need testnet BTC.');
        console.log('Get coins from: https://faucet.opnet.org');
        console.log('');
        console.log('Send to one of these addresses:');
        console.log('  P2TR:   ', p2trAddress);
        console.log('  P2WPKH: ', p2wpkhAddress);
        console.log('');
        console.log('Then run this script again.');
        console.log('');
        console.log('[3/4] Skipping deployment (no funds)');
        console.log('[4/4] Skipping verification');
        console.log('');
        console.log('Token config that will be deployed:');
        console.log('  Name:     Mine Token');
        console.log('  Symbol:   MINE');
        console.log('  Supply:   21,000,000');
        console.log('  Decimals: 8');
        console.log('  Standard: OP-20');
        console.log('');
        console.log('Distribution:');
        console.log('  50% Game Pool  (10,500,000) — miner rewards');
        console.log('  20% Liquidity  ( 4,200,000) — Motoswap LP');
        console.log('  15% Team       ( 3,150,000) — 6-month vest');
        console.log('  10% Community  ( 2,100,000) — airdrops');
        console.log('   5% Reserve    ( 1,050,000) — future use');
        return;
    }

    // 3. Deploy token
    console.log('[3/4] Deploying $MINE token...');
    console.log('  This requires a compiled OP-20 WASM contract.');
    console.log('  Steps:');
    console.log('    1. git clone https://github.com/btc-vision/OP_20');
    console.log('    2. cd OP_20 && npm install && npm run build');
    console.log('    3. Use the compiled .wasm with OP_WALLET deploy UI');
    console.log('    4. Or use the transaction SDK programmatically');
    console.log('');

    // For programmatic deployment, you need the compiled WASM bytecode
    // and an MLDSA keypair. The OP_WALLET extension handles this automatically.
    console.log('  OP_WALLET deployment is recommended (handles MLDSA signing).');
    console.log('  Visit: https://chromewebstore.google.com/detail/opwallet');
    console.log('');

    // 4. Verify (would run after deployment)
    console.log('[4/4] Post-deployment verification:');
    console.log('  After deploying, update the contract address in:');
    console.log('  - c:\\vibe\\src\\components\\SatoshiMiner.tsx (MINE_CONTRACT)');
    console.log('  - VPS .env (MINE_CONTRACT_ADDRESS)');
    console.log('  Then rebuild and redeploy frontend.');
}

main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
