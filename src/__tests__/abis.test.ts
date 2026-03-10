/**
 * abis.test.ts -- Tests for src/abis.ts
 *
 * Covers: All exported ABI definitions (POOL_ABI, POOL_LP_ABI, POOL_CREATE_ABI,
 *         STAKING_ABI, MARKETPLACE_ABI, FRACTALSWAP_ABI, TOKEN_ESCROW_ABI,
 *         LAUNCHPAD_ABI, MINTABLE_ABI, SPLITTER_DUMMY_ABI).
 *
 * Validates structure: name, type, input/output counts, BitcoinAbiTypes.Function.
 */
import { describe, it, expect } from 'vitest';

import {
  POOL_ABI,
  POOL_LP_ABI,
  POOL_CREATE_ABI,
  STAKING_ABI,
  MARKETPLACE_ABI,
  FRACTALSWAP_ABI,
  TOKEN_ESCROW_ABI,
  LAUNCHPAD_ABI,
  MINTABLE_ABI,
  SPLITTER_DUMMY_ABI,
} from '../abis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbiEntry = { name: string; type?: string; inputs?: any[]; outputs?: any[]; constant?: boolean; [k: string]: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asEntries(abi: any): AbiEntry[] { return abi as AbiEntry[]; }

// ---- Helper to check ABI structure ----
function expectValidAbi(abi: unknown, expectedNames: string[]) {
  const entries = asEntries(abi);
  expect(entries.length).toBe(expectedNames.length);
  for (const entry of entries) {
    expect(entry.name).toBeDefined();
    expect(typeof entry.name).toBe('string');
    expect(entry.type).toBe('function');
  }
  const names = entries.map(e => e.name);
  for (const name of expectedNames) {
    expect(names).toContain(name);
  }
}

// ---- POOL_ABI ----
describe('POOL_ABI', () => {
  it('has 7 functions', () => {
    expect(POOL_ABI.length).toBe(7);
  });

  it('contains all expected pool methods', () => {
    expectValidAbi(POOL_ABI, ['swap', 'getReserves', 'sync', 'addLiquidity', 'removeLiquidity', 'liquidityOf', 'getTokens']);
  });

  it('swap has 3 inputs and 1 output', () => {
    const swap = POOL_ABI.find(e => e.name === 'swap')! as AbiEntry;
    expect(swap.inputs!.length).toBe(3);
    expect(swap.outputs!.length).toBe(1);
  });

  it('getReserves has 0 inputs and 2 outputs', () => {
    const getReserves = POOL_ABI.find(e => e.name === 'getReserves')! as AbiEntry;
    expect(getReserves.inputs!.length).toBe(0);
    expect(getReserves.outputs!.length).toBe(2);
  });

  it('getReserves and getTokens are constant (view) functions', () => {
    const getReserves = POOL_ABI.find(e => e.name === 'getReserves')! as AbiEntry;
    const getTokens = POOL_ABI.find(e => e.name === 'getTokens')! as AbiEntry;
    expect(getReserves.constant).toBe(true);
    expect(getTokens.constant).toBe(true);
  });

  it('swap is not a constant function', () => {
    const swap = POOL_ABI.find(e => e.name === 'swap')! as AbiEntry;
    expect(swap.constant).toBeUndefined();
  });
});

// ---- POOL_LP_ABI ----
describe('POOL_LP_ABI', () => {
  it('has 1 function (liquidityOf)', () => {
    expect(POOL_LP_ABI.length).toBe(1);
    expect(POOL_LP_ABI[0]!.name).toBe('liquidityOf');
  });

  it('liquidityOf has 1 input and 2 outputs', () => {
    const lp = POOL_LP_ABI[0]! as AbiEntry;
    expect(lp.inputs!.length).toBe(1);
    expect(lp.outputs!.length).toBe(2);
  });
});

// ---- POOL_CREATE_ABI ----
describe('POOL_CREATE_ABI', () => {
  it('has 2 functions (getTokens + getReserves)', () => {
    expectValidAbi(POOL_CREATE_ABI, ['getTokens', 'getReserves']);
  });
});

