/**
 * crossChainShared.test.ts -- Tests for src/hooks/crossChainShared.ts
 *
 * Covers: TOKEN_OPTIONS, DIR_SELL_TOKEN, DIR_BUY_TOKEN, resolveToken,
 *         buildP2OPScript constants and helper functions.
 *
 * NOTE: getP2OPAddress is excluded (requires live Address.wrap SDK).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  TOKEN_OPTIONS,
  DIR_SELL_TOKEN,
  DIR_BUY_TOKEN,
  resolveToken,
  buildP2OPScript,
} from '../hooks/crossChainShared';

// ---- Constants ----
describe('crossChainShared constants', () => {
  it('DIR_SELL_TOKEN = 1', () => {
    expect(DIR_SELL_TOKEN).toBe(1);
  });

  it('DIR_BUY_TOKEN = 2', () => {
    expect(DIR_BUY_TOKEN).toBe(2);
  });

  it('TOKEN_OPTIONS is an array with at least MINE and VIBE', () => {
    expect(Array.isArray(TOKEN_OPTIONS)).toBe(true);
    expect(TOKEN_OPTIONS.length).toBeGreaterThanOrEqual(2);
    const symbols = TOKEN_OPTIONS.map(t => t.symbol);
    expect(symbols).toContain('MINE');
    expect(symbols).toContain('VIBE');
  });

  it('TOKEN_OPTIONS entries have required fields', () => {
    for (const tok of TOKEN_OPTIONS) {
      expect(tok.symbol).toBeDefined();
      expect(typeof tok.symbol).toBe('string');
      expect(tok.address).toBeDefined();
      expect(tok.address.startsWith('opt1')).toBe(true);
      expect(tok.pubkey).toBeDefined();
      expect(tok.pubkey.startsWith('0x')).toBe(true);
      expect(typeof tok.decimals).toBe('number');
    }
  });
});

// ---- resolveToken ----
describe('resolveToken', () => {
  it('resolves MINE pubkey hex (without 0x)', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE')!;
    const pubHex = mine.pubkey.replace('0x', '');
    const result = resolveToken(pubHex);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('MINE');
    expect(result!.decimals).toBe(8);
    expect(result!.address).toBe(mine.address);
  });

  it('resolves VIBE pubkey hex (without 0x)', () => {
    const vibe = TOKEN_OPTIONS.find(t => t.symbol === 'VIBE')!;
    const pubHex = vibe.pubkey.replace('0x', '');
    const result = resolveToken(pubHex);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('VIBE');
  });

  it('resolves case-insensitively', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE')!;
    const pubHex = mine.pubkey.replace('0x', '').toUpperCase();
    const result = resolveToken(pubHex);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('MINE');
  });

  it('resolves by suffix match (last 32 chars)', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE')!;
    const pubHex = mine.pubkey.replace('0x', '');
    // Prepend random prefix
    const withPrefix = 'deadbeef' + pubHex;
    const result = resolveToken(withPrefix);
    // Should match by suffix
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('MINE');
  });

  it('returns null for unknown token hex', () => {
    expect(resolveToken('0000000000000000000000000000000000000000000000000000000000000000')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveToken('')).toBeNull();
  });

  it('returns null for short hex', () => {
    expect(resolveToken('abc')).toBeNull();
  });

  it('result includes icon and address', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE')!;
    const pubHex = mine.pubkey.replace('0x', '');
    const result = resolveToken(pubHex)!;
    expect(result.icon).toBeDefined();
    expect(result.address).toBeDefined();
    expect(result.address.startsWith('opt1')).toBe(true);
  });
});

// ---- buildP2OPScript ----
describe('buildP2OPScript', () => {
  it('returns a 34-byte Buffer', () => {
    const hex = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
    const script = buildP2OPScript(hex);
    expect(Buffer.isBuffer(script)).toBe(true);
    expect(script.length).toBe(34);
  });

  it('first byte is OP_16 (0x60)', () => {
    const hex = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
    const script = buildP2OPScript(hex);
    expect(script[0]).toBe(0x60);
  });

  it('second byte is PUSH_32 (0x20)', () => {
    const hex = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
    const script = buildP2OPScript(hex);
    expect(script[1]).toBe(0x20);
  });

  it('bytes 2-33 contain the parsed MLDSA hash', () => {
    const hex = '4ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea';
    const script = buildP2OPScript(hex);
    // First 4 bytes of hash
    expect(script[2]).toBe(0x4c);
    expect(script[3]).toBe(0xa7);
    expect(script[4]).toBe(0x93);
    expect(script[5]).toBe(0x48);
    // Last 2 bytes of hash
    expect(script[32]).toBe(0x4a);
    expect(script[33]).toBe(0xea);
  });

  it('handles all-zero hash', () => {
    const hex = '0'.repeat(64);
    const script = buildP2OPScript(hex);
    expect(script.length).toBe(34);
    expect(script[0]).toBe(0x60);
    expect(script[1]).toBe(0x20);
    for (let i = 2; i < 34; i++) {
      expect(script[i]).toBe(0);
    }
  });

  it('handles all-ff hash', () => {
    const hex = 'f'.repeat(64);
    const script = buildP2OPScript(hex);
    for (let i = 2; i < 34; i++) {
      expect(script[i]).toBe(0xff);
    }
  });

  it('round-trips: rebuilding from same hex produces identical buffer', () => {
    const hex = '0fb4ee127879ea8e617377fc250f362f8ffab44328436e07e0d03ddca91e0f7f';
    const s1 = buildP2OPScript(hex);
    const s2 = buildP2OPScript(hex);
    expect(s1.equals(s2)).toBe(true);
  });
});
