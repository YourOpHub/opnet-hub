/**
 * Deployed OP-20 contract addresses on OP_NET testnet
 * Deployed: 2026-03-04 by OPNet Hub (post-testnet-reset)
 */
import { OPSCAN_NETWORK, CURRENT_ENV } from './config';
import { logger } from './logger';

/** Type-safe env var reader — import.meta.env values are `string | undefined` at runtime */
function env(key: string): string {
    return (import.meta.env[key] as string | undefined) ?? '';
}

/** v6 deployment — MintableToken with publicMint (post-testnet-reset #2, block ~3821) */
export const TESTNET_CONTRACTS = {
    MINE: {
        address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
        pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
        symbol: 'MINE',
        name: 'Mine Token',
        decimals: 8,
        supply: 21_000_000,
        icon: '⛏️',
        iconImg: '/icons/token-mine.png',
        description: 'OPNet Hub game token — earned by Epoch Miners',
        deployTxid: '0c49c38d168dd72b3a8cf622e41af707e6a22256ae3cf2e36d33a24307948fdb',
        publicMint: true,
        maxMintPerTx: 1_000_000, // 1M MINE per tx
    },
    VIBE: {
        address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
        pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
        symbol: 'VIBE',
        name: 'Vibe Token',
        decimals: 8,
        supply: 100_000_000,
        icon: '⚡',
        iconImg: '/icons/token-vibe.png',
        description: 'Vibecoding Challenge token — built for #opnetvibecode',
        deployTxid: '81debce471fa810f416caaa88210a251558acc032a4ac0c0584ea1427ae60a1a',
        publicMint: true,
        maxMintPerTx: 5_000_000, // 5M VIBE per tx
    },
} as const;

/** Shared shape for contract token entries (widens literal types from `as const`) */
export interface ContractTokenInfo {
    address: string;
    pubkey: string;
    symbol: string;
    name: string;
    decimals: number;
    supply: number;
    icon: string;
    /** Optional path to a custom coin image in the public/icons folder */
    iconImg?: string;
    description: string;
    deployTxid: string;
    publicMint: boolean;
    maxMintPerTx: number;
}

export interface ContractsMap {
    MINE: ContractTokenInfo;
    VIBE: ContractTokenInfo;
}

/** Mainnet contract addresses — placeholder until mainnet deployment */
const MAINNET_CONTRACTS: ContractsMap = {
    MINE: {
        address: env('VITE_MINE_ADDRESS'),
        pubkey: env('VITE_MINE_PUBKEY'),
        symbol: 'MINE',
        name: 'Mine Token',
        decimals: 8,
        supply: 21_000_000,
        icon: '⛏️',
        iconImg: '/icons/token-mine.png',
        description: 'OPNet Hub game token — earned by Epoch Miners',
        deployTxid: '',
        publicMint: true,
        maxMintPerTx: 1_000_000,
    },
    VIBE: {
        address: env('VITE_VIBE_ADDRESS'),
        pubkey: env('VITE_VIBE_PUBKEY'),
        symbol: 'VIBE',
        name: 'Vibe Token',
        decimals: 8,
        supply: 100_000_000,
        icon: '⚡',
        iconImg: '/icons/token-vibe.png',
        description: 'Vibecoding Challenge token — built for #opnetvibecode',
        deployTxid: '',
        publicMint: true,
        maxMintPerTx: 5_000_000,
    },
};

/** Network-aware contract config — selects testnet or mainnet based on CURRENT_ENV */
export const DEPLOYED_CONTRACTS: ContractsMap = CURRENT_ENV === 'mainnet' ? MAINNET_CONTRACTS : TESTNET_CONTRACTS;

// Mainnet safety guard — warn if mainnet selected but contracts not configured
if (CURRENT_ENV === 'mainnet' && (!DEPLOYED_CONTRACTS.MINE.address || !DEPLOYED_CONTRACTS.VIBE.address)) {
  logger.error('[FATAL] Mainnet contracts not configured! Set VITE_MINE_ADDRESS and VITE_VIBE_ADDRESS env vars.');
}

export const DEPLOYER_ADDRESS = env('VITE_DEPLOYER_ADDRESS') || 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';