// ---- STAKING_ABI ----
describe('STAKING_ABI', () => {
  it('has 7 functions', () => {
    expect(STAKING_ABI.length).toBe(7);
  });

  it('contains all staking methods', () => {
    expectValidAbi(STAKING_ABI, ['stake', 'unstake', 'claim', 'stakedAmount', 'stakedReward', 'totalStaked', 'getRewardRate']);
  });

  it('stake has 1 input', () => {
    const stake = STAKING_ABI.find(e => e.name === 'stake')! as AbiEntry;
    expect(stake.inputs!.length).toBe(1);
  });

  it('claim has 0 inputs', () => {
    const claim = STAKING_ABI.find(e => e.name === 'claim')! as AbiEntry;
    expect(claim.inputs!.length).toBe(0);
  });

  it('view functions are marked constant', () => {
    const views = ['stakedAmount', 'stakedReward', 'totalStaked', 'getRewardRate'];
    for (const name of views) {
      const entry = STAKING_ABI.find(e => e.name === name)! as AbiEntry;
      expect((entry as AbiEntry).constant).toBe(true);
    }
  });
});

// ---- MARKETPLACE_ABI ----
describe('MARKETPLACE_ABI', () => {
  it('has 8 functions', () => {
    expect(MARKETPLACE_ABI.length).toBe(8);
  });

  it('contains all marketplace methods', () => {
    expectValidAbi(MARKETPLACE_ABI, [
      'createSellOrder', 'fillSellOrder', 'createBuyOrder', 'acceptBuyOrder',
      'executeBuyOrder', 'cancelOrder', 'getOrder', 'getNextOrderId',
    ]);
  });

  it('createSellOrder has 3 inputs', () => {
    const create = MARKETPLACE_ABI.find(e => e.name === 'createSellOrder')! as AbiEntry;
    expect(create.inputs!.length).toBe(3);
  });

  it('getOrder returns 8 output fields', () => {
    const getOrder = MARKETPLACE_ABI.find(e => e.name === 'getOrder')! as AbiEntry;
    expect(getOrder.outputs!.length).toBe(8);
  });

  it('getNextOrderId has no inputs', () => {
    const next = MARKETPLACE_ABI.find(e => e.name === 'getNextOrderId')! as AbiEntry;
    expect(next.inputs!.length).toBe(0);
  });
});

// ---- FRACTALSWAP_ABI ----
describe('FRACTALSWAP_ABI', () => {
  it('has 8 functions', () => {
    expect(FRACTALSWAP_ABI.length).toBe(8);
  });

  it('contains all fractalswap methods', () => {
    expectValidAbi(FRACTALSWAP_ABI, [
      'createOrder', 'takeOrder', 'completeOrder', 'cancelOrder',
      'refundExpired', 'getOrder', 'getNextOrderId', 'getFeeInfo',
    ]);
  });

  it('createOrder has 5 inputs', () => {
    const create = FRACTALSWAP_ABI.find(e => e.name === 'createOrder')! as AbiEntry;
    expect(create.inputs!.length).toBe(5);
  });

  it('getOrder returns 10 output fields', () => {
    const getOrder = FRACTALSWAP_ABI.find(e => e.name === 'getOrder')! as AbiEntry;
    expect(getOrder.outputs!.length).toBe(10);
  });

  it('getFeeInfo returns 2 outputs', () => {
    const feeInfo = FRACTALSWAP_ABI.find(e => e.name === 'getFeeInfo')! as AbiEntry;
    expect(feeInfo.outputs!.length).toBe(2);
  });
});

// ---- TOKEN_ESCROW_ABI ----
describe('TOKEN_ESCROW_ABI', () => {
  it('has 8 functions', () => {
    expect(TOKEN_ESCROW_ABI.length).toBe(8);
  });

  it('contains all token escrow methods', () => {
    expectValidAbi(TOKEN_ESCROW_ABI, [
      'createOrder', 'takeOrder', 'confirmSwap', 'cancelOrder',
      'refundExpired', 'getOrder', 'getNextOrderId', 'getFeeInfo',
    ]);
  });

  it('createOrder has 7 inputs (more than FractalSwap)', () => {
    const create = TOKEN_ESCROW_ABI.find(e => e.name === 'createOrder')! as AbiEntry;
    expect(create.inputs!.length).toBe(7);
  });

  it('getOrder returns 13 output fields', () => {
    const getOrder = TOKEN_ESCROW_ABI.find(e => e.name === 'getOrder')! as AbiEntry;
    expect(getOrder.outputs!.length).toBe(13);
  });

  it('confirmSwap has 2 inputs (orderId + preimage)', () => {
    const confirm = TOKEN_ESCROW_ABI.find(e => e.name === 'confirmSwap')! as AbiEntry;
    expect(confirm.inputs!.length).toBe(2);
  });
});

