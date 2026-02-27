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
export const POOL_ADDRESS = 'opt1sqqslqmts6wcchuh55f7hf6hurux2d4363cthz9p0';
export const POOL_PUBKEY = '0x33da0b2ad35343e3ad782e9bd01e28887bb97888e6a6556a3cd16cc53e5adf9e';

/** SimplePool selectors (from opnet-transform build output) */
export const POOL_SELECTORS = {
    sync: 0x4ffcd515,
    swap: 0xc345780b,        // swap(address,uint256,uint256)
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
export const STAKING_ADDRESS = '';
export const STAKING_PUBKEY = '';
export const STAKING_DEPLOYED = !!STAKING_ADDRESS;

/** Staking selectors (from opnet-transform) */
export const STAKING_SELECTORS = {
    stake: 0x0, // will be set after build
    unstake: 0x0,
    claim: 0x0,
    stakedAmount: 0x0,
    stakedReward: 0x0,
    totalStaked: 0x0,
    getRewardRate: 0x0,
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
