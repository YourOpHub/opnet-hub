/** Shared types for CrossChain sub-components */

import { OrderStatus, type SwapDirection } from '../../crosschain/types';
export type { OrderStatus, SwapDirection };

/** Token escrow order type */
export interface TokenEscrowOrder {
  id: string;
  direction: number; // 1=sell_token, 2=buy_token
  status: number;
  creator: string;
  taker: string;
  tokenHex: string; // token contract address as hex
  tokenAmount: bigint;
  btcPrice: bigint; // in sats
  hashlock: string;
  preimage: string;
  expiry: number;
  makerAddr: string;
  takerAddr: string;
  feePaid: bigint;
}

/** Bridge mode */
export type BridgeMode = 'fractalswap' | 'tokenbridge';

/** Direction constants for token escrow */
export const DIR_SELL_TOKEN = 1; // Maker locks tokens, wants BTC
export const DIR_BUY_TOKEN = 2;  // Maker posts intent to buy tokens with BTC

/** Status badge config */
export const STATUS_COLORS: Record<number, { bg: string; text: string; label: string }> = {
  [OrderStatus.Open]: { bg: 'rgba(34,197,94,.15)', text: '#22c55e', label: 'Open' },
  [OrderStatus.Taken]: { bg: 'rgba(245,158,11,.15)', text: '#f59e0b', label: 'Taken' },
  [OrderStatus.Completed]: { bg: 'rgba(59,130,246,.15)', text: '#3b82f6', label: 'Completed' },
  [OrderStatus.Cancelled]: { bg: 'rgba(107,114,128,.15)', text: '#6b7280', label: 'Cancelled' },
  [OrderStatus.Refunded]: { bg: 'rgba(239,68,68,.15)', text: '#ef4444', label: 'Refunded' },
};

/** Shared style constants */
export const iStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '.7rem', fontWeight: 600, color: 'var(--t2)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em',
};

export const btnSmall: React.CSSProperties = {
  background: 'rgba(255,255,255,.08)', color: 'var(--t2)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '4px 10px', fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
};

/** Format sats as BTC/FB string — trim trailing zeros */
export function satsToBtc(sats: bigint, unit: 'BTC' | 'FB' = 'BTC'): string {
  return fmtBtc(sats) + ' ' + unit;
}

/** Format sats as clean number (no unit) — for table cells */
export function fmtBtc(sats: bigint): string {
  const btc = Number(sats) / 1e8;
  let s: string;
  if (btc >= 1) s = btc.toFixed(4);
  else if (btc >= 0.01) s = btc.toFixed(6);
  else s = btc.toFixed(8);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Format rate — trim trailing zeros */
export function fmtRate(btc: bigint, fb: bigint): string {
  if (fb <= 0n) return '-';
  const r = Number(btc) / Number(fb);
  let s = r.toFixed(4);
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return '1:' + s;
}
