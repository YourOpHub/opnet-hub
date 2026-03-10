/**
 * contracts-extended.test.ts -- Extended tests for src/contracts.ts
 *
 * Covers: getAddressUrl, getBlockUrl, addressToPubkey, OPSCAN_API_BASE,
 *         CROSSCHAIN_SELECTORS, TOKEN_ESCROW_SELECTORS, NATIVESWAP_SELECTORS,
 *         FEE_RECIPIENT_ADDR, TESTNET_CONTRACTS shape, ContractTokenInfo.
 */
import { describe, it, expect } from 'vitest';

import {
  DEPLOYED_CONTRACTS,
  TESTNET_CONTRACTS,
  getAddressUrl,
  getBlockUrl,
  getTxUrl,
  getContractOpscanUrl,
  addressToPubkey,
  OPSCAN_API_BASE,
  OPSCAN_EXPLORER_URL,
  POOL_ADDRESS,
  POOL_PUBKEY,
  POOL_HEX,
  POOL_SELECTORS,
  STAKING_ADDRESS,
  STAKING_PUBKEY,
  MARKET_ADDRESS,
  MARKET_PUBKEY,
  MARKET_HEX,
  CROSSCHAIN_ADDRESS,
  CROSSCHAIN_PUBKEY,
  CROSSCHAIN_SELECTORS,
  TOKEN_ESCROW_SELECTORS,
  NATIVESWAP_ADDRESS,
  NATIVESWAP_PUBKEY,
  NATIVESWAP_HEX,
  NATIVESWAP_SELECTORS,
  FEE_RECIPIENT_ADDR,
  DEPLOYER_ADDRESS,
  DEPLOYER_MLDSA_HEX,
  DEPLOYER_TWEAKED_HEX,
  MINE_DEPLOY_TXID,
  VIBE_DEPLOY_TXID,
  TOKEN_ESCROW_ADDRESS,
  MOTOSWAP_FACTORY_ADDRESS,
  MOTOSWAP_ROUTER_ADDRESS,
} from '../contracts';

// ---- URL Helpers ----
describe('URL helpers', () => {
  describe('getAddressUrl', () => {
    it('builds opscan account URL', () => {
      const url = getAddressUrl('opt1wallet');
      expect(url).toContain('opscan.org');
      expect(url).toContain('opt1wallet');
      expect(url).toContain('network=');
    });

    it('different addresses produce different URLs', () => {
      expect(getAddressUrl('opt1a')).not.toBe(getAddressUrl('opt1b'));
    });
  });

  describe('getBlockUrl', () => {
    it('builds opscan block URL with height', () => {
      const url = getBlockUrl(100);
      expect(url).toContain('opscan.org');
      expect(url).toContain('100');
      expect(url).toContain('blocks');
    });

    it('handles block 0', () => {
      const url = getBlockUrl(0);
      expect(url).toContain('/blocks/0');
    });

    it('handles large block numbers', () => {
      const url = getBlockUrl(999999);
      expect(url).toContain('999999');
    });
  });

  describe('getTxUrl', () => {
    it('builds opscan transaction URL', () => {
      const url = getTxUrl('0xabc123def');
      expect(url).toContain('transactions');
      expect(url).toContain('0xabc123def');
    });
  });

  describe('getContractOpscanUrl', () => {
    it('builds opscan accounts URL for contract', () => {
      const url = getContractOpscanUrl('opt1sqtest');
      expect(url).toContain('accounts');
      expect(url).toContain('opt1sqtest');
    });
  });
});

