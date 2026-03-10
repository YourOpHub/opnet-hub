/**
 * format.test.ts — Tests for src/utils/format.ts
 *
 * Covers: truncateAddress, formatNumber, randomBetween, distance, lerp, hslToString.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  truncateAddress,
  formatNumber,
  randomBetween,
  distance,
  lerp,
  hslToString,
} from '../utils/format';

// ─── truncateAddress ───
describe('truncateAddress', () => {
  it('truncates long address', () => {
    const addr = 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa';
    const result = truncateAddress(addr);
    // truncateAddress: first 8 + "..." + last 6 chars
    expect(result).toBe('opt1sqrw...cseewa');
    expect(result.length).toBeLessThan(addr.length);
  });

  it('does not truncate short address (<= 14 chars)', () => {
    expect(truncateAddress('short')).toBe('short');
    expect(truncateAddress('12345678901234')).toBe('12345678901234');
  });

  it('truncates address exactly 15 chars', () => {
    const result = truncateAddress('123456789012345');
    // first 8 + "..." + last 6 = "12345678...012345"
    expect(result).toBe('12345678...012345');
  });

  it('handles empty string', () => {
    expect(truncateAddress('')).toBe('');
  });

  it('handles 14-char string (boundary)', () => {
    expect(truncateAddress('12345678901234')).toBe('12345678901234');
  });

  it('preserves first 8 and last 6 chars', () => {
    const addr = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateAddress(addr);
    expect(result.startsWith('abcdefgh')).toBe(true);
    expect(result.endsWith('uvwxyz')).toBe(true);
    expect(result).toContain('...');
  });
});

// ─── formatNumber ───
describe('formatNumber', () => {
  it('formats millions', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
    expect(formatNumber(5_500_000)).toBe('5.5M');
    expect(formatNumber(21_000_000)).toBe('21.0M');
  });

  it('formats thousands', () => {
    expect(formatNumber(1_000)).toBe('1.0K');
    expect(formatNumber(50_000)).toBe('50.0K');
    expect(formatNumber(999_999)).toBe('1000.0K');
  });

  it('formats small numbers with locale string', () => {
    const result = formatNumber(500);
    expect(result).toBe('500');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats negative numbers', () => {
    // formatNumber doesn't handle negatives specially
    const result = formatNumber(-500);
    expect(result).toContain('500');
  });

  it('formats 1M boundary', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
  });

  it('formats 1K boundary', () => {
    expect(formatNumber(1_000)).toBe('1.0K');
  });
});

// ─── randomBetween ───
describe('randomBetween', () => {
  it('returns value within range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = randomBetween(10, 20);
    expect(result).toBe(15); // 10 + 0.5 * 10
    vi.restoreAllMocks();
  });

  it('returns min when random=0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randomBetween(5, 10)).toBe(5);
    vi.restoreAllMocks();
  });

  it('returns near max when random=0.999', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const result = randomBetween(0, 100);
    expect(result).toBeCloseTo(99.9, 1);
    vi.restoreAllMocks();
  });

  it('handles same min and max', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(randomBetween(5, 5)).toBe(5);
    vi.restoreAllMocks();
  });

  it('handles negative range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(randomBetween(-10, -5)).toBe(-7.5);
    vi.restoreAllMocks();
  });
});

// ─── distance ───
describe('distance', () => {
  it('calculates distance between same point', () => {
    expect(distance(5, 5, 5, 5)).toBe(0);
  });

  it('calculates horizontal distance', () => {
    expect(distance(0, 0, 10, 0)).toBe(10);
  });

  it('calculates vertical distance', () => {
    expect(distance(0, 0, 0, 10)).toBe(10);
  });

  it('calculates diagonal distance (3-4-5 triangle)', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it('is symmetric', () => {
    expect(distance(1, 2, 5, 8)).toBe(distance(5, 8, 1, 2));
  });

  it('handles negative coordinates', () => {
    expect(distance(-3, -4, 0, 0)).toBe(5);
  });

  it('handles large values', () => {
    const d = distance(0, 0, 1000, 1000);
    expect(d).toBeCloseTo(1414.21, 1);
  });
});

// ─── lerp ───
describe('lerp', () => {
  it('returns a when t=0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns b when t=1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('returns midpoint when t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it('handles negative values', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  it('handles same a and b', () => {
    expect(lerp(5, 5, 0.7)).toBe(5);
  });

  it('extrapolates when t > 1', () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it('extrapolates when t < 0', () => {
    expect(lerp(0, 10, -1)).toBe(-10);
  });

  it('handles fractional values', () => {
    expect(lerp(0, 1, 0.25)).toBeCloseTo(0.25);
  });
});

// ─── hslToString ───
describe('hslToString', () => {
  it('creates HSL string with default alpha', () => {
    expect(hslToString(180, 50, 50)).toBe('hsla(180, 50%, 50%, 1)');
  });

  it('creates HSL string with custom alpha', () => {
    expect(hslToString(0, 100, 50, 0.5)).toBe('hsla(0, 100%, 50%, 0.5)');
  });

  it('handles 0 alpha', () => {
    expect(hslToString(120, 80, 60, 0)).toBe('hsla(120, 80%, 60%, 0)');
  });

  it('handles max values', () => {
    expect(hslToString(360, 100, 100, 1)).toBe('hsla(360, 100%, 100%, 1)');
  });

  it('handles 0 values', () => {
    expect(hslToString(0, 0, 0, 0)).toBe('hsla(0, 0%, 0%, 0)');
  });

  it('handles fractional hue', () => {
    expect(hslToString(180.5, 50, 50, 0.8)).toBe('hsla(180.5, 50%, 50%, 0.8)');
  });
});
