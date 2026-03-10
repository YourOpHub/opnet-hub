/**
 * config-extended.test.ts -- Extended tests for src/config.ts
 *
 * Covers: CURRENT_ENV, OPSCAN_NETWORK, OPNetEnv type runtime checks
 */
import { describe, it, expect } from 'vitest';

import { CURRENT_ENV, NETWORK, RPC_URL, OPSCAN_NETWORK } from '../config';

describe('config extended', () => {
  describe('CURRENT_ENV', () => {
    it('is a valid OPNetEnv', () => {
      expect(['testnet', 'mainnet', 'regtest']).toContain(CURRENT_ENV);
    });

    it('defaults to testnet in test environment', () => {
      expect(CURRENT_ENV).toBe('testnet');
    });
  });

  describe('OPSCAN_NETWORK', () => {
    it('is op_testnet for testnet env', () => {
      expect(OPSCAN_NETWORK).toBe('op_testnet');
    });
  });

  describe('NETWORK', () => {
    it('is defined and has bech32 property', () => {
      expect(NETWORK).toBeDefined();
      expect(NETWORK.bech32).toBeDefined();
    });

    it('bech32 is opt for OPNet testnet', () => {
      expect(NETWORK.bech32).toBe('opt');
    });

    it('has pubKeyHash and scriptHash', () => {
      expect(typeof NETWORK.pubKeyHash).toBe('number');
      expect(typeof NETWORK.scriptHash).toBe('number');
    });
  });

  describe('RPC_URL', () => {
    it('is a valid URL string', () => {
      expect(RPC_URL).toMatch(/^https?:\/\//);
    });

    it('contains json-rpc endpoint', () => {
      expect(RPC_URL).toContain('json-rpc');
    });

    it('matches testnet endpoint', () => {
      expect(RPC_URL).toContain('testnet');
    });
  });
});
