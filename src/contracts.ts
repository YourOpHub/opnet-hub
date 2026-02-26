/**
 * Deployed OP-20 contract addresses on OP_NET testnet
 * Deployed: 2026-02-26 by OPNet Hub
 */
export const TESTNET_CONTRACTS = {
    MINE: {
        address: 'opt1sqpqqfzj0tvevwpj2fx0pwfevm7ulf7xzlcxw8nys',
        pubkey: '0x2c775358cc362481c45589a1f45f77a4a6e9f03ccc7e8ea62d972e5aa23896ea',
        symbol: 'MINE',
        name: 'Mine Token',
        decimals: 8,
        supply: 21_000_000,
        icon: '⛏️',
        description: 'OPNet Hub game token — earned by Epoch Miners',
    },
    VIBE: {
        address: 'opt1sqzfw0zskjdlcnsa057695af6rp5dadl2pu58dx9d',
        pubkey: '0x761c1caa0bf6857ca137e2d519432b5b1cffd805aaea05121c208ec011fce89b',
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

export const MINE_DEPLOY_TXID = '78421616ef12349614f36413a0a01a9ab023fa041d97aaf475edddf0e3b24e03';
export const VIBE_DEPLOY_TXID = 'c1195ea7b1bdcdcb7c12ea4ae84a52bb62eec82583fc0416603fd39750082a45';

export function getOpscanUrl(address: string): string {
    return `https://testnet.opnet.org/tx/${address}`;
}

export function getContractOpscanUrl(address: string): string {
    return `https://testnet.opnet.org/contract/${address}`;
}
