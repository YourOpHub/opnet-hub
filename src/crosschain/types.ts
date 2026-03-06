/** FractalSwap v6 — BTC ↔ Fractal BTC swap type definitions */

export enum SwapDirection {
  BTC_TO_FB = 1,
  FB_TO_BTC = 2,
}

export enum OrderStatus {
  Open = 1,
  Taken = 2,
  Completed = 3,
  Cancelled = 4,
  Refunded = 5,
}

export interface FractalSwapOrder {
  id: string;
  direction: SwapDirection;
  status: OrderStatus;
  creator: string;       // hex P2OP address
  taker: string;         // hex (0 until taken)
  btcAmount: bigint;     // BTC locked in sats
  wantAmount: bigint;    // desired FB amount in sats
  expiry: number;        // block height
  makerAddr: string;     // hex (maker's Fractal address)
  takerAddr: string;     // hex (taker's Fractal address)
  feePaid: bigint;       // sats
}

export const MAKER_STEPS_BTC_TO_FB = ['Create Order + Lock BTC', 'Wait for Taker', 'Taker Sends FB + Claims BTC', 'Done'];
export const TAKER_STEPS_BTC_TO_FB = ['Take Order + Pay Fee', 'Send FB to Maker', 'Claim Locked BTC', 'Done'];
export const MAKER_STEPS_FB_TO_BTC = ['Create Order', 'Wait for Taker to Lock BTC', 'Send FB to Taker + Claim BTC', 'Done'];
export const TAKER_STEPS_FB_TO_BTC = ['Take Order + Lock BTC + Pay Fee', 'Wait for Maker to Send FB', 'Done'];
