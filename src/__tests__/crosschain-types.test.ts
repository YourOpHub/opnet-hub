/**
 * crosschain-types.test.ts — Tests for crosschain type definitions and pure functions.
 *
 * Covers:
 *   - src/crosschain/types.ts: SwapDirection, OrderStatus, step arrays
 *   - src/components/crosschain/types.ts: satsToBtc, fmtBtc, fmtRate, STATUS_COLORS, DIR_*
 */
import { describe, it, expect } from 'vitest';

import {
  SwapDirection,
  OrderStatus,
  MAKER_STEPS_BTC_TO_FB,
  TAKER_STEPS_BTC_TO_FB,
  MAKER_STEPS_FB_TO_BTC,
  TAKER_STEPS_FB_TO_BTC,
} from '../crosschain/types';

import {
  satsToBtc,
  fmtBtc,
  fmtRate,
  STATUS_COLORS,
  DIR_SELL_TOKEN,
  DIR_BUY_TOKEN,
} from '../components/crosschain/types';

// ─── SwapDirection enum ───
describe('SwapDirection', () => {
  it('BTC_TO_FB = 1', () => {
    expect(SwapDirection.BTC_TO_FB).toBe(1);
  });

  it('FB_TO_BTC = 2', () => {
    expect(SwapDirection.FB_TO_BTC).toBe(2);
  });
});

// ─── OrderStatus enum ───
describe('OrderStatus', () => {
  it('has all 5 statuses', () => {
    expect(OrderStatus.Open).toBe(1);
    expect(OrderStatus.Taken).toBe(2);
    expect(OrderStatus.Completed).toBe(3);
    expect(OrderStatus.Cancelled).toBe(4);
    expect(OrderStatus.Refunded).toBe(5);
  });
});

// ─── Step arrays ───
describe('Step arrays', () => {
  it('MAKER_STEPS_BTC_TO_FB has 4 steps', () => {
    expect(MAKER_STEPS_BTC_TO_FB).toHaveLength(4);
    expect(MAKER_STEPS_BTC_TO_FB[0]).toContain('Create');
    expect(MAKER_STEPS_BTC_TO_FB[3]).toBe('Done');
  });

  it('TAKER_STEPS_BTC_TO_FB has 4 steps', () => {
    expect(TAKER_STEPS_BTC_TO_FB).toHaveLength(4);
    expect(TAKER_STEPS_BTC_TO_FB[0]).toContain('Take');
    expect(TAKER_STEPS_BTC_TO_FB[3]).toBe('Done');
  });

  it('MAKER_STEPS_FB_TO_BTC has 4 steps', () => {
    expect(MAKER_STEPS_FB_TO_BTC).toHaveLength(4);
    expect(MAKER_STEPS_FB_TO_BTC[0]).toContain('Create');
    expect(MAKER_STEPS_FB_TO_BTC[3]).toBe('Done');
  });

  it('TAKER_STEPS_FB_TO_BTC has 3 steps', () => {
    expect(TAKER_STEPS_FB_TO_BTC).toHaveLength(3);
    expect(TAKER_STEPS_FB_TO_BTC[0]).toContain('Take');
    expect(TAKER_STEPS_FB_TO_BTC[2]).toBe('Done');
  });
});

// ─── fmtBtc ───
describe('fmtBtc', () => {
  it('formats 1 BTC (1e8 sats)', () => {
    expect(fmtBtc(100_000_000n)).toBe('1');
  });

  it('formats 0 sats', () => {
    expect(fmtBtc(0n)).toBe('0');
  });

  it('formats 0.5 BTC', () => {
    expect(fmtBtc(50_000_000n)).toBe('0.5');
  });

  it('formats 0.00000001 BTC (1 sat)', () => {
    expect(fmtBtc(1n)).toBe('0.00000001');
  });

  it('formats 0.001 BTC', () => {
    expect(fmtBtc(100_000n)).toBe('0.001');
  });

  it('formats 10 BTC', () => {
    expect(fmtBtc(1_000_000_000n)).toBe('10');
  });

  it('formats 0.01 BTC', () => {
    expect(fmtBtc(1_000_000n)).toBe('0.01');
  });

  it('trims trailing zeros for >= 1 BTC', () => {
    expect(fmtBtc(200_000_000n)).toBe('2');
  });

  it('trims trailing zeros for < 0.01 BTC', () => {
    expect(fmtBtc(10_000n)).toBe('0.0001');
  });

  it('formats 0.12345678 BTC (rounded to 6 decimals)', () => {
    // fmtBtc uses .toFixed(6) for values between 0.01 and 1
    expect(fmtBtc(12_345_678n)).toBe('0.123457');
  });

  it('formats value between 0.01 and 1', () => {
    expect(fmtBtc(5_000_000n)).toBe('0.05');
  });
});

// ─── satsToBtc ───
describe('satsToBtc', () => {
  it('appends BTC unit by default', () => {
    expect(satsToBtc(100_000_000n)).toBe('1 BTC');
  });

  it('appends FB unit when specified', () => {
    expect(satsToBtc(100_000_000n, 'FB')).toBe('1 FB');
  });

  it('formats small amounts', () => {
    expect(satsToBtc(1000n)).toBe('0.00001 BTC');
  });

  it('formats 0 sats', () => {
    expect(satsToBtc(0n)).toBe('0 BTC');
  });
});

// ─── fmtRate ───
describe('fmtRate', () => {
  it('formats 1:1 rate', () => {
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
  });

  it('formats 1:2 rate', () => {
    expect(fmtRate(200_000_000n, 100_000_000n)).toBe('1:2');
  });

  it('formats fractional rate', () => {
    expect(fmtRate(50_000_000n, 100_000_000n)).toBe('1:0.5');
  });

  it('returns - for zero fb', () => {
    expect(fmtRate(100_000_000n, 0n)).toBe('-');
  });

  it('returns - for negative fb', () => {
    expect(fmtRate(100_000_000n, -1n)).toBe('-');
  });

  it('trims trailing zeros', () => {
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
    // Not "1:1.0000"
  });

  it('formats 0.1234 rate', () => {
    const result = fmtRate(12_340_000n, 100_000_000n);
    expect(result).toBe('1:0.1234');
  });
});

// ─── STATUS_COLORS ───
describe('STATUS_COLORS', () => {
  it('has entries for all OrderStatus values', () => {
    expect(STATUS_COLORS[OrderStatus.Open]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Taken]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Completed]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Cancelled]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Refunded]).toBeDefined();
  });

  it('each entry has bg, text, label', () => {
    for (const status of [1, 2, 3, 4, 5]) {
      const entry = STATUS_COLORS[status]!;
      expect(entry.bg).toBeTruthy();
      expect(entry.text).toMatch(/^#/);
      expect(entry.label).toBeTruthy();
    }
  });

  it('labels are correct', () => {
    expect(STATUS_COLORS[OrderStatus.Open]!.label).toBe('Open');
    expect(STATUS_COLORS[OrderStatus.Taken]!.label).toBe('Taken');
    expect(STATUS_COLORS[OrderStatus.Completed]!.label).toBe('Completed');
    expect(STATUS_COLORS[OrderStatus.Cancelled]!.label).toBe('Cancelled');
    expect(STATUS_COLORS[OrderStatus.Refunded]!.label).toBe('Refunded');
  });
});

// ─── Direction constants ───
describe('Direction constants', () => {
  it('DIR_SELL_TOKEN = 1', () => {
    expect(DIR_SELL_TOKEN).toBe(1);
  });

  it('DIR_BUY_TOKEN = 2', () => {
    expect(DIR_BUY_TOKEN).toBe(2);
  });
});
