import { describe, it, expect } from 'vitest';
import {
  TESTNET_CONTRACTS,
  DEPLOYER_ADDRESS,
  POOL_ADDRESS,
  STAKING_ADDRESS,
  MARKET_ADDRESS,
  POOL_SELECTORS,
  STAKING_SELECTORS,
  MARKET_SELECTORS,
  OP20_SELECTORS,
  getTxUrl,
  getContractOpscanUrl,
} from '../contracts';

describe('TESTNET_CONTRACTS', () => {
  it('MINE has correct properties', () => {
    const mine = TESTNET_CONTRACTS.MINE;
    expect(mine.address).toMatch(/^opt1/);
    expect(mine.symbol).toBe('MINE');
    expect(mine.decimals).toBe(8);
    expect(mine.supply).toBe(21_000_000);
    expect(mine.pubkey).toMatch(/^0x/);
  });

  it('VIBE has correct properties', () => {
    const vibe = TESTNET_CONTRACTS.VIBE;
    expect(vibe.address).toMatch(/^opt1/);
    expect(vibe.symbol).toBe('VIBE');
    expect(vibe.decimals).toBe(8);
    expect(vibe.supply).toBe(100_000_000);
  });
});

describe('contract addresses', () => {
  it('all addresses start with opt1', () => {
    expect(DEPLOYER_ADDRESS).toMatch(/^opt1p/);
    expect(POOL_ADDRESS).toMatch(/^opt1/);
    expect(STAKING_ADDRESS).toMatch(/^opt1/);
    expect(MARKET_ADDRESS).toMatch(/^opt1/);
  });

  it('all addresses are distinct', () => {
    const addrs = [
      TESTNET_CONTRACTS.MINE.address,
      TESTNET_CONTRACTS.VIBE.address,
      POOL_ADDRESS,
      STAKING_ADDRESS,
      MARKET_ADDRESS,
    ];
    expect(new Set(addrs).size).toBe(addrs.length);
  });
});

describe('selectors', () => {
  it('OP20 selectors are non-zero numbers', () => {
    expect(OP20_SELECTORS.transfer).toBeGreaterThan(0);
    expect(OP20_SELECTORS.balanceOf).toBeGreaterThan(0);
    expect(OP20_SELECTORS.allowance).toBeGreaterThan(0);
  });

  it('Pool selectors exist', () => {
    expect(POOL_SELECTORS.swap).toBeGreaterThan(0);
    expect(POOL_SELECTORS.addLiquidity).toBeGreaterThan(0);
    expect(POOL_SELECTORS.getReserves).toBeGreaterThan(0);
  });

  it('Staking selectors exist', () => {
    expect(STAKING_SELECTORS.stake).toBeGreaterThan(0);
    expect(STAKING_SELECTORS.unstake).toBeGreaterThan(0);
    expect(STAKING_SELECTORS.claim).toBeGreaterThan(0);
  });

  it('Market selectors exist', () => {
    expect(MARKET_SELECTORS.createSellOrder).toBeGreaterThan(0);
    expect(MARKET_SELECTORS.fillSellOrder).toBeGreaterThan(0);
    expect(MARKET_SELECTORS.cancelOrder).toBeGreaterThan(0);
  });
});

describe('URL helpers', () => {
  it('getTxUrl returns opscan URL', () => {
    const url = getTxUrl('abc123');
    expect(url).toContain('opscan.org');
    expect(url).toContain('abc123');
    expect(url).toContain('op_testnet');
  });

  it('getContractOpscanUrl returns opscan URL', () => {
    const url = getContractOpscanUrl('opt1test');
    expect(url).toContain('opscan.org');
    expect(url).toContain('opt1test');
  });
});