/** Deployer public key hashes (public, NOT private keys) — used for fee recipient P2OP */
export const DEPLOYER_MLDSA_HEX = env('VITE_DEPLOYER_MLDSA') || '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
export const DEPLOYER_TWEAKED_HEX = env('VITE_DEPLOYER_TWEAKED') || '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';

export const MINE_DEPLOY_TXID = '0c49c38d168dd72b3a8cf622e41af707e6a22256ae3cf2e36d33a24307948fdb';
export const VIBE_DEPLOY_TXID = '81debce471fa810f416caaa88210a251558acc032a4ac0c0584ea1427ae60a1a';

/** SimplePool v6 AMM — LP shares + configurable fee (1-500 bps) + removeLiquidity rounding fix */
export const POOL_ADDRESS = env('VITE_POOL_ADDRESS') || 'opt1sqqhj9pld6lwsts0qljrlm3l4hjek8lhz4q4y2cl4';
export const POOL_PUBKEY = env('VITE_POOL_PUBKEY') || '0x2acb8d7a8fce5cf7090d8c205cbb74c75c35965ff3848966ead01b80a59fca63';
export const POOL_HEX = POOL_PUBKEY.replace('0x', '');

/** SimplePool v5 selectors (from opnet-transform build output) */
export const POOL_SELECTORS = {
    sync: 0x4ffcd515,
    addLiquidity: 0xe4e35d85,    // addLiquidity(uint256,uint256)
    removeLiquidity: 0x4847feb8, // removeLiquidity(uint256,uint256)
    liquidityOf: 0x28703b84,     // liquidityOf(address)
    swap: 0xc345780b,            // swap(address,uint256,uint256)
    getReserves: 0x06374bfc,
    getTokens: 0xf68958f1,
    getFeeRate: 0x9960835f,      // getFeeRate() → feeRateBps
    setFeeRate: 0x385d614d,      // setFeeRate(uint256) — deployer only
} as const;

/** OP-20 selectors (OPNet sha256-based, NOT EVM keccak256) */
export const OP20_SELECTORS = {
    transfer: 0x3b88ef57,
    transferFrom: 0x4b6685e7,
    balanceOf: 0x5b46f8f6,
    increaseAllowance: 0x8d645723,
    allowance: 0xd864b7ca,
} as const;

/** SimpleStaking v4 — fundRewards + events (Staked/Unstaked/RewardClaimed/RewardRateChanged/RewardsFunded) */
export const STAKING_ADDRESS = env('VITE_STAKING_ADDRESS') || 'opt1sqzfsz6csap8jpv8ueac5n2u0vx2a85epuyk9ez5c';
export const STAKING_PUBKEY = env('VITE_STAKING_PUBKEY') || '0x6b92dfca57e7415b6e89868ee1e2c51dcda8f8b4bf9a28b19900e1bfba2121ae';
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
    getRewardEndBlock: 0xf749e4a3,  // v2: view reward end block
    setRewardEndBlock: 0xe97e03b2,  // v2: deployer sets end block
    fundRewards: 0x3aabb23b,       // v3: fundRewards(uint256) — anyone can fund
    getRewardCapacity: 0x3d8438bb, // v3: remaining blocks of rewards
} as const;

/** P2PMarket v9 — output bitmap fix (prevents BTC double-counting in batch fills) */
/** P2PMarket v10 — atomic buy orders (BTC locked at creation, fillBuyOrder) */
export const MARKET_ADDRESS = env('VITE_MARKET_ADDRESS') || 'opt1sqq54r566klqfdn5uuqtwv0hsnyh0yaefmyulg7lh';
export const MARKET_PUBKEY = env('VITE_MARKET_PUBKEY') || '0xdc6dd5aa610f98ace2d19b2cf4ddc37e40d8963c1a7c84aa71bf2c90f78d9daf';
export const MARKET_HEX = MARKET_PUBKEY.replace('0x', '');

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

/** FractalSwap v7 — real BTC escrow + relayer auto-complete */
export const CROSSCHAIN_ADDRESS = env('VITE_CROSSCHAIN_ADDRESS') || 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
export const CROSSCHAIN_PUBKEY = env('VITE_CROSSCHAIN_PUBKEY') || '0x526fe291e36e072116516ddc28ad44276d9827f625316715d78befbe1750c0f2';

