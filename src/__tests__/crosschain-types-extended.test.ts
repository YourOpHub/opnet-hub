/**
 * crosschain-types-extended.test.ts -- Extended tests for
 * src/components/crosschain/types.ts (style constants, more fmtBtc/fmtRate edge cases)
 * src/crosschain/types.ts (step array content validation)
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
  iStyle,
  labelStyle,
  btnSmall,
  STATUS_COLORS,
} from '../components/crosschain/types';

// ---- Step array content ----
describe('step array content', () => {
  it('MAKER_STEPS_BTC_TO_FB steps are unique', () => {
    const unique = new Set(MAKER_STEPS_BTC_TO_FB);
    expect(unique.size).toBe(MAKER_STEPS_BTC_TO_FB.length);
  });

  it('TAKER_STEPS_BTC_TO_FB steps are unique', () => {
    const unique = new Set(TAKER_STEPS_BTC_TO_FB);
    expect(unique.size).toBe(TAKER_STEPS_BTC_TO_FB.length);
  });

  it('MAKER_STEPS_FB_TO_BTC steps are unique', () => {
    const unique = new Set(MAKER_STEPS_FB_TO_BTC);
    expect(unique.size).toBe(MAKER_STEPS_FB_TO_BTC.length);
  });

  it('TAKER_STEPS_FB_TO_BTC steps are unique', () => {
    const unique = new Set(TAKER_STEPS_FB_TO_BTC);
    expect(unique.size).toBe(TAKER_STEPS_FB_TO_BTC.length);
  });

  it('all step arrays end with "Done"', () => {
    expect(MAKER_STEPS_BTC_TO_FB[MAKER_STEPS_BTC_TO_FB.length - 1]).toBe('Done');
    expect(TAKER_STEPS_BTC_TO_FB[TAKER_STEPS_BTC_TO_FB.length - 1]).toBe('Done');
    expect(MAKER_STEPS_FB_TO_BTC[MAKER_STEPS_FB_TO_BTC.length - 1]).toBe('Done');
    expect(TAKER_STEPS_FB_TO_BTC[TAKER_STEPS_FB_TO_BTC.length - 1]).toBe('Done');
  });

  it('BTC_TO_FB maker step 1 mentions Lock BTC', () => {
    expect(MAKER_STEPS_BTC_TO_FB[0]).toContain('Lock BTC');
  });

  it('FB_TO_BTC taker step 1 mentions Lock BTC', () => {
    expect(TAKER_STEPS_FB_TO_BTC[0]).toContain('Lock BTC');
  });
});

// ---- SwapDirection reverse mapping ----
describe('SwapDirection reverse lookup', () => {
  it('SwapDirection[1] = BTC_TO_FB', () => {
    expect(SwapDirection[1]).toBe('BTC_TO_FB');
  });

  it('SwapDirection[2] = FB_TO_BTC', () => {
    expect(SwapDirection[2]).toBe('FB_TO_BTC');
  });
});

// ---- OrderStatus reverse mapping ----
describe('OrderStatus reverse lookup', () => {
  it('OrderStatus[1] = Open', () => {
    expect(OrderStatus[1]).toBe('Open');
  });

  it('OrderStatus[5] = Refunded', () => {
    expect(OrderStatus[5]).toBe('Refunded');
  });
});

// ---- fmtBtc additional edge cases ----
describe('fmtBtc edge cases', () => {
  it('formats exactly 0.01 BTC (boundary between toFixed(6) and toFixed(8))', () => {
    expect(fmtBtc(1_000_000n)).toBe('0.01');
  });

  it('formats exactly 1 BTC (boundary for toFixed(4))', () => {
    expect(fmtBtc(100_000_000n)).toBe('1');
  });

  it('formats 0.00999999 BTC (just below 0.01)', () => {
    const result = fmtBtc(999_999n);
    expect(result).toBe('0.00999999');
  });

  it('formats 0.99999999 BTC', () => {
    const result = fmtBtc(99_999_999n);
    // 0.99999999 >= 0.01 => toFixed(6) => '1.000000' => trim => '1'
    expect(result).toBe('1');
  });

  it('formats very large amount (100 BTC)', () => {
    const result = fmtBtc(10_000_000_000n);
    expect(result).toBe('100');
  });
});

// ---- satsToBtc additional edge cases ----
describe('satsToBtc edge cases', () => {
  it('formats 100 sats', () => {
    expect(satsToBtc(100n)).toBe('0.000001 BTC');
  });

  it('formats with FB unit and small amount', () => {
    expect(satsToBtc(100n, 'FB')).toBe('0.000001 FB');
  });
});

// ---- fmtRate additional edge cases ----
describe('fmtRate edge cases', () => {
  it('formats very small rate', () => {
    // 1 sat BTC / 100M sat FB = very tiny rate
    const result = fmtRate(1n, 100_000_000n);
    expect(result).toBe('1:0');
  });

  it('formats very large rate', () => {
    const result = fmtRate(100_000_000_000n, 1n);
    const expected = '1:' + (100_000_000_000).toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    expect(result).toBe(expected);
  });
});

// ---- Style constants ----
describe('style constants', () => {
  it('iStyle has expected properties', () => {
    expect(iStyle.width).toBe('100%');
    expect(iStyle.borderRadius).toBe(12);
    expect(iStyle.outline).toBe('none');
    expect(iStyle.boxSizing).toBe('border-box');
  });

  it('labelStyle has textTransform uppercase', () => {
    expect(labelStyle.textTransform).toBe('uppercase');
    expect(labelStyle.display).toBe('block');
  });

  it('btnSmall has cursor pointer', () => {
    expect(btnSmall.cursor).toBe('pointer');
    expect(btnSmall.borderRadius).toBe(8);
  });
});

// ---- STATUS_COLORS detailed ----
describe('STATUS_COLORS detailed', () => {
  it('Open is green', () => {
    expect(STATUS_COLORS[OrderStatus.Open]!.text).toBe('#22c55e');
  });

  it('Taken is amber', () => {
    expect(STATUS_COLORS[OrderStatus.Taken]!.text).toBe('#f59e0b');
  });

  it('Completed is blue', () => {
    expect(STATUS_COLORS[OrderStatus.Completed]!.text).toBe('#3b82f6');
  });

  it('Cancelled is gray', () => {
    expect(STATUS_COLORS[OrderStatus.Cancelled]!.text).toBe('#6b7280');
  });

  it('Refunded is red', () => {
    expect(STATUS_COLORS[OrderStatus.Refunded]!.text).toBe('#ef4444');
  });

  it('all bg values contain rgba', () => {
    for (const key of [1, 2, 3, 4, 5]) {
      expect(STATUS_COLORS[key]!.bg).toContain('rgba');
    }
  });
});
