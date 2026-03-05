/**
 * Deployed OP-20 contract addresses on OP_NET testnet
 * Deployed: 2026-03-04 by OPNet Hub (post-testnet-reset)
 */
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
        description: 'Vibecoding Challenge token — built for #opnetvibecode',
        deployTxid: '81debce471fa810f416caaa88210a251558acc032a4ac0c0584ea1427ae60a1a',
        publicMint: true,
        maxMintPerTx: 5_000_000, // 5M VIBE per tx
    },
} as const;

export const DEPLOYER_ADDRESS = 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';

export const DEPLOYER_MLDSA_HEX = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
export const DEPLOYER_TWEAKED_HEX = '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';

export const MINE_DEPLOY_TXID = '0c49c38d168dd72b3a8cf622e41af707e6a22256ae3cf2e36d33a24307948fdb';
export const VIBE_DEPLOY_TXID = '81debce471fa810f416caaa88210a251558acc032a4ac0c0584ea1427ae60a1a';

/** SimplePool v3 AMM — LP share model, audit fixes (post-reset #2) */
export const POOL_ADDRESS = 'opt1sqztrzryk063ta3nx98f4v4xfsl0l8fdjgujl9s4e';
export const POOL_PUBKEY = '0x02adb0aca0e24c104817de39a4fd8ffeab9f3e5a424c550a2bebaa8da96f18e1';
export const POOL_HEX = '02adb0aca0e24c104817de39a4fd8ffeab9f3e5a424c550a2bebaa8da96f18e1';

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

/** SimpleStaking v2 — post-reset #2, 2M MINE funded */
export const STAKING_ADDRESS = 'opt1sqprz0p6xx593unycyd9lpr5wuu0nkgv35c59c54y';
export const STAKING_PUBKEY = '0x4fb131c700761b9bd82c844c381fd1b5ba9fcd71d301a9e800c9ab83af91b86e';
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
} as const;

/** P2PMarket v9 — output bitmap fix (prevents BTC double-counting in batch fills) */
export const MARKET_ADDRESS = 'opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt';
export const MARKET_PUBKEY = '0xd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595';
export const MARKET_HEX = 'd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595';

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

/** FractalSwap v3 — post-reset #2 */
export const CROSSCHAIN_ADDRESS = 'opt1sqrmhp0msf9ccajnfrrd2th0ux9tcuxlqxu2mrnpu';
export const CROSSCHAIN_PUBKEY = '0xb209ab09e187ac6562424892212f0ff546db6c1aae36cb0d6a95bd9014a38e0c';

/** TokenEscrowBridge — removed from UI (duplicates Marketplace), not redeployed */
export const TOKEN_ESCROW_ADDRESS = '';
export const TOKEN_ESCROW_PUBKEY = '';
export const TOKEN_ESCROW_HEX = '';

/** NativeSwapPool v5 — BTC/MINE AMM (dust check, min fee, audit-fixed, deployed 2026-03-05) */
export const NATIVESWAP_ADDRESS = 'opt1sqp3uxpgy9yjrhpvjukhpqhmsqr4qe7hahgup8cuj';
export const NATIVESWAP_PUBKEY = '0x51649d55996afffaad032f897dcd7ad17d6ead208b53a8eee29237494029f900';
export const NATIVESWAP_HEX = '51649d55996afffaad032f897dcd7ad17d6ead208b53a8eee29237494029f900';

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

/** FractalSwap selectors (from opnet-transform build output) */
export const CROSSCHAIN_SELECTORS = {
    createOrder: 0x17b631a3,
    takeOrder: 0xfe6bb1e1,
    confirmSwap: 0x2abfb8f9,
    cancelOrder: 0xeb5aa830,
    refundExpired: 0x7136e9b2,
    getOrder: 0xe9489555,
    getNextOrderId: 0xf4920cae,
    setFeeRecipient: 0x5ccb9ecd,  // setFeeRecipient(uint256,string) — v2 changed
    setFeeBps: 0xfdd3c00b,
    getFeeInfo: 0xf22d798d,
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

/** Map opt1 addresses → hex pubkeys (for RPC calls that need pubkey format) */
const PUBKEY_MAP: Record<string, string> = {
    [TESTNET_CONTRACTS.MINE.address]: TESTNET_CONTRACTS.MINE.pubkey.replace('0x', ''),
    [TESTNET_CONTRACTS.VIBE.address]: TESTNET_CONTRACTS.VIBE.pubkey.replace('0x', ''),
    [POOL_ADDRESS]: POOL_HEX,
    [STAKING_ADDRESS]: STAKING_PUBKEY.replace('0x', ''),
    [MARKET_ADDRESS]: MARKET_HEX,
    [CROSSCHAIN_ADDRESS]: CROSSCHAIN_PUBKEY.replace('0x', ''),
    ...(TOKEN_ESCROW_ADDRESS ? { [TOKEN_ESCROW_ADDRESS]: TOKEN_ESCROW_HEX } : {}),
    ...(NATIVESWAP_ADDRESS ? { [NATIVESWAP_ADDRESS]: NATIVESWAP_HEX } : {}),
};

/** Get hex pubkey for an opt1 address, or return address as-is */
export function addressToPubkey(address: string): string {
    return PUBKEY_MAP[address] || address;
}
