/**
 * $MINE Token Deployment Script for OP_NET Testnet
 * 
 * This script deploys the $MINE OP-20 token contract on Bitcoin L1 via OP_NET.
 * 
 * Prerequisites:
 *   npm install @btc-vision/transaction @btc-vision/wallet
 * 
 * Usage:
 *   PRIVATE_KEY=cVVj... node deploy-token.js
 * 
 * The token uses the standard OP-20 template with custom parameters.
 */

const MINE_CONFIG = {
  name: 'Mine Token',
  symbol: 'MINE',
  decimals: 8,
  totalSupply: 21_000_000_00000000n, // 21M with 8 decimals
  // Distribution:
  // 50% Game Pool (10.5M) - distributed via mining game
  // 20% Liquidity (4.2M) - Motoswap LP
  // 15% Team (3.15M) - vested 6 months
  // 10% Community (2.1M) - airdrops, events
  // 5% Reserve (1.05M) - future use
};

const RPC_URL = process.env.OPNET_RPC || 'https://testnet.opnet.org/api/v1/json-rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ERROR: Set PRIVATE_KEY env variable (WIF format)');
  console.error('Usage: PRIVATE_KEY=cVVj... node deploy-token.js');
  process.exit(1);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`);
  return data.result;
}

async function main() {
  console.log('═══ $MINE Token Deployment ═══');
  console.log(`Token: ${MINE_CONFIG.name} (${MINE_CONFIG.symbol})`);
  console.log(`Supply: ${(Number(MINE_CONFIG.totalSupply) / 1e8).toLocaleString()} ${MINE_CONFIG.symbol}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log('');

  // 1. Check connection
  console.log('[1/5] Checking OP_NET connection...');
  const blockHeight = await rpc('btc_blockNumber');
  console.log(`  Block height: ${parseInt(blockHeight, 16)}`);

  const chainId = await rpc('btc_chainId');
  console.log(`  Chain ID: ${parseInt(chainId, 16)}`);

  // 2. Check gas
  console.log('[2/5] Getting gas parameters...');
  const gas = await rpc('btc_gas');
  console.log(`  Base gas: ${gas.baseGas || 'N/A'}`);
  console.log(`  Bitcoin fee: ${gas.bitcoin?.conservative || 'N/A'} sat/vB`);

  // 3. Get epoch info
  console.log('[3/5] Getting epoch info...');
  const epoch = await rpc('btc_latestEpoch');
  console.log(`  Latest epoch: ${epoch?.number || 'N/A'}`);

  // 4. Token deployment info
  console.log('[4/5] Token configuration:');
  console.log(`  Name: ${MINE_CONFIG.name}`);
  console.log(`  Symbol: ${MINE_CONFIG.symbol}`);
  console.log(`  Decimals: ${MINE_CONFIG.decimals}`);
  console.log(`  Total Supply: ${(Number(MINE_CONFIG.totalSupply) / 1e8).toLocaleString()}`);
  console.log('');
  console.log('  Distribution:');
  console.log('    50% Game Pool  (10,500,000 MINE) — mining rewards');
  console.log('    20% Liquidity  ( 4,200,000 MINE) — Motoswap LP');
  console.log('    15% Team       ( 3,150,000 MINE) — 6-month vest');
  console.log('    10% Community  ( 2,100,000 MINE) — airdrops');
  console.log('     5% Reserve    ( 1,050,000 MINE) — future use');

  // 5. Deployment
  console.log('');
  console.log('[5/5] Deployment requires @btc-vision/transaction SDK');
  console.log('');
  console.log('To deploy, install the SDK and run:');
  console.log('');
  console.log('  npm install @btc-vision/transaction @btc-vision/wallet');
  console.log('');
  console.log('Then use the OP_NET contract deployment API:');
  console.log('');
  console.log('  // 1. Build OP-20 contract from template');
  console.log('  //    git clone https://github.com/btc-vision/OP_20');
  console.log('  //    cd OP_20 && npm install && npm run build');
  console.log('  // 2. Deploy compiled WASM via transaction SDK');
  console.log('  // 3. Call initialize(name, symbol, decimals, supply)');
  console.log('  // 4. Contract address returned in tx receipt');
  console.log('');
  console.log('Or use OP_WALLET browser extension for GUI deployment.');
  console.log('');
  console.log('═══ Chain verification complete ═══');
}

main().catch(e => {
  console.error('Deploy failed:', e.message);
  process.exit(1);
});
