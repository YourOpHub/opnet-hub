/**
 * Deployed OP-20 contract addresses on OP_NET testnet
 * Deployed: 2026-02-26 by OPNet Hub
 */
/** v3 deployment — linkMLDSA + gasSatFee 100k — bytecode confirmed on-chain */
export const TESTNET_CONTRACTS = {
    MINE: {
        address: 'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa',
        pubkey: '0x64adc4c6cb9a05553363ffa544b32d6668d8e1ce02311c72915dc18c3603f397',
        symbol: 'MINE',
        name: 'Mine Token',
        decimals: 8,
        supply: 21_000_000,
        icon: '⛏️',
        description: 'OPNet Hub game token — earned by Epoch Miners',
        deployTxid: '25843e9643ef623ea0d07fd196da277536b37156f90e1d0a718ebaa58d577cf0',
        publicMint: true,
        maxMintPerTx: 1_000_000, // 1M MINE per tx
    },
    VIBE: {
        address: 'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802',
        pubkey: '0x818ecc6e52aa04e57e641a7bec673f33517a70b00ff1604c5e05296674760df1',
        symbol: 'VIBE',
        name: 'Vibe Token',
        decimals: 8,
        supply: 100_000_000,
        icon: '⚡',
        description: 'Vibecoding Challenge token — built for #opnetvibecode',
        deployTxid: 'bfbe3f54be4f56069976e3511ab4a4834462c28469412e1d20cb84746622b46b',
        publicMint: true,
        maxMintPerTx: 5_000_000, // 5M VIBE per tx
    },
} as const;

export const DEPLOYER_ADDRESS = 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';

export const DEPLOYER_MLDSA_HEX = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
export const DEPLOYER_TWEAKED_HEX = '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';

export const MINE_DEPLOY_TXID = '25843e9643ef623ea0d07fd196da277536b37156f90e1d0a718ebaa58d577cf0';
export const VIBE_DEPLOY_TXID = 'bfbe3f54be4f56069976e3511ab4a4834462c28469412e1d20cb84746622b46b';

/** SimplePool AMM contract — MINE/VIBE liquidity pool */
// Pool address will be set after deployment. For now, use empty string.
// Update this after running: OPNET_MNEMONIC="..." node deploy/deploy-pool.mjs
export const POOL_ADDRESS = 'opt1sqz9tzjlyxdazhqpml7rkdgel8skf7w88aus4l30h';
export const POOL_PUBKEY = '0x549207340cf9a94d1e98d8f8c6cb7e223670e23f520df39f5972f5d208fe3d12';
export const POOL_HEX = '549207340cf9a94d1e98d8f8c6cb7e223670e23f520df39f5972f5d208fe3d12';

/** SimplePool v2 selectors (from opnet-transform build output) */
export const POOL_SELECTORS = {
    sync: 0x4ffcd515,
    addLiquidity: 0xe4e35d85,    // addLiquidity(uint256,uint256)
    removeLiquidity: 0x4847feb8, // removeLiquidity(uint256,uint256)
    liquidityOf: 0x28703b84,     // liquidityOf(address)
    swap: 0xc345780b,            // swap(address,uint256,uint256)
    getReserves: 0x06374bfc,
    getTokens: 0xf68958f1,
} as const;

/** OP-20 selectors (OPNet sha256-based, NOT EVM keccak256) */
export const OP20_SELECTORS = {
    transfer: 0x3b88ef57,
    transferFrom: 0x4b6685e7,
    balanceOf: 0x5b46f8f6,
    increaseAllowance: 0x8d645723,
    allowance: 0xd864b7ca,
} as const;

/** SimpleStaking contract — MINE staking with rewards */
// Deploy via: OPNET_MNEMONIC="..." node deploy/deploy-staking.mjs
// Update these after deployment
export const STAKING_ADDRESS = 'opt1sqpxk2hqaux0upqyz7wz3egnv8rfjrusj058388t8';
export const STAKING_PUBKEY = '0xb921bda1595223005ff40de0bcb50572bd9401865a5b67f5383d48f877143928';
export const STAKING_DEPLOYED = !!STAKING_ADDRESS;

/** Staking selectors (from opnet-transform build output) */
export const STAKING_SELECTORS = {
    stake: 0x0ccd8b3d,
    unstake: 0x5e445065,
    claim: 0xa443c5e4,
    stakedAmount: 0x6ae777fd,
    stakedReward: 0x07350949,
    totalStaked: 0xbacead82,
    getRewardRate: 0x5bb1159d,
    setRewardRate: 0x0888d584,
} as const;

/** P2PMarket — on-chain P2P orderbook (Verify-Don't-Custody pattern) */
export const MARKET_ADDRESS = 'opt1sqpggj6rdnmwuwewnhp0etmckv8rhurf7ace65dd7';
export const MARKET_PUBKEY = '0xe3523f3c7aea4349d34e710e4650de421e7dd800435414191f34f017124a3ca1';
export const MARKET_HEX = 'e3523f3c7aea4349d34e710e4650de421e7dd800435414191f34f017124a3ca1';

/** P2PMarket v5 selectors — trustless buy orders (accept + execute) */
export const MARKET_SELECTORS = {
    createSellOrder: 0x35db31a0,   // createSellOrder(address,uint256,uint256) → orderId
    fillSellOrder: 0x8d7e1c91,     // fillSellOrder(uint256,uint256) → success (buyer sends BTC to seller)
    createBuyOrder: 0x310ce017,    // createBuyOrder(address,uint256,uint256) → orderId
    acceptBuyOrder: 0x9736c4d9,    // acceptBuyOrder(uint256) → success (seller locks tokens)
    executeBuyOrder: 0x1e08843b,   // executeBuyOrder(uint256) → success (buyer pays BTC, gets tokens)
    cancelOrder: 0xeb5aa830,       // cancelOrder(uint256) → success
    getOrder: 0xe9489555,          // getOrder(uint256) → (type,status,creator,token,amount,filled,price,seller)
    getNextOrderId: 0xf4920cae,    // getNextOrderId() → nextId
} as const;

/** OPScan explorer — works for testnet contract/tx inspection */
const OPSCAN = 'https://opscan.org';

export function getTxUrl(txid: string): string {
    return `${OPSCAN}/transactions/${txid}?network=op_testnet`;
}

export function getContractOpscanUrl(address: string): string {
    return `${OPSCAN}/accounts/${address}?network=op_testnet`;
}

export function getAddressUrl(address: string): string {
    return `${OPSCAN}/accounts/${address}?network=op_testnet`;
}
