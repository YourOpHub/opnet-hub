/**
 * Shared ABI definitions for all OPNet Hub contracts.
 * Import from here instead of defining ABIs inline in components.
 */
import { BitcoinAbiTypes, ABIDataTypes, type BitcoinInterfaceAbi } from 'opnet';

// ─── SimplePool ABI ─────────────────────────────────────────────────────────
/** Full SimplePool ABI: swap, getReserves, sync, addLiquidity, removeLiquidity, liquidityOf, getTokens */
export const POOL_ABI: BitcoinInterfaceAbi = [
  {
    name: 'swap',
    inputs: [
      { name: 'tokenIn', type: ABIDataTypes.ADDRESS },
      { name: 'amountIn', type: ABIDataTypes.UINT256 },
      { name: 'minAmountOut', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'amountOut', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserves',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'reserveA', type: ABIDataTypes.UINT256 },
      { name: 'reserveB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'sync',
    inputs: [],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'addLiquidity',
    inputs: [
      { name: 'amountA', type: ABIDataTypes.UINT256 },
      { name: 'amountB', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'shares', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'removeLiquidity',
    inputs: [
      { name: 'amountA', type: ABIDataTypes.UINT256 },
      { name: 'amountB', type: ABIDataTypes.UINT256 },
    ],
    outputs: [
      { name: 'actualA', type: ABIDataTypes.UINT256 },
      { name: 'actualB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'liquidityOf',
    constant: true,
    inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
    outputs: [
      { name: 'amountA', type: ABIDataTypes.UINT256 },
      { name: 'amountB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getTokens',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'tokenA', type: ABIDataTypes.ADDRESS },
      { name: 'tokenB', type: ABIDataTypes.ADDRESS },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getFeeRate',
    constant: true,
    inputs: [],
    outputs: [{ name: 'feeRateBps', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'setFeeRate',
    inputs: [{ name: 'newFeeRateBps', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];

/** Minimal SimplePool ABI used by Portfolio: only liquidityOf */
export const POOL_LP_ABI: BitcoinInterfaceAbi = [
  {
    name: 'liquidityOf',
    constant: true,
    inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
    outputs: [
      { name: 'amountA', type: ABIDataTypes.UINT256 },
      { name: 'amountB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
];

/** Pool-discovery ABI: getTokens + getReserves (used for scanning user pools) */
export const POOL_CREATE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'getTokens',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'tokenA', type: ABIDataTypes.ADDRESS },
      { name: 'tokenB', type: ABIDataTypes.ADDRESS },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserves',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'reserveA', type: ABIDataTypes.UINT256 },
      { name: 'reserveB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
];

// ─── SimpleStaking ABI ───────────────────────────────────────────────────────
/** SimpleStaking ABI: stake, unstake, claim, stakedAmount, stakedReward, totalStaked, getRewardRate */
export const STAKING_ABI: BitcoinInterfaceAbi = [
  {
    name: 'stake',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'unstake',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'claim',
    inputs: [],
    outputs: [{ name: 'reward', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'stakedAmount',
    constant: true,
    inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'stakedReward',
    constant: true,
    inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'totalStaked',
    constant: true,
    inputs: [],
    outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getRewardRate',
    constant: true,
    inputs: [],
    outputs: [{ name: 'rate', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getRewardEndBlock',
    constant: true,
    inputs: [],
    outputs: [{ name: 'endBlock', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getRewardCapacity',
    constant: true,
    inputs: [],
    outputs: [{ name: 'remainingBlocks', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'fundRewards',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'newEndBlock', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
];

// ─── P2PMarket ABI ───────────────────────────────────────────────────────────
/** P2PMarket v10 ABI: createSellOrder, fillSellOrder, createBuyOrder (locks BTC), fillBuyOrder (atomic), cancelOrder, getOrder, getNextOrderId */
export const MARKETPLACE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'createSellOrder',
    inputs: [
      { name: 'token', type: ABIDataTypes.ADDRESS },
      { name: 'amount', type: ABIDataTypes.UINT256 },
      { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'fillSellOrder',
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'fillAmount', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'createBuyOrder',
    inputs: [
      { name: 'token', type: ABIDataTypes.ADDRESS },
      { name: 'amount', type: ABIDataTypes.UINT256 },
      { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'fillBuyOrder',
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'cancelOrder',
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getOrder',
    constant: true,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [
      { name: 'orderType', type: ABIDataTypes.UINT256 },
      { name: 'status', type: ABIDataTypes.UINT256 },
      { name: 'creator', type: ABIDataTypes.UINT256 },
      { name: 'token', type: ABIDataTypes.UINT256 },
      { name: 'amount', type: ABIDataTypes.UINT256 },
      { name: 'filled', type: ABIDataTypes.UINT256 },
      { name: 'pricePerToken', type: ABIDataTypes.UINT256 },
      { name: 'seller', type: ABIDataTypes.UINT256 },
      { name: 'lockedBtc', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getNextOrderId',
    constant: true,
    inputs: [],
    outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
];

// ─── FractalSwap v8 ABI ──────────────────────────────────────────────────────
/** FractalSwap v8 ABI: createOrder, takeOrder (partial fills), completeOrder, cancelOrder, refundExpired, getOrder (12 fields), getNextOrderId, getFeeInfo */
export const FRACTALSWAP_ABI: BitcoinInterfaceAbi = [
  {
    name: 'createOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'btcAmount', type: ABIDataTypes.UINT256 },
      { name: 'wantAmount', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'fractalAddr', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'takeOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
      { name: 'fillBtcAmount', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'fillOrderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'completeOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'cancelOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'refundExpired',
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'getOrder',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'status', type: ABIDataTypes.UINT256 },
      { name: 'creator', type: ABIDataTypes.UINT256 },
      { name: 'taker', type: ABIDataTypes.UINT256 },
      { name: 'btcAmount', type: ABIDataTypes.UINT256 },
      { name: 'wantAmount', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'makerAddr', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
      { name: 'feePaid', type: ABIDataTypes.UINT256 },
      { name: 'filledBtc', type: ABIDataTypes.UINT256 },
      { name: 'parentId', type: ABIDataTypes.UINT256 },
    ],
  },
  {
    name: 'getNextOrderId',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'getFeeInfo',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [
      { name: 'feeRecipient', type: ABIDataTypes.UINT256 },
      { name: 'feeBps', type: ABIDataTypes.UINT256 },
    ],
  },
];

// ─── TokenEscrowBridge ABI ───────────────────────────────────────────────────
/** TokenEscrowBridge ABI: createOrder, takeOrder, confirmSwap, cancelOrder, refundExpired, getOrder, getNextOrderId, getFeeInfo */
export const TOKEN_ESCROW_ABI: BitcoinInterfaceAbi = [
  {
    name: 'createOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'token', type: ABIDataTypes.ADDRESS },
      { name: 'tokenAmount', type: ABIDataTypes.UINT256 },
      { name: 'btcPrice', type: ABIDataTypes.UINT256 },
      { name: 'hashlock', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'makerAddr', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'takeOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'confirmSwap',
    type: BitcoinAbiTypes.Function,
    inputs: [
      { name: 'orderId', type: ABIDataTypes.UINT256 },
      { name: 'preimage', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'cancelOrder',
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'refundExpired',
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
  },
  {
    name: 'getOrder',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [{ name: 'orderId', type: ABIDataTypes.UINT256 }],
    outputs: [
      { name: 'direction', type: ABIDataTypes.UINT256 },
      { name: 'status', type: ABIDataTypes.UINT256 },
      { name: 'creator', type: ABIDataTypes.UINT256 },
      { name: 'taker', type: ABIDataTypes.UINT256 },
      { name: 'token', type: ABIDataTypes.UINT256 },
      { name: 'tokenAmount', type: ABIDataTypes.UINT256 },
      { name: 'btcPrice', type: ABIDataTypes.UINT256 },
      { name: 'hashlock', type: ABIDataTypes.UINT256 },
      { name: 'expiry', type: ABIDataTypes.UINT256 },
      { name: 'makerAddr', type: ABIDataTypes.UINT256 },
      { name: 'takerAddr', type: ABIDataTypes.UINT256 },
      { name: 'preimage', type: ABIDataTypes.UINT256 },
      { name: 'feePaid', type: ABIDataTypes.UINT256 },
    ],
  },
  {
    name: 'getNextOrderId',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [{ name: 'nextOrderId', type: ABIDataTypes.UINT256 }],
  },
  {
    name: 'getFeeInfo',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [
      { name: 'feeRecipient', type: ABIDataTypes.UINT256 },
      { name: 'feeBps', type: ABIDataTypes.UINT256 },
    ],
  },
];

// ─── Launchpad / MintableToken ABI ──────────────────────────────────────────
/** MintableToken (Launchpad) ABI: publicMint, totalSupply, maximumSupply, balanceOf, isPublicMintEnabled, getMaxMintPerTx */
export const LAUNCHPAD_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'totalSupply',
    constant: true,
    inputs: [],
    outputs: [{ name: 'supply', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'maximumSupply',
    constant: true,
    inputs: [],
    outputs: [{ name: 'supply', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'balanceOf',
    constant: true,
    inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'isPublicMintEnabled',
    constant: true,
    inputs: [],
    outputs: [{ name: 'enabled', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getMaxMintPerTx',
    constant: true,
    inputs: [],
    outputs: [{ name: 'maxAmount', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
];

// ─── Minimal publicMint-only ABI ─────────────────────────────────────────────
/** Single-function ABI used by TokenGallery, SwapUI, SatoshiMiner, TokenTools faucet */
export const MINTABLE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

// ─── UTXO Splitter dummy ABI ─────────────────────────────────────────────────
/** Used by TokenTools UTXO splitter to piggyback on a view call for extraOutputs */
export const SPLITTER_DUMMY_ABI: BitcoinInterfaceAbi = [
  {
    name: 'getReserves',
    constant: true,
    type: BitcoinAbiTypes.Function,
    inputs: [],
    outputs: [
      { name: 'reserveA', type: ABIDataTypes.UINT256 },
      { name: 'reserveB', type: ABIDataTypes.UINT256 },
    ],
  },
];
