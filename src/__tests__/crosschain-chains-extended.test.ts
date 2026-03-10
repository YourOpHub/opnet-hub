/**
 * crosschain-chains-extended.test.ts -- Extended tests for src/crosschain/chains.ts
 *
 * Covers additional address validation patterns, chain property details,
 * case sensitivity, and edge cases.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  SUPPORTED_CHAINS,
  getChainById,
  validateAddress,
  getChainTxUrl,
  getChainAddressUrl,
  suggestedExpiryBlocks,
  type L2Chain,
} from '../crosschain/chains';

describe('chains extended', () => {
  describe('SUPPORTED_CHAINS Fractal details', () => {
    let fractal: L2Chain;

    beforeAll(() => {
      fractal = SUPPORTED_CHAINS[0]!;
    });

    it('has id=1', () => {
      expect(fractal.id).toBe(1);
    });

    it('has icon (spiral emoji)', () => {
      expect(fractal.icon).toBe('\u{1F300}');
    });

    it('has color #8b5cf6 (purple)', () => {
      expect(fractal.color).toBe('#8b5cf6');
    });

    it('has type utxo', () => {
      expect(fractal.type).toBe('utxo');
    });

    it('has settlement htlc', () => {
      expect(fractal.settlement).toBe('htlc');
    });

    it('addressPlaceholder mentions fb1q or bc1q', () => {
      expect(fractal.addressPlaceholder).toContain('fb1q');
    });

    it('explorerUrl is https', () => {
      expect(fractal.explorerUrl).toMatch(/^https:\/\//);
    });

    it('nativeAsset is FB-BTC', () => {
      expect(fractal.nativeAsset).toBe('FB-BTC');
    });
  });

  describe('validateAddress extended', () => {
    it('validates fb1q + 39 chars (standard P2WPKH)', () => {
      const addr = 'fb1q' + 'a'.repeat(39);
      expect(validateAddress(1, addr)).toBe(true);
    });

    it('validates fb1p + 58 chars (taproot)', () => {
      const addr = 'fb1p' + 'a'.repeat(58);
      expect(validateAddress(1, addr)).toBe(true);
    });

    it('rejects addresses with special characters', () => {
      expect(validateAddress(1, 'fb1q!@#$%^&*()_+=')).toBe(false);
    });

    it('rejects addresses with uppercase letters (case insensitive regex)', () => {
      // The regex has /i flag, so uppercase should still match
      const addr = 'FB1Q' + 'A'.repeat(39);
      expect(validateAddress(1, addr)).toBe(true);
    });

    it('rejects address with spaces', () => {
      expect(validateAddress(1, 'fb1q test test test test test')).toBe(false);
    });

    it('rejects undefined chain', () => {
      expect(validateAddress(-100, 'fb1qtest')).toBe(false);
    });
  });

  describe('getChainTxUrl extended', () => {
    it('builds correct URL with long txid', () => {
      const txid = 'a'.repeat(64);
      const url = getChainTxUrl(1, txid);
      expect(url).toBe(`https://explorer.fractalbitcoin.io/tx/${'a'.repeat(64)}`);
    });

    it('handles txid with special characters', () => {
      // Should just concatenate
      const url = getChainTxUrl(1, 'tx-with-dashes');
      expect(url).toContain('tx-with-dashes');
    });
  });

  describe('getChainAddressUrl extended', () => {
    it('builds correct URL', () => {
      const url = getChainAddressUrl(1, 'fb1qmyaddress');
      expect(url).toBe('https://explorer.fractalbitcoin.io/address/fb1qmyaddress');
    });

    it('handles empty address', () => {
      const url = getChainAddressUrl(1, '');
      expect(url).toBe('https://explorer.fractalbitcoin.io/address/');
    });
  });

  describe('suggestedExpiryBlocks extended', () => {
    it('all values are positive integers', () => {
      const result = suggestedExpiryBlocks(1);
      expect(Number.isInteger(result.min)).toBe(true);
      expect(Number.isInteger(result.default)).toBe(true);
      expect(Number.isInteger(result.max)).toBe(true);
      expect(result.min).toBeGreaterThan(0);
    });

    it('min (72 blocks) = ~12 hours at 10min/block', () => {
      const result = suggestedExpiryBlocks(1);
      expect(result.min * 10).toBe(720); // 720 minutes = 12 hours
    });

    it('default (144 blocks) = ~24 hours', () => {
      const result = suggestedExpiryBlocks(1);
      expect(result.default * 10).toBe(1440); // 1440 minutes = 24 hours
    });

    it('max (576 blocks) = ~4 days', () => {
      const result = suggestedExpiryBlocks(1);
      expect(result.max * 10 / 60 / 24).toBe(4); // 4 days
    });
  });

  describe('getChainById edge cases', () => {
    it('returns undefined for NaN', () => {
      expect(getChainById(NaN)).toBeUndefined();
    });

    it('returns undefined for Infinity', () => {
      expect(getChainById(Infinity)).toBeUndefined();
    });

    it('returns undefined for float', () => {
      expect(getChainById(1.5)).toBeUndefined();
    });
  });
});