/** Motoswap DEX contracts — env-overridable for mainnet migration */
export const MOTOSWAP_FACTORY_ADDRESS = env('VITE_MOTOSWAP_FACTORY_ADDRESS') || 'opt1sqzs3e6qrtkgyfu0x592x6rdfe4r9dpjxqycyhr7w';
export const MOTOSWAP_FACTORY_PUBKEY = env('VITE_MOTOSWAP_FACTORY_PUBKEY') || '0xa02aa5ca4c307107484d5fb690d811df1cf526f8de204d24528653dcae369a0f';
export const MOTOSWAP_ROUTER_ADDRESS = env('VITE_MOTOSWAP_ROUTER_ADDRESS') || 'opt1sqqavlf5dr8tjgrsrvjzhk5yrkgnha0z4ty9xwwf6';
export const MOTOSWAP_ROUTER_PUBKEY = env('VITE_MOTOSWAP_ROUTER_PUBKEY') || '0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a';
export const MOTO_TOKEN_PUBKEY = env('VITE_MOTO_TOKEN_PUBKEY') || '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd';

/** TokenEscrowBridge — removed from UI (duplicates Marketplace), not redeployed */
export const TOKEN_ESCROW_ADDRESS = '';
export const TOKEN_ESCROW_PUBKEY = '';
export const TOKEN_ESCROW_HEX = '';

/** NativeSwapPool v5 — BTC/MINE AMM (dust check, min fee, audit-fixed, deployed 2026-03-05) */
export const NATIVESWAP_ADDRESS = env('VITE_NATIVESWAP_ADDRESS') || 'opt1sqp3uxpgy9yjrhpvjukhpqhmsqr4qe7hahgup8cuj';
export const NATIVESWAP_PUBKEY = env('VITE_NATIVESWAP_PUBKEY') || '0x51649d55996afffaad032f897dcd7ad17d6ead208b53a8eee29237494029f900';
export const NATIVESWAP_HEX = NATIVESWAP_PUBKEY.replace('0x', '');

/** NativeSwap selectors (from opnet-transform build output) */
export const NATIVESWAP_SELECTORS = {
    addLiquidity: 0xe4e35d85,       // addLiquidity(uint256,uint256)
    removeLiquidity: 0x13100148,    // removeLiquidity(uint256)
    reserveBuyToken: 0x4fcdea8a,    // reserveBuyToken(uint256,uint256) — v2: added minTokenOut
    executeBuyToken: 0x6b44975e,    // executeBuyToken(uint256)
    cancelReservation: 0xfe49b2a0,  // cancelReservation(uint256)
    sellTokenForBTC: 0xad1c32b9,    // sellTokenForBTC(uint256,uint256)
    getReserves: 0x06374bfc,        // getReserves()
    getQuoteBuyToken: 0xe6989511,   // getQuoteBuyToken(uint256)
    getQuoteSellToken: 0x36560481,  // getQuoteSellToken(uint256)
    liquidityOf: 0x28703b84,        // liquidityOf(address)
    getReservation: 0x49f7aba5,     // getReservation(uint256)
    getToken: 0xff015c72,           // getToken()
    getPoolInfo: 0x366b0306,        // getPoolInfo()
    setFeeRate: 0x385d614d,         // setFeeRate(uint256)
} as const;

/** Fee recipient P2OP address string (for on-chain output.to matching) */
export const FEE_RECIPIENT_ADDR = 'opt1sfjnexj8d35sut49m4nw7nljwk7ctpvhdf906s8j5t40mc764ft4qptud3g';

