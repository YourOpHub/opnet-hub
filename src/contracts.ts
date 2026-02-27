/**
 * Deployed OP-20 contract addresses on OP_NET testnet
 * Deployed: 2026-02-26 by OPNet Hub
 */
/** v3 deployment — linkMLDSA + gasSatFee 100k — bytecode confirmed on-chain */
export const TESTNET_CONTRACTS = {
    MINE: {
        address: 'opt1sqr6qp5spthha0cyrhj6qh3wrgn9kj06c4up68dmz',
        pubkey: '0x9ab565681231f1cdd2fe400700b8ffc97cda9e46663d0a010a3627d390019fea',
        symbol: 'MINE',
        name: 'Mine Token',
        decimals: 8,
        supply: 21_000_000,
        icon: '⛏️',
        description: 'OPNet Hub game token — earned by Epoch Miners',
        deployTxid: '1a50546bf161d8aa623201d5bd812ea42b9a151b4373a62bf746243181902c59',
        publicMint: false,       // Will be true after MintableToken redeploy
        maxMintPerTx: 1_000_000, // 1M MINE per tx
    },
    VIBE: {
        address: 'opt1sqzm99nspva6lqk8e7am34ewpcmyheydzsqu4df3m',
        pubkey: '0x86ffb43e51f36a680ff4391b397ba4daa12faa7cd3e72b0e70978bb0fe43b6e6',
        symbol: 'VIBE',
        name: 'Vibe Token',
        decimals: 8,
        supply: 100_000_000,
        icon: '⚡',
        description: 'Vibecoding Challenge token — built for #opnetvibecode',
        deployTxid: 'bf65f4f7e87088953ae1ac1447765a4a364f1751d9bfaa761231dd739d0ab0d7',
        publicMint: false,       // Will be true after MintableToken redeploy
        maxMintPerTx: 5_000_000, // 5M VIBE per tx
    },
} as const;

export const DEPLOYER_ADDRESS = 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';

export const DEPLOYER_MLDSA_HEX = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
export const DEPLOYER_TWEAKED_HEX = '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';

export const MINE_DEPLOY_TXID = '1a50546bf161d8aa623201d5bd812ea42b9a151b4373a62bf746243181902c59';
export const VIBE_DEPLOY_TXID = 'bf65f4f7e87088953ae1ac1447765a4a364f1751d9bfaa761231dd739d0ab0d7';

/** SimplePool AMM contract — MINE/VIBE liquidity pool */
// Pool address will be set after deployment. For now, use empty string.
// Update this after running: OPNET_MNEMONIC="..." node deploy/deploy-pool.mjs
export const POOL_ADDRESS = 'opt1sqq9f2hgrvpmls9yl9nqmmpmgjlt9pep50smqj2u9';
export const POOL_PUBKEY = '0x168d49557dd14bf7096887c09e431a1e4a266a22faf25bab375ca278b4950989';

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
