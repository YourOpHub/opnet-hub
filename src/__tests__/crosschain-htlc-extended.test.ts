/**
 * crosschain-htlc-extended.test.ts -- Extended tests for src/crosschain/htlc.ts
 *
 * Covers additional edge cases for formatBlockCountdown, truncateHex,
 * and round-trip verification patterns.
 */
import { describe, it, expect } from 'vitest';

import {
  toHex,
  fromHex,
  hexToBigInt,
  bigIntToHex,
  generatePreimage,
  computeHashlock,
  generateHTLCPair,
  verifyPreimage,
  formatBlockCountdown,
  truncateHex,
} from '../crosschain/htlc';

describe('htlc extended', () => {
  // ---- formatBlockCountdown extended ----
  describe('formatBlockCountdown extended', () => {
    it('exactly 6 blocks = 1h (60 min)', () => {
      expect(formatBlockCountdown(6)).toBe('~1h');
    });

    it('exactly 144 blocks = 1d', () => {
      expect(formatBlockCountdown(144)).toBe('~1d');
    });

    it('145 blocks = 1d with some hours', () => {
      // 145*10=1450 min = 24h 10min => ~1d
      const result = formatBlockCountdown(145);
      expect(result).toMatch(/~1d/);
    });

    it('2 blocks = ~20m', () => {
      expect(formatBlockCountdown(2)).toBe('~20m');
    });

    it('3 blocks = ~30m', () => {
      expect(formatBlockCountdown(3)).toBe('~30m');
    });

    it('custom block time 1 min', () => {
      // 60 blocks * 1 min = 60 min = 1h
      expect(formatBlockCountdown(60, 1)).toBe('~1h');
    });

    it('custom block time 30 min, 2 blocks = 1h', () => {
      expect(formatBlockCountdown(2, 30)).toBe('~1h');
    });

    it('0 blocks returns Expired', () => {
      expect(formatBlockCountdown(0)).toBe('Expired');
    });

    it('-100 blocks returns Expired', () => {
      expect(formatBlockCountdown(-100)).toBe('Expired');
    });

    it('1 block with custom 1440 min time (1 day per block)', () => {
      expect(formatBlockCountdown(1, 1440)).toBe('~1d');
    });

    it('handles fractional block time', () => {
      // 6 blocks * 5.5 min = 33 min
      expect(formatBlockCountdown(6, 5.5)).toBe('~33m');
    });
  });

  // ---- truncateHex extended ----
  describe('truncateHex extended', () => {
    it('chars=1 truncates to X...X', () => {
      const hex = 'abcdef1234567890';
      expect(truncateHex(hex, 1)).toBe('a...0');
    });

    it('chars=0 returns full string with ... prefix (edge case)', () => {
      const hex = 'abcdef1234567890';
      // slice(0,0) = '', slice(-0) = full string
      const result = truncateHex(hex, 0);
      expect(result).toContain('...');
    });

    it('32 byte hex with default chars=6', () => {
      const hex = 'a'.repeat(64);
      expect(truncateHex(hex)).toBe('aaaaaa...aaaaaa');
    });

    it('handles 0x prefix with exact 2*chars length', () => {
      // After stripping 0x, 'abcdef123456' is 12 chars = 2*6
      expect(truncateHex('0xabcdef123456', 6)).toBe('abcdef123456');
    });
  });

  // ---- toHex/fromHex roundtrip ----
  describe('toHex/fromHex roundtrip', () => {
    it('roundtrips 1 byte', () => {
      for (let i = 0; i < 256; i++) {
        const bytes = new Uint8Array([i]);
        expect(fromHex(toHex(bytes))).toEqual(bytes);
      }
    });

    it('roundtrips 32 random bytes', () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      expect(fromHex(toHex(bytes))).toEqual(bytes);
    });
  });

  // ---- hexToBigInt/bigIntToHex roundtrip extended ----
  describe('hexToBigInt/bigIntToHex roundtrip', () => {
    it('roundtrips 1n', () => {
      expect(hexToBigInt(bigIntToHex(1n))).toBe(1n);
    });

    it('roundtrips 2^128', () => {
      const val = 2n ** 128n;
      expect(hexToBigInt(bigIntToHex(val))).toBe(val);
    });

    it('roundtrips 2^255', () => {
      const val = 2n ** 255n;
      expect(hexToBigInt(bigIntToHex(val))).toBe(val);
    });
  });

  // ---- generatePreimage uniqueness ----
  describe('generatePreimage uniqueness', () => {
    it('generates 100 unique preimages', () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i++) {
        set.add(toHex(generatePreimage()));
      }
      expect(set.size).toBe(100);
    });
  });

  // ---- generateHTLCPair multiple ----
  describe('generateHTLCPair multiple', () => {
    it('generates unique pairs', async () => {
      const pair1 = await generateHTLCPair();
      const pair2 = await generateHTLCPair();
      expect(pair1.preimage).not.toBe(pair2.preimage);
      expect(pair1.hashlock).not.toBe(pair2.hashlock);
    });
  });

  // ---- verifyPreimage extended ----
  describe('verifyPreimage extended', () => {
    it('verification fails with swapped preimage and hashlock', async () => {
      const pair = await generateHTLCPair();
      // Use hashlock as preimage — should not verify
      const result = await verifyPreimage(pair.hashlock, pair.preimage);
      expect(result).toBe(false);
    });

    it('verification with 0x prefix on preimage', async () => {
      const pair = await generateHTLCPair();
      // fromHex handles 0x prefix
      const result = await verifyPreimage('0x' + pair.preimage, pair.hashlock);
      expect(result).toBe(true);
    });

    it('verification with both 0x prefixed', async () => {
      const pair = await generateHTLCPair();
      const result = await verifyPreimage('0x' + pair.preimage, '0x' + pair.hashlock);
      expect(result).toBe(true);
    });
  });

  // ---- computeHashlock determinism ----
  describe('computeHashlock determinism', () => {
    it('same input always produces same output', async () => {
      const input = fromHex('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
      const h1 = toHex(await computeHashlock(input));
      const h2 = toHex(await computeHashlock(input));
      const h3 = toHex(await computeHashlock(input));
      expect(h1).toBe(h2);
      expect(h2).toBe(h3);
    });

    it('single bit change produces completely different hash', async () => {
      const a = new Uint8Array(32).fill(0);
      const b = new Uint8Array(32).fill(0);
      b[0] = 1; // flip one bit

      const hashA = toHex(await computeHashlock(a));
      const hashB = toHex(await computeHashlock(b));

      // They should differ in most positions (avalanche effect)
      let differences = 0;
      for (let i = 0; i < 64; i++) {
        if (hashA[i] !== hashB[i]) differences++;
      }
      expect(differences).toBeGreaterThan(10);
    });
  });
});