/** FractalSwap v7 selectors (from opnet-transform build output) */
export const CROSSCHAIN_SELECTORS = {
    createOrder: 0x17b631a3,     // createOrder(uint256,uint256,uint256,uint256,uint256)
    takeOrder: 0xfe6bb1e1,       // takeOrder(uint256,uint256)
    completeOrder: 0x39585799,   // completeOrder(uint256) — manual completion by taker/maker
    relayerComplete: 0x4e402884, // relayerComplete(uint256) — v7: auto-complete by trusted relayer
    cancelOrder: 0xeb5aa830,     // cancelOrder(uint256)
    refundExpired: 0x7136e9b2,   // refundExpired(uint256)
    getOrder: 0xe9489555,        // getOrder(uint256) → 10 fields
    getNextOrderId: 0xf4920cae,  // getNextOrderId()
    setFeeRecipient: 0x5ccb9ecd, // setFeeRecipient(uint256,string)
    setFeeBps: 0xfdd3c00b,       // setFeeBps(uint256)
    setRelayer: 0x2b07d4c5,     // setRelayer(uint256) — v7: set trusted relayer
    getFeeInfo: 0xf22d798d,      // getFeeInfo()
} as const;

/** TokenEscrowBridge selectors (from opnet-transform build output) */
export const TOKEN_ESCROW_SELECTORS = {
    createOrder: 0xff44b331,     // createOrder(uint256,address,uint256,uint256,uint256,uint256,uint256)
    takeOrder: 0xfe6bb1e1,       // takeOrder(uint256,uint256)
    confirmSwap: 0x2abfb8f9,     // confirmSwap(uint256,uint256)
    cancelOrder: 0xeb5aa830,     // cancelOrder(uint256)
    refundExpired: 0x7136e9b2,   // refundExpired(uint256)
    getOrder: 0xe9489555,        // getOrder(uint256) → 13 fields
    getNextOrderId: 0xf4920cae,  // getNextOrderId()
    getFeeInfo: 0xf22d798d,      // getFeeInfo()
    setFeeRecipient: 0x5ccb9ecd, // setFeeRecipient(uint256,string)
    setFeeBps: 0xfdd3c00b,       // setFeeBps(uint256)
} as const;

/** OPScan explorer — network-aware */
const OPSCAN = 'https://opscan.org';
const OPSCAN_EXPLORER = CURRENT_ENV === 'mainnet' ? 'https://opscan.org' : `https://${CURRENT_ENV}.opscan.org`;

export function getTxUrl(txid: string): string {
    return `${OPSCAN}/transactions/${txid}?network=${OPSCAN_NETWORK}`;
}

export function getContractOpscanUrl(address: string): string {
    return `${OPSCAN}/accounts/${address}?network=${OPSCAN_NETWORK}`;
}

export function getAddressUrl(address: string): string {
    return `${OPSCAN}/accounts/${address}?network=${OPSCAN_NETWORK}`;
}

export function getBlockUrl(height: number): string {
    return `${OPSCAN}/blocks/${height}?network=${OPSCAN_NETWORK}`;
}

/** OPScan API base for token/holder queries */
export const OPSCAN_API_BASE = `https://api.opscan.org/v1/${OPSCAN_NETWORK}`;

/** OPScan explorer base URL (e.g. https://testnet.opscan.org) */
export const OPSCAN_EXPLORER_URL = OPSCAN_EXPLORER;

/** Map opt1 addresses → hex pubkeys (for RPC calls that need pubkey format) */
const PUBKEY_MAP: Record<string, string> = {
    [DEPLOYED_CONTRACTS.MINE.address]: DEPLOYED_CONTRACTS.MINE.pubkey.replace('0x', ''),
    [DEPLOYED_CONTRACTS.VIBE.address]: DEPLOYED_CONTRACTS.VIBE.pubkey.replace('0x', ''),
    [POOL_ADDRESS]: POOL_HEX,
    [STAKING_ADDRESS]: STAKING_PUBKEY.replace('0x', ''),
    [MARKET_ADDRESS]: MARKET_HEX,
    [CROSSCHAIN_ADDRESS]: CROSSCHAIN_PUBKEY.replace('0x', ''),
    ...(TOKEN_ESCROW_ADDRESS !== '' ? { [TOKEN_ESCROW_ADDRESS]: TOKEN_ESCROW_HEX } : {}),
    ...(NATIVESWAP_ADDRESS !== '' ? { [NATIVESWAP_ADDRESS]: NATIVESWAP_HEX } : {}),
};

/** Get hex pubkey for an opt1 address, or return address as-is */
export function addressToPubkey(address: string): string {
    return PUBKEY_MAP[address] || address;
}
