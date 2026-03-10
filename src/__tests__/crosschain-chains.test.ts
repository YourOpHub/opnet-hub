/**
 * crosschain-chains.test.ts — Tests for src/crosschain/chains.ts
 *
 * Covers: SUPPORTED_CHAINS, getChainById, validateAddress, getChainTxUrl,
 *         getChainAddressUrl, suggestedExpiryBlocks.
 */
import { describe, it, expect } from 'vitest';

import {
  SUPPORTED_CHAINS,
  getChainById,
  validateAddress,
  getChainTxUrl,
  getChainAddressUrl,
  suggestedExpiryBlocks,
} from '../crosschain/chains';

// ─── SUPPORTED_CHAINS ───
describe('SUPPORTED_CHAINS', () => {
  it('has at least one chain', () => {
    expect(SUPPORTED_CHAINS.length).toBeGreaterThanOrEqual(1);
  });

  it('Fractal Bitcoin is chain ID 1', () => {
    const fractal = SUPPORTED_CHAINS.find(c => c.id === 1);
    expect(fractal).toBeDefined();
    expect(fractal!.name).toBe('Fractal Bitcoin');
    expect(fractal!.shortName).toBe('Fractal');
    expect(fractal!.type).toBe('utxo');
    expect(fractal!.settlement).toBe('htlc');
    expect(fractal!.nativeAsset).toBe('FB-BTC');
    expect(fractal!.testnetAvailable).toBe(true);
  });

  it('all chains have required fields', () => {
    for (const chain of SUPPORTED_CHAINS) {
      expect(chain.id).toBeGreaterThan(0);
      expect(chain.name).toBeTruthy();
      expect(chain.shortName).toBeTruthy();
      expect(chain.icon).toBeTruthy();
      expect(chain.color).toMatch(/^#/);
      expect(['utxo', 'evm']).toContain(chain.type);
      expect(['htlc', 'relayer']).toContain(chain.settlement);
      expect(chain.addressRegex).toBeInstanceOf(RegExp);
      expect(chain.addressPlaceholder).toBeTruthy();
      expect(chain.explorerUrl).toMatch(/^https:\/\//);
      expect(chain.nativeAsset).toBeTruthy();
      expect(typeof chain.testnetAvailable).toBe('boolean');
    }
  });
});

// ─── getChainById ───
describe('getChainById', () => {
  it('returns Fractal for ID 1', () => {
    const chain = getChainById(1);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe('Fractal Bitcoin');
  });

  it('returns undefined for unknown ID', () => {
    expect(getChainById(999)).toBeUndefined();
    expect(getChainById(0)).toBeUndefined();
    expect(getChainById(-1)).toBeUndefined();
  });
});

// ─── validateAddress ───
describe('validateAddress', () => {
  // Fractal uses bc1/fb1/tb1 address format
  describe('Fractal Bitcoin (chain 1)', () => {
    it('validates fb1 addresses', () => {
      expect(validateAddress(1, 'fb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    });

    it('validates bc1 addresses', () => {
      expect(validateAddress(1, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    });

    it('validates tb1 addresses', () => {
      expect(validateAddress(1, 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    });

    it('rejects opt1 addresses', () => {
      expect(validateAddress(1, 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateAddress(1, '')).toBe(false);
    });

    it('rejects too-short address', () => {
      expect(validateAddress(1, 'fb1short')).toBe(false);
    });

    it('rejects non-bech32 address', () => {
      expect(validateAddress(1, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
    });

    it('validates long bech32m addresses (taproot)', () => {
      // Taproot addresses are longer
      const taproot = 'bc1p' + 'a'.repeat(58);
      expect(validateAddress(1, taproot)).toBe(true);
    });
  });

  it('returns false for unknown chain ID', () => {
    expect(validateAddress(999, 'anything')).toBe(false);
  });
});

// ─── getChainTxUrl ───
describe('getChainTxUrl', () => {
  it('returns correct Fractal explorer URL', () => {
    const url = getChainTxUrl(1, 'abc123');
    expect(url).toBe('https://explorer.fractalbitcoin.io/tx/abc123');
  });

  it('returns # for unknown chain', () => {
    expect(getChainTxUrl(999, 'abc')).toBe('#');
  });

  it('handles empty txid', () => {
    const url = getChainTxUrl(1, '');
    expect(url).toBe('https://explorer.fractalbitcoin.io/tx/');
  });
});

// ─── getChainAddressUrl ───
describe('getChainAddressUrl', () => {
  it('returns correct Fractal explorer URL', () => {
    const url = getChainAddressUrl(1, 'fb1qtest');
    expect(url).toBe('https://explorer.fractalbitcoin.io/address/fb1qtest');
  });

  it('returns # for unknown chain', () => {
    expect(getChainAddressUrl(999, 'addr')).toBe('#');
  });
});

// ─── suggestedExpiryBlocks ───
describe('suggestedExpiryBlocks', () => {
  it('returns default values for Fractal', () => {
    const result = suggestedExpiryBlocks(1);
    expect(result.min).toBe(72);
    expect(result.default).toBe(144);
    expect(result.max).toBe(576);
  });

  it('returns fallback for unknown chain', () => {
    const result = suggestedExpiryBlocks(999);
    expect(result.min).toBe(72);
    expect(result.default).toBe(144);
    expect(result.max).toBe(576);
  });

  it('min < default < max', () => {
    const result = suggestedExpiryBlocks(1);
    expect(result.min).toBeLessThan(result.default);
    expect(result.default).toBeLessThan(result.max);
  });
});