// ---- addressToPubkey ----
describe('addressToPubkey', () => {
  it('maps MINE address to MINE pubkey (without 0x)', () => {
    const result = addressToPubkey(DEPLOYED_CONTRACTS.MINE.address);
    const expected = DEPLOYED_CONTRACTS.MINE.pubkey.replace('0x', '');
    expect(result).toBe(expected);
  });

  it('maps VIBE address to VIBE pubkey', () => {
    const result = addressToPubkey(DEPLOYED_CONTRACTS.VIBE.address);
    const expected = DEPLOYED_CONTRACTS.VIBE.pubkey.replace('0x', '');
    expect(result).toBe(expected);
  });

  it('maps POOL_ADDRESS to POOL_HEX', () => {
    const result = addressToPubkey(POOL_ADDRESS);
    expect(result).toBe(POOL_HEX);
  });

  it('maps STAKING_ADDRESS to staking pubkey', () => {
    const result = addressToPubkey(STAKING_ADDRESS);
    expect(result).toBe(STAKING_PUBKEY.replace('0x', ''));
  });

  it('maps MARKET_ADDRESS to MARKET_HEX', () => {
    const result = addressToPubkey(MARKET_ADDRESS);
    expect(result).toBe(MARKET_HEX);
  });

  it('maps CROSSCHAIN_ADDRESS to crosschain pubkey', () => {
    const result = addressToPubkey(CROSSCHAIN_ADDRESS);
    expect(result).toBe(CROSSCHAIN_PUBKEY.replace('0x', ''));
  });

  it('returns address as-is for unknown addresses', () => {
    expect(addressToPubkey('opt1unknown')).toBe('opt1unknown');
    expect(addressToPubkey('0xdeadbeef')).toBe('0xdeadbeef');
    expect(addressToPubkey('')).toBe('');
  });

  it('maps NATIVESWAP_ADDRESS to NATIVESWAP_HEX', () => {
    if (NATIVESWAP_ADDRESS) {
      const result = addressToPubkey(NATIVESWAP_ADDRESS);
      expect(result).toBe(NATIVESWAP_HEX);
    }
  });
});

// ---- OPSCAN URLs ----
describe('OPSCAN constants', () => {
  it('OPSCAN_API_BASE contains opscan.org', () => {
    expect(OPSCAN_API_BASE).toContain('opscan.org');
    expect(OPSCAN_API_BASE).toContain('v1');
  });

  it('OPSCAN_EXPLORER_URL is a valid URL', () => {
    expect(OPSCAN_EXPLORER_URL).toMatch(/^https?:\/\//);
  });
});

// ---- TESTNET_CONTRACTS shape ----
describe('TESTNET_CONTRACTS', () => {
  it('MINE has all required fields', () => {
    const mine = TESTNET_CONTRACTS.MINE;
    expect(mine.address).toMatch(/^opt1/);
    expect(mine.pubkey).toMatch(/^0x/);
    expect(mine.symbol).toBe('MINE');
    expect(mine.name).toBe('Mine Token');
    expect(mine.decimals).toBe(8);
    expect(mine.supply).toBe(21_000_000);
    expect(mine.publicMint).toBe(true);
    expect(mine.maxMintPerTx).toBe(1_000_000);
    expect(mine.deployTxid).toBeDefined();
    expect(mine.deployTxid.length).toBeGreaterThan(0);
  });

  it('VIBE has all required fields', () => {
    const vibe = TESTNET_CONTRACTS.VIBE;
    expect(vibe.symbol).toBe('VIBE');
    expect(vibe.name).toBe('Vibe Token');
    expect(vibe.supply).toBe(100_000_000);
    expect(vibe.maxMintPerTx).toBe(5_000_000);
  });
});

// ---- Selectors ----
describe('CROSSCHAIN_SELECTORS', () => {
  it('has all expected selectors', () => {
    const expected = [
      'createOrder', 'takeOrder', 'completeOrder', 'relayerComplete',
      'cancelOrder', 'refundExpired', 'getOrder', 'getNextOrderId',
      'setFeeRecipient', 'setFeeBps', 'setRelayer', 'getFeeInfo',
    ];
    for (const name of expected) {
      expect(CROSSCHAIN_SELECTORS[name as keyof typeof CROSSCHAIN_SELECTORS]).toBeDefined();
      expect(typeof CROSSCHAIN_SELECTORS[name as keyof typeof CROSSCHAIN_SELECTORS]).toBe('number');
      expect(CROSSCHAIN_SELECTORS[name as keyof typeof CROSSCHAIN_SELECTORS]).toBeGreaterThan(0);
    }
  });

  it('relayerComplete selector is 0x4e402884', () => {
    expect(CROSSCHAIN_SELECTORS.relayerComplete).toBe(0x4e402884);
  });

  it('setRelayer selector is 0x2b07d4c5', () => {
    expect(CROSSCHAIN_SELECTORS.setRelayer).toBe(0x2b07d4c5);
  });
});

describe('TOKEN_ESCROW_SELECTORS', () => {
  it('has confirmSwap selector', () => {
    expect(TOKEN_ESCROW_SELECTORS.confirmSwap).toBeDefined();
    expect(typeof TOKEN_ESCROW_SELECTORS.confirmSwap).toBe('number');
  });

  it('has all expected selectors', () => {
    const expected = [
      'createOrder', 'takeOrder', 'confirmSwap', 'cancelOrder',
      'refundExpired', 'getOrder', 'getNextOrderId', 'getFeeInfo',
      'setFeeRecipient', 'setFeeBps',
    ];
    for (const name of expected) {
      expect(TOKEN_ESCROW_SELECTORS[name as keyof typeof TOKEN_ESCROW_SELECTORS]).toBeGreaterThan(0);
    }
  });
});

describe('NATIVESWAP_SELECTORS', () => {
  it('has key swap selectors', () => {
    expect(NATIVESWAP_SELECTORS.addLiquidity).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.removeLiquidity).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.reserveBuyToken).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.executeBuyToken).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.sellTokenForBTC).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.getReserves).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.getQuoteBuyToken).toBeGreaterThan(0);
    expect(NATIVESWAP_SELECTORS.getQuoteSellToken).toBeGreaterThan(0);
  });

  it('shares getReserves selector with POOL', () => {
    // Both pool and nativeswap use same sha256 selector for getReserves
    expect(NATIVESWAP_SELECTORS.getReserves).toBe(POOL_SELECTORS.getReserves);
  });
});

