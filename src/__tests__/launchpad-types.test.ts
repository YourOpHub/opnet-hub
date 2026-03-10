/**
 * launchpad-types.test.ts -- Tests for src/launchpad/types.ts
 *
 * Covers: getPrice, getPriceAtPct, getMarketCap, getProgress, isGraduated,
 *         fmtMcap, fmtNum, hashColor, genLogo, timeAgo, GRADUATION_PCT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  GRADUATION_PCT,
  getPrice,
  getPriceAtPct,
  getMarketCap,
  getProgress,
  isGraduated,
  fmtMcap,
  fmtNum,
  hashColor,
  genLogo,
  timeAgo,
} from '../launchpad/types';

import type { LaunchToken } from '../launchpad/types';

function makeToken(overrides: Partial<LaunchToken> = {}): LaunchToken {
  return {
    address: 'opt1test',
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 8,
    totalSupply: 21_000_000,
    publicMintSupply: 10_500_000,
    maxMintPerTx: 1_000_000,
    mintedSupply: 0,
    creator: 'opt1creator',
    createdAt: Date.now(),
    description: 'Test token',
    image: null,
    status: 'bonding',
    trades: [],
    replies: [],
    likes: 0,
    ...overrides,
  };
}

// ---- GRADUATION_PCT ----
describe('GRADUATION_PCT', () => {
  it('is 0.80 (80%)', () => {
    expect(GRADUATION_PCT).toBe(0.80);
  });
});

// ---- getPrice ----
describe('getPrice', () => {
  it('returns 0 for zero publicMintSupply', () => {
    expect(getPrice(0, 0)).toBe(0);
  });

  it('returns 0 for negative publicMintSupply', () => {
    expect(getPrice(0, -100)).toBe(0);
  });

  it('returns a positive number for valid inputs', () => {
    const price = getPrice(0, 10_000_000);
    expect(price).toBeGreaterThan(0);
  });

  it('price increases as mintedSupply increases', () => {
    const p1 = getPrice(1_000_000, 10_000_000);
    const p2 = getPrice(5_000_000, 10_000_000);
    const p3 = getPrice(9_000_000, 10_000_000);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it('handles mintedSupply equal to publicMintSupply (capped at 0.99)', () => {
    const price = getPrice(10_000_000, 10_000_000);
    expect(price).toBeGreaterThan(0);
    expect(Number.isFinite(price)).toBe(true);
  });

  it('handles mintedSupply exceeding publicMintSupply (capped at 0.99)', () => {
    const price = getPrice(20_000_000, 10_000_000);
    expect(price).toBeGreaterThan(0);
    expect(Number.isFinite(price)).toBe(true);
  });

  it('price is very low at 0 minted', () => {
    const p0 = getPrice(0, 10_000_000);
    const p50 = getPrice(5_000_000, 10_000_000);
    expect(p0).toBeLessThan(p50);
  });

  it('remaining never goes below 1% of supply', () => {
    // Even at 99% minted, remaining is max(supply*0.01, ...)
    const price = getPrice(9_900_000, 10_000_000);
    expect(Number.isFinite(price)).toBe(true);
    expect(price).toBeGreaterThan(0);
  });
});

// ---- getPriceAtPct ----
describe('getPriceAtPct', () => {
  it('returns same as getPrice for equivalent inputs', () => {
    const supply = 10_000_000;
    const pct = 0.5;
    expect(getPriceAtPct(pct, supply)).toBe(getPrice(pct * supply, supply));
  });

  it('returns getPrice(0, supply) at 0%', () => {
    expect(getPriceAtPct(0, 10_000_000)).toBe(getPrice(0, 10_000_000));
  });

  it('returns getPrice(supply, supply) at 100%', () => {
    expect(getPriceAtPct(1, 10_000_000)).toBe(getPrice(10_000_000, 10_000_000));
  });

  it('price at 80% is higher than at 20%', () => {
    const supply = 10_000_000;
    expect(getPriceAtPct(0.8, supply)).toBeGreaterThan(getPriceAtPct(0.2, supply));
  });
});

// ---- getMarketCap ----
describe('getMarketCap', () => {
  it('returns price * totalSupply', () => {
    const token = makeToken({ mintedSupply: 5_000_000, publicMintSupply: 10_000_000, totalSupply: 21_000_000 });
    const expectedPrice = getPrice(5_000_000, 10_000_000);
    expect(getMarketCap(token)).toBeCloseTo(expectedPrice * 21_000_000, 0);
  });

  it('returns 0 when publicMintSupply is 0', () => {
    const token = makeToken({ publicMintSupply: 0 });
    expect(getMarketCap(token)).toBe(0);
  });

  it('increases as minted supply grows', () => {
    const t1 = makeToken({ mintedSupply: 1_000_000 });
    const t2 = makeToken({ mintedSupply: 5_000_000 });
    expect(getMarketCap(t2)).toBeGreaterThan(getMarketCap(t1));
  });
});

// ---- getProgress ----
describe('getProgress', () => {
  it('returns 0 for 0 minted', () => {
    const token = makeToken({ mintedSupply: 0 });
    expect(getProgress(token)).toBe(0);
  });

  it('returns 0.5 for half minted', () => {
    const token = makeToken({ mintedSupply: 5_250_000, publicMintSupply: 10_500_000 });
    expect(getProgress(token)).toBeCloseTo(0.5);
  });

  it('returns 1.0 for fully minted', () => {
    const token = makeToken({ mintedSupply: 10_500_000, publicMintSupply: 10_500_000 });
    expect(getProgress(token)).toBe(1);
  });

  it('caps at 1.0 for over-minted', () => {
    const token = makeToken({ mintedSupply: 20_000_000, publicMintSupply: 10_500_000 });
    expect(getProgress(token)).toBe(1);
  });

  it('returns 1 for zero publicMintSupply', () => {
    const token = makeToken({ publicMintSupply: 0 });
    expect(getProgress(token)).toBe(1);
  });
});

// ---- isGraduated ----
describe('isGraduated', () => {
  it('returns true when status is graduated', () => {
    const token = makeToken({ status: 'graduated', mintedSupply: 0 });
    expect(isGraduated(token)).toBe(true);
  });

  it('returns true when progress >= 80%', () => {
    const token = makeToken({ mintedSupply: 8_400_000, publicMintSupply: 10_500_000 });
    expect(isGraduated(token)).toBe(true);
  });

  it('returns false when progress < 80% and not graduated', () => {
    const token = makeToken({ mintedSupply: 1_000_000, publicMintSupply: 10_500_000 });
    expect(isGraduated(token)).toBe(false);
  });

  it('returns false when minted is exactly 79%', () => {
    const token = makeToken({ mintedSupply: 8_295_000, publicMintSupply: 10_500_000 });
    // 8295000 / 10500000 = 0.79
    expect(isGraduated(token)).toBe(false);
  });

  it('returns true for pending_confirm status but >= 80%', () => {
    const token = makeToken({ status: 'pending_confirm', mintedSupply: 9_000_000, publicMintSupply: 10_500_000 });
    expect(isGraduated(token)).toBe(true);
  });
});

// ---- fmtMcap ----
describe('fmtMcap', () => {
  it('formats millions', () => {
    expect(fmtMcap(1_000_000)).toBe('1.0M');
    expect(fmtMcap(5_500_000)).toBe('5.5M');
  });

  it('formats thousands', () => {
    expect(fmtMcap(1_000)).toBe('1.0K');
    expect(fmtMcap(50_000)).toBe('50.0K');
    expect(fmtMcap(999_999)).toBe('1000.0K');
  });

  it('formats small numbers', () => {
    expect(fmtMcap(0)).toBe('0');
    expect(fmtMcap(500)).toBe('500');
    expect(fmtMcap(999)).toBe('999');
  });

  it('formats boundary values', () => {
    expect(fmtMcap(1_000)).toBe('1.0K');
    expect(fmtMcap(1_000_000)).toBe('1.0M');
  });

  it('formats decimal values correctly', () => {
    expect(fmtMcap(1_234_567)).toBe('1.2M');
  });
});

// ---- fmtNum ----
describe('fmtNum', () => {
  it('formats billions', () => {
    expect(fmtNum(1_000_000_000)).toBe('1.0B');
    expect(fmtNum(2_500_000_000)).toBe('2.5B');
  });

  it('formats millions', () => {
    expect(fmtNum(1_000_000)).toBe('1.0M');
    expect(fmtNum(21_000_000)).toBe('21.0M');
  });

  it('formats thousands', () => {
    expect(fmtNum(1_000)).toBe('1.0K');
    expect(fmtNum(50_000)).toBe('50.0K');
  });

  it('formats small numbers', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(500)).toBe('500');
    expect(fmtNum(999)).toBe('999');
  });

  it('formats boundary values', () => {
    expect(fmtNum(1_000)).toBe('1.0K');
    expect(fmtNum(1_000_000)).toBe('1.0M');
    expect(fmtNum(1_000_000_000)).toBe('1.0B');
  });
});

// ---- hashColor ----
describe('hashColor', () => {
  it('returns a tuple of two HSL strings', () => {
    const [c1, c2] = hashColor('TEST');
    expect(c1).toMatch(/^hsl\(\d+,75%,55%\)$/);
    expect(c2).toMatch(/^hsl\(\d+,70%,45%\)$/);
  });

  it('returns deterministic colors for same input', () => {
    const [a1, a2] = hashColor('MINE');
    const [b1, b2] = hashColor('MINE');
    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
  });

  it('returns different colors for different inputs', () => {
    const [a1] = hashColor('MINE');
    const [b1] = hashColor('VIBE');
    // Very unlikely to be the same
    expect(a1).not.toBe(b1);
  });

  it('handles empty string', () => {
    const [c1, c2] = hashColor('');
    expect(c1).toMatch(/^hsl\(\d+,75%,55%\)$/);
    expect(c2).toMatch(/^hsl\(\d+,70%,45%\)$/);
  });

  it('handles single character', () => {
    const [c1, c2] = hashColor('A');
    expect(c1).toMatch(/^hsl\(\d+,75%,55%\)$/);
    expect(c2).toMatch(/^hsl\(\d+,70%,45%\)$/);
  });

  it('second color hue is first + 30 mod 360', () => {
    const [c1, c2] = hashColor('TEST');
    const hue1 = parseInt(c1.match(/hsl\((\d+),/)![1]!);
    const hue2 = parseInt(c2.match(/hsl\((\d+),/)![1]!);
    expect(hue2).toBe((hue1 + 30) % 360);
  });
});

// ---- genLogo ----
describe('genLogo', () => {
  it('returns a data URI SVG', () => {
    const logo = genLogo('TEST');
    expect(logo).toMatch(/^data:image\/svg\+xml,/);
  });

  it('includes the symbol text', () => {
    const logo = genLogo('BTC');
    const decoded = decodeURIComponent(logo.replace('data:image/svg+xml,', ''));
    expect(decoded).toContain('BTC');
  });

  it('truncates symbol to 3 chars', () => {
    const logo = genLogo('LONGNAME');
    const decoded = decodeURIComponent(logo.replace('data:image/svg+xml,', ''));
    expect(decoded).toContain('LON');
    expect(decoded).not.toContain('LONGNAME');
  });

  it('uppercases symbol', () => {
    const logo = genLogo('abc');
    const decoded = decodeURIComponent(logo.replace('data:image/svg+xml,', ''));
    expect(decoded).toContain('ABC');
  });

  it('handles empty string with fallback "?"', () => {
    const logo = genLogo('');
    const decoded = decodeURIComponent(logo.replace('data:image/svg+xml,', ''));
    expect(decoded).toContain('?');
  });

  it('uses smaller font for 3+ char symbols', () => {
    const logo3 = genLogo('ABC');
    const decoded3 = decodeURIComponent(logo3.replace('data:image/svg+xml,', ''));
    expect(decoded3).toContain('font-size="13"');

    const logo2 = genLogo('AB');
    const decoded2 = decodeURIComponent(logo2.replace('data:image/svg+xml,', ''));
    expect(decoded2).toContain('font-size="17"');
  });
});

// ---- timeAgo ----
describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows seconds for < 60s', () => {
    const ts = Date.now() - 30_000;
    expect(timeAgo(ts)).toBe('30s ago');
  });

  it('shows 0s for current time', () => {
    expect(timeAgo(Date.now())).toBe('0s ago');
  });

  it('shows minutes for < 60min', () => {
    const ts = Date.now() - 5 * 60_000;
    expect(timeAgo(ts)).toBe('5m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = Date.now() - 3 * 3600_000;
    expect(timeAgo(ts)).toBe('3h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = Date.now() - 2 * 86400_000;
    expect(timeAgo(ts)).toBe('2d ago');
  });

  it('handles 59 seconds', () => {
    const ts = Date.now() - 59_000;
    expect(timeAgo(ts)).toBe('59s ago');
  });

  it('shows 1m at exactly 60s', () => {
    const ts = Date.now() - 60_000;
    expect(timeAgo(ts)).toBe('1m ago');
  });

  it('shows 1h at exactly 3600s', () => {
    const ts = Date.now() - 3600_000;
    expect(timeAgo(ts)).toBe('1h ago');
  });

  it('shows 1d at exactly 86400s', () => {
    const ts = Date.now() - 86400_000;
    expect(timeAgo(ts)).toBe('1d ago');
  });
});
