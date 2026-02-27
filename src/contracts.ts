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
    },
} as const;

export const DEPLOYER_ADDRESS = 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';

export const DEPLOYER_MLDSA_HEX = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
export const DEPLOYER_TWEAKED_HEX = '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';

export const MINE_DEPLOY_TXID = '1a50546bf161d8aa623201d5bd812ea42b9a151b4373a62bf746243181902c59';
export const VIBE_DEPLOY_TXID = 'bf65f4f7e87088953ae1ac1447765a4a364f1751d9bfaa761231dd739d0ab0d7';

/** OPNet testnet explorer base */
const EXPLORER = 'https://testnet.opnet.org';

export function getTxUrl(txid: string): string {
    return `${EXPLORER}/tx/${txid}`;
}

export function getContractOpscanUrl(address: string): string {
    // Contract pages on testnet.opnet.org are not yet live; link to address lookup
    return `${EXPLORER}/address/${address}`;
}

export function getAddressUrl(address: string): string {
    return `${EXPLORER}/address/${address}`;
}