// ---- Misc exports ----
describe('misc contract exports', () => {
  it('FEE_RECIPIENT_ADDR starts with opt1', () => {
    expect(FEE_RECIPIENT_ADDR).toMatch(/^opt1/);
  });

  it('DEPLOYER_ADDRESS starts with opt1p', () => {
    expect(DEPLOYER_ADDRESS).toMatch(/^opt1p/);
  });

  it('DEPLOYER_MLDSA_HEX is 64-char hex', () => {
    expect(DEPLOYER_MLDSA_HEX).toMatch(/^[a-f0-9]{64}$/);
  });

  it('DEPLOYER_TWEAKED_HEX is 64-char hex', () => {
    expect(DEPLOYER_TWEAKED_HEX).toMatch(/^[a-f0-9]{64}$/);
  });

  it('MINE_DEPLOY_TXID and VIBE_DEPLOY_TXID are non-empty', () => {
    expect(MINE_DEPLOY_TXID.length).toBeGreaterThan(0);
    expect(VIBE_DEPLOY_TXID.length).toBeGreaterThan(0);
  });

  it('TOKEN_ESCROW_ADDRESS is empty (removed)', () => {
    expect(TOKEN_ESCROW_ADDRESS).toBe('');
  });

  it('MOTOSWAP addresses start with opt1', () => {
    expect(MOTOSWAP_FACTORY_ADDRESS).toMatch(/^opt1/);
    expect(MOTOSWAP_ROUTER_ADDRESS).toMatch(/^opt1/);
  });

  it('POOL_HEX is POOL_PUBKEY without 0x', () => {
    expect(POOL_HEX).toBe(POOL_PUBKEY.replace('0x', ''));
  });

  it('MARKET_HEX is MARKET_PUBKEY without 0x', () => {
    expect(MARKET_HEX).toBe(MARKET_PUBKEY.replace('0x', ''));
  });

  it('NATIVESWAP_HEX is NATIVESWAP_PUBKEY without 0x', () => {
    expect(NATIVESWAP_HEX).toBe(NATIVESWAP_PUBKEY.replace('0x', ''));
  });
});