// ---- LAUNCHPAD_ABI ----
describe('LAUNCHPAD_ABI', () => {
  it('has 6 functions', () => {
    expect(LAUNCHPAD_ABI.length).toBe(6);
  });

  it('contains all launchpad methods', () => {
    expectValidAbi(LAUNCHPAD_ABI, [
      'publicMint', 'totalSupply', 'maximumSupply', 'balanceOf',
      'isPublicMintEnabled', 'getMaxMintPerTx',
    ]);
  });

  it('publicMint has 1 input and 0 outputs', () => {
    const mint = LAUNCHPAD_ABI.find(e => e.name === 'publicMint')! as AbiEntry;
    expect(mint.inputs!.length).toBe(1);
    expect(mint.outputs!.length).toBe(0);
  });

  it('view functions are constant', () => {
    const views = ['totalSupply', 'maximumSupply', 'balanceOf', 'isPublicMintEnabled', 'getMaxMintPerTx'];
    for (const name of views) {
      const entry = LAUNCHPAD_ABI.find(e => e.name === name)! as AbiEntry;
      expect((entry as AbiEntry).constant).toBe(true);
    }
  });
});

// ---- MINTABLE_ABI ----
describe('MINTABLE_ABI (single)', () => {
  it('has 1 function (publicMint)', () => {
    expect(MINTABLE_ABI.length).toBe(1);
    expect(MINTABLE_ABI[0]!.name).toBe('publicMint');
  });

  it('publicMint has 1 input (amount) and 0 outputs', () => {
    const mint = MINTABLE_ABI[0]! as unknown as AbiEntry;
    expect(mint.inputs!.length).toBe(1);
    expect(mint.outputs!.length).toBe(0);
  });
});

// ---- SPLITTER_DUMMY_ABI ----
describe('SPLITTER_DUMMY_ABI', () => {
  it('has 1 function (getReserves)', () => {
    expect(SPLITTER_DUMMY_ABI.length).toBe(1);
    expect(SPLITTER_DUMMY_ABI[0]!.name).toBe('getReserves');
  });

  it('getReserves is constant', () => {
    expect((SPLITTER_DUMMY_ABI[0] as unknown as AbiEntry).constant).toBe(true);
  });

  it('getReserves has 0 inputs and 2 outputs', () => {
    const res = SPLITTER_DUMMY_ABI[0]! as unknown as AbiEntry;
    expect(res.inputs!.length).toBe(0);
    expect(res.outputs!.length).toBe(2);
  });
});

// ---- Cross-ABI consistency checks ----
describe('ABI consistency', () => {
  it('all ABIs are arrays of objects with name and type', () => {
    const allAbis = [
      POOL_ABI, POOL_LP_ABI, POOL_CREATE_ABI, STAKING_ABI,
      MARKETPLACE_ABI, FRACTALSWAP_ABI, TOKEN_ESCROW_ABI,
      LAUNCHPAD_ABI, MINTABLE_ABI, SPLITTER_DUMMY_ABI,
    ];
    for (const abi of allAbis) {
      expect(Array.isArray(abi)).toBe(true);
      for (const entry of abi) {
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.type).toBe('function');
      }
    }
  });

  it('no ABI function has a name starting with underscore', () => {
    const allAbis = [
      POOL_ABI, POOL_LP_ABI, POOL_CREATE_ABI, STAKING_ABI,
      MARKETPLACE_ABI, FRACTALSWAP_ABI, TOKEN_ESCROW_ABI,
      LAUNCHPAD_ABI, MINTABLE_ABI, SPLITTER_DUMMY_ABI,
    ];
    for (const abi of allAbis) {
      for (const entry of abi) {
        expect(entry.name.startsWith('_')).toBe(false);
      }
    }
  });

  it('POOL_ABI and POOL_CREATE_ABI share getTokens and getReserves', () => {
    const poolNames = POOL_ABI.map(e => e.name);
    const createNames = POOL_CREATE_ABI.map(e => e.name);
    expect(poolNames).toContain('getTokens');
    expect(poolNames).toContain('getReserves');
    expect(createNames).toContain('getTokens');
    expect(createNames).toContain('getReserves');
  });

  it('MARKETPLACE and FRACTALSWAP both have cancelOrder', () => {
    expect(MARKETPLACE_ABI.find(e => e.name === 'cancelOrder')).toBeDefined();
    expect(FRACTALSWAP_ABI.find(e => e.name === 'cancelOrder')).toBeDefined();
  });
});
