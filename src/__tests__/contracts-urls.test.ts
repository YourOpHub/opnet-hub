/**
 * contracts-urls.test.ts -- Extended tests for src/contracts.ts URL builders and constants
 *
 * Covers: getAddressUrl, getBlockUrl, addressToPubkey, CROSSCHAIN/NATIVESWAP/MOTOSWAP
 *         constants, hex derivations, and additional selector coverage.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  DEPLOYED_CONTRACTS,
  TESTNET_CONTRACTS,
  DEPLOYER_MLDSA_HEX,
  DEPLOYER_TWEAKED_HEX,
  MINE_DEPLOY_TXID,
  VIBE_DEPLOY_TXID,
  POOL_ADDRESS,
  POOL_PUBKEY,
  POOL_HEX,
  MARKET_ADDRESS,
  MARKET_HEX,
  CROSSCHAIN_ADDRESS,
  CROSSCHAIN_PUBKEY,
  CROSSCHAIN_SELECTORS,
  TOKEN_ESCROW_ADDRESS,
  TOKEN_ESCROW_PUBKEY,
  TOKEN_ESCROW_HEX,
  TOKEN_ESCROW_SELECTORS,
  NATIVESWAP_ADDRESS,
  NATIVESWAP_PUBKEY,
  NATIVESWAP_HEX,
  NATIVESWAP_SELECTORS,
  FEE_RECIPIENT_ADDR,
  MOTOSWAP_FACTORY_ADDRESS,
  MOTOSWAP_FACTORY_PUBKEY,
  MOTOSWAP_ROUTER_ADDRESS,
  MOTOSWAP_ROUTER_PUBKEY,
  MOTO_TOKEN_PUBKEY,
  getAddressUrl,
  getBlockUrl,
  addressToPubkey,
  OPSCAN_API_BASE,
  OPSCAN_EXPLORER_URL,
} from '../contracts';

// ---- URL builders ----
describe('getAddressUrl', () => {
  it('builds URL with address and network', () => {
    const url = getAddressUrl('opt1test');
    expect(url).toContain('/accounts/opt1test');
    expect(url).toContain('network=');
  });

  it('handles empty address', () => {
    const url = getAddressUrl('');
    expect(url).toContain('/accounts/');
  });
});

describe('getBlockUrl', () => {
  it('builds URL with block height and network', () => {
    const url = getBlockUrl(12345);
    expect(url).toContain('/blocks/12345');
    expect(url).toContain('network=');
  });

  it('handles block 0', () => {
    const url = getBlockUrl(0);
    expect(url).toContain('/blocks/0');
  });
});

// ---- addressToPubkey ----
describe('addressToPubkey', () => {
  it('maps MINE address to pubkey', () => {
    const pubkey = addressToPubkey(DEPLOYED_CONTRACTS.MINE.address);
    expect(pubkey).toBe(DEPLOYED_CONTRACTS.MINE.pubkey.replace('0x', ''));
  });

  it('maps VIBE address to pubkey', () => {
    const pubkey = addressToPubkey(DEPLOYED_CONTRACTS.VIBE.address);
    expect(pubkey).toBe(DEPLOYED_CONTRACTS.VIBE.pubkey.replace('0x', ''));
  });

  it('maps POOL address', () => {
    expect(addressToPubkey(POOL_ADDRESS)).toBe(POOL_HEX);
  });

  it('maps MARKET address', () => {
    expect(addressToPubkey(MARKET_ADDRESS)).toBe(MARKET_HEX);
  });

  it('maps NATIVESWAP address', () => {
    expect(addressToPubkey(NATIVESWAP_ADDRESS)).toBe(NATIVESWAP_HEX);
  });

  it('maps CROSSCHAIN address', () => {
    const pubkey = addressToPubkey(CROSSCHAIN_ADDRESS);
    expect(pubkey).toBe(CROSSCHAIN_PUBKEY.replace('0x', ''));
  });

  it('returns as-is for unknown', () => {
    expect(addressToPubkey('opt1unknown123')).toBe('opt1unknown123');
    expect(addressToPubkey('')).toBe('');
  });
});

// ---- Hex derivations ----
describe('hex derivations', () => {
  it('POOL_HEX is POOL_PUBKEY without 0x', () => {
    expect(POOL_HEX).toBe(POOL_PUBKEY.replace('0x', ''));
  });

  it('MARKET_HEX is correct', () => {
    expect(MARKET_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NATIVESWAP_HEX is correct', () => {
    expect(NATIVESWAP_HEX).toBe(NATIVESWAP_PUBKEY.replace('0x', ''));
    expect(NATIVESWAP_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TOKEN_ESCROW fields are empty (removed)', () => {
    expect(TOKEN_ESCROW_ADDRESS).toBe('');
    expect(TOKEN_ESCROW_PUBKEY).toBe('');
    expect(TOKEN_ESCROW_HEX).toBe('');
  });
});

// ---- Deploy txids ----
describe('deploy txids', () => {
  it('MINE_DEPLOY_TXID is 64 hex chars', () => {
    expect(MINE_DEPLOY_TXID).toMatch(/^[0-9a-f]{64}$/);
  });

  it('VIBE_DEPLOY_TXID is 64 hex chars', () => {
    expect(VIBE_DEPLOY_TXID).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches TESTNET_CONTRACTS deployTxid', () => {
    expect(MINE_DEPLOY_TXID).toBe(TESTNET_CONTRACTS.MINE.deployTxid);
    expect(VIBE_DEPLOY_TXID).toBe(TESTNET_CONTRACTS.VIBE.deployTxid);
  });
});

// ---- Deployer keys ----
describe('deployer keys', () => {
  it('MLDSA hex is 64 chars', () => {
    expect(DEPLOYER_MLDSA_HEX).toHaveLength(64);
  });

  it('tweaked hex is 64 chars', () => {
    expect(DEPLOYER_TWEAKED_HEX).toHaveLength(64);
  });
});

// ---- Motoswap ----
describe('motoswap constants', () => {
  it('factory address starts with opt1', () => {
    expect(MOTOSWAP_FACTORY_ADDRESS).toMatch(/^opt1/);
  });

  it('factory pubkey starts with 0x', () => {
    expect(MOTOSWAP_FACTORY_PUBKEY).toMatch(/^0x/);
  });

  it('router address starts with opt1', () => {
    expect(MOTOSWAP_ROUTER_ADDRESS).toMatch(/^opt1/);
  });

  it('router pubkey starts with 0x', () => {
    expect(MOTOSWAP_ROUTER_PUBKEY).toMatch(/^0x/);
  });

  it('MOTO token pubkey starts with 0x', () => {
    expect(MOTO_TOKEN_PUBKEY).toMatch(/^0x/);
  });
});

// ---- FEE_RECIPIENT_ADDR ----
describe('FEE_RECIPIENT_ADDR', () => {
  it('starts with opt1', () => {
    expect(FEE_RECIPIENT_ADDR).toMatch(/^opt1/);
  });
});

// ---- OPSCAN URLs ----
describe('OPSCAN base URLs', () => {
  it('OPSCAN_API_BASE contains version path', () => {
    expect(OPSCAN_API_BASE).toContain('/v1/');
  });

  it('OPSCAN_EXPLORER_URL is https', () => {
    expect(OPSCAN_EXPLORER_URL).toMatch(/^https:\/\//);
  });
});

// ---- Extended selectors ----
describe('CROSSCHAIN_SELECTORS', () => {
  it('has all v7 selectors', () => {
    expect(CROSSCHAIN_SELECTORS.createOrder).toBe(0x17b631a3);
    expect(CROSSCHAIN_SELECTORS.takeOrder).toBe(0xfe6bb1e1);
    expect(CROSSCHAIN_SELECTORS.completeOrder).toBe(0x39585799);
    expect(CROSSCHAIN_SELECTORS.relayerComplete).toBe(0x4e402884);
    expect(CROSSCHAIN_SELECTORS.cancelOrder).toBe(0xeb5aa830);
    expect(CROSSCHAIN_SELECTORS.refundExpired).toBe(0x7136e9b2);
    expect(CROSSCHAIN_SELECTORS.getOrder).toBe(0xe9489555);
    expect(CROSSCHAIN_SELECTORS.getNextOrderId).toBe(0xf4920cae);
    expect(CROSSCHAIN_SELECTORS.setFeeRecipient).toBe(0x5ccb9ecd);
    expect(CROSSCHAIN_SELECTORS.setFeeBps).toBe(0xfdd3c00b);
    expect(CROSSCHAIN_SELECTORS.setRelayer).toBe(0x2b07d4c5);
    expect(CROSSCHAIN_SELECTORS.getFeeInfo).toBe(0xf22d798d);
  });
});

describe('NATIVESWAP_SELECTORS', () => {
  it('has all v5 selectors', () => {
    expect(NATIVESWAP_SELECTORS.addLiquidity).toBe(0xe4e35d85);
    expect(NATIVESWAP_SELECTORS.removeLiquidity).toBe(0x13100148);
    expect(NATIVESWAP_SELECTORS.reserveBuyToken).toBe(0x4fcdea8a);
    expect(NATIVESWAP_SELECTORS.executeBuyToken).toBe(0x6b44975e);
    expect(NATIVESWAP_SELECTORS.cancelReservation).toBe(0xfe49b2a0);
    expect(NATIVESWAP_SELECTORS.sellTokenForBTC).toBe(0xad1c32b9);
    expect(NATIVESWAP_SELECTORS.getReserves).toBe(0x06374bfc);
    expect(NATIVESWAP_SELECTORS.getQuoteBuyToken).toBe(0xe6989511);
    expect(NATIVESWAP_SELECTORS.getQuoteSellToken).toBe(0x36560481);
    expect(NATIVESWAP_SELECTORS.liquidityOf).toBe(0x28703b84);
    expect(NATIVESWAP_SELECTORS.getReservation).toBe(0x49f7aba5);
    expect(NATIVESWAP_SELECTORS.getToken).toBe(0xff015c72);
    expect(NATIVESWAP_SELECTORS.getPoolInfo).toBe(0x366b0306);
    expect(NATIVESWAP_SELECTORS.setFeeRate).toBe(0x385d614d);
  });
});

describe('TOKEN_ESCROW_SELECTORS', () => {
  it('has all escrow selectors', () => {
    expect(TOKEN_ESCROW_SELECTORS.createOrder).toBe(0xff44b331);
    expect(TOKEN_ESCROW_SELECTORS.takeOrder).toBe(0xfe6bb1e1);
    expect(TOKEN_ESCROW_SELECTORS.confirmSwap).toBe(0x2abfb8f9);
    expect(TOKEN_ESCROW_SELECTORS.cancelOrder).toBe(0xeb5aa830);
    expect(TOKEN_ESCROW_SELECTORS.refundExpired).toBe(0x7136e9b2);
    expect(TOKEN_ESCROW_SELECTORS.getOrder).toBe(0xe9489555);
    expect(TOKEN_ESCROW_SELECTORS.getNextOrderId).toBe(0xf4920cae);
    expect(TOKEN_ESCROW_SELECTORS.getFeeInfo).toBe(0xf22d798d);
    expect(TOKEN_ESCROW_SELECTORS.setFeeRecipient).toBe(0x5ccb9ecd);
    expect(TOKEN_ESCROW_SELECTORS.setFeeBps).toBe(0xfdd3c00b);
  });
});
