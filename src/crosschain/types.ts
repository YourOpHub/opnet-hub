/** FractalSwap — BTC ↔ Fractal BTC swap type definitions */

export enum SwapDirection {
  BTC_TO_FB = 1,
  FB_TO_BTC = 2,
}

export enum OrderStatus {
  Open = 1,
  Taken = 2,
  Confirmed = 3,
  Cancelled = 4,
  Refunded = 5,
}

export interface FractalSwapOrder {
  id: string;
  direction: SwapDirection;
  status: OrderStatus;
  creator: string;       // hex P2OP address
  taker: string;         // hex (0 until taken)
  amountSats: bigint;    // BTC amount in sats
  hashlock: string;      // hex
  preimage: string;      // hex (0 until confirmed)
  expiry: number;        // block height
  makerAddr: string;     // hex (address on source chain)
  takerAddr: string;     // hex (address on target chain)
  feePaid: bigint;       // sats
}

export const MAKER_STEPS = ['Post Order', 'Wait for Taker', 'Reveal Preimage', 'Done'];
export const TAKER_STEPS = ['Take Order + Pay Fee', 'Create HTLC', 'Confirm Swap', 'Done'];
