/**
 * toolStyles.test.ts -- Tests for src/components/tools/toolStyles.ts
 *
 * Covers: parseHex, formatBigNum, and style constant exports
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  parseHex,
  formatBigNum,
  monoSm,
  cardS,
  rowS,
  labelS,
  valueS,
  btnS,
  inputS,
  copyBtnS,
} from '../components/tools/toolStyles';

// ---- parseHex ----
describe('parseHex', () => {
  it('parses 0x hex to locale number string', () => {
    const result = parseHex('0xff');
    expect(result).toBe('255');
  });

  it('parses large 0x hex value', () => {
    const result = parseHex('0x3B9ACA00'); // 1 billion
    expect(result).toContain('1');
    // Locale string format varies, just check it contains something reasonable
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns string as-is if no 0x prefix', () => {
    expect(parseHex('hello')).toBe('hello');
    expect(parseHex('12345')).toBe('12345');
  });

  it('returns em-dash for non-string input', () => {
    expect(parseHex(undefined as unknown as string)).toBe('—');
    expect(parseHex(null as unknown as string)).toBe('—');
    expect(parseHex(123 as unknown as string)).toBe('—');
  });

  it('handles 0x0', () => {
    expect(parseHex('0x0')).toBe('0');
  });

  it('handles 0x1', () => {
    expect(parseHex('0x1')).toBe('1');
  });

  it('returns the original string on BigInt parse failure', () => {
    // 0xinvalid is not a valid BigInt hex
    const result = parseHex('0xinvalid');
    expect(result).toBe('0xinvalid');
  });

  it('handles empty string', () => {
    expect(parseHex('')).toBe('');
  });
});

// ---- formatBigNum ----
describe('formatBigNum', () => {
  it('formats small numbers as-is', () => {
    expect(formatBigNum('42')).toBe('42');
    expect(formatBigNum('999')).toBe('999');
    expect(formatBigNum('0')).toBe('0');
  });

  it('formats thousands with K suffix', () => {
    expect(formatBigNum('1000')).toBe('1.00K');
    expect(formatBigNum('50000')).toBe('50.00K');
  });

  it('formats millions with M suffix', () => {
    expect(formatBigNum('1000000')).toBe('1.00M');
    expect(formatBigNum('21000000')).toBe('21.00M');
  });

  it('formats billions with B suffix', () => {
    expect(formatBigNum('1000000000')).toBe('1.00B');
  });

  it('formats trillions with T suffix', () => {
    expect(formatBigNum('1000000000000')).toBe('1.00T');
  });

  it('formats 1e15 with e15 suffix', () => {
    expect(formatBigNum('1000000000000000')).toBe('1.00e15');
  });

  it('formats 1e18 with e18 suffix', () => {
    expect(formatBigNum('1000000000000000000')).toBe('1.00e18');
  });

  it('returns original string on parse error', () => {
    expect(formatBigNum('not-a-number')).toBe('not-a-number');
  });

  it('handles negative values', () => {
    // BigInt('-42') works
    expect(formatBigNum('-42')).toBe('-42');
  });
});

// ---- Style exports ----
describe('style constants', () => {
  it('monoSm has fontFamily and fontSize', () => {
    expect(monoSm.fontFamily).toBeDefined();
    expect(monoSm.fontSize).toBeDefined();
  });

  it('cardS has background, border, borderRadius, padding', () => {
    expect(cardS.background).toBeDefined();
    expect(cardS.border).toBeDefined();
    expect(cardS.borderRadius).toBeDefined();
    expect(cardS.padding).toBeDefined();
  });

  it('rowS has display flex', () => {
    expect(rowS.display).toBe('flex');
  });

  it('labelS has color', () => {
    expect(labelS.color).toBeDefined();
  });

  it('valueS extends monoSm', () => {
    expect(valueS.fontFamily).toBe(monoSm.fontFamily);
  });

  it('btnS has padding and borderRadius', () => {
    expect(btnS.padding).toBeDefined();
    expect(btnS.borderRadius).toBeDefined();
  });

  it('inputS has width 100%', () => {
    expect(inputS.width).toBe('100%');
  });

  it('copyBtnS has cursor pointer', () => {
    expect(copyBtnS.cursor).toBe('pointer');
  });
});
