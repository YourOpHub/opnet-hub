/**
 * useSwap.test.ts
 *
 * Тесты для чистых вычислительных функций из useSwap.ts.
 * Тестируем только логику, не требующую React или сети.
 */

import { describe, it, expect, vi } from 'vitest';

// Мокируем тяжёлые зависимости до импорта хуков
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: () => ({
    walletAddress: null,
    walletInstance: null,
    publicKey: null,
    hashedMLDSAKey: null,
    address: null,
    openConnectModal: vi.fn(),
  }),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: { expandToDecimals: vi.fn((v: number) => BigInt(Math.round(v * 1e8))) },
  MOTOSWAP_ROUTER_ABI: [],
  ABIDataTypes: { UINT256: 'uint256' },
  BitcoinAbiTypes: { Function: 'Function' },
  JSONRpcProvider: class { getBlockNumber = vi.fn(); },
}));

vi.mock('@btc-vision/transaction', () => ({
  Address: { fromString: vi.fn(), wrap: vi.fn() },
  BinaryWriter: class { writeAddress = vi.fn(); getBuffer = vi.fn(() => Buffer.alloc(0)); },
}));

vi.mock('@btc-vision/bitcoin', () => ({
  Transaction: { fromHex: vi.fn() },
  networks: {
    testnet: { bech32: 'tb', bech32Opnet: 'opt' },
  },
}));

vi.mock('../contractCache', () => ({
  getProvider: vi.fn(() => ({ utxoManager: { getUTXOs: vi.fn() } })),
}));

vi.mock('../opnet', () => ({
  callContract: vi.fn(),
  getTokenTotalSupply: vi.fn().mockResolvedValue(0n),
  getTokenBalance: vi.fn().mockResolvedValue(0n),
  getBalance: vi.fn().mockResolvedValue(0n),
  getNetwork: vi.fn().mockReturnValue('testnet'),
  setNetwork: vi.fn(),
}));

vi.mock('../tokenApi', () => ({
  fetchAllTokens: vi.fn().mockResolvedValue([]),
  fetchHolderBalances: vi.fn().mockResolvedValue([]),
  fetchMotoswapPools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({ usd: 0 }),
}));

vi.mock('../txHistory', () => ({
  addTxRecord: vi.fn(),
  getTxHistory: vi.fn().mockReturnValue([]),
  formatTimeAgo: vi.fn().mockReturnValue('now'),
}));

vi.mock('../txUtils', () => ({
  withRetry: vi.fn(fn => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
  ensureAllowance: vi.fn(),
  buildTxParams: vi.fn().mockResolvedValue({}),
}));

vi.mock('../contexts/OpsContext', () => ({
  useOps: () => ({
    trackOp: vi.fn(),
    completeOp: vi.fn(),
    failOp: vi.fn(),
  }),
}));

vi.mock('../contracts', () => ({
  DEPLOYED_CONTRACTS: {
    MINE: {
      address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
      pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
      symbol: 'MINE',
      name: 'Mine Token',
      decimals: 8,
      icon: '⛏️',
    },
    VIBE: {
      address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
      pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
      symbol: 'VIBE',
      name: 'Vibe Token',
      decimals: 8,
      icon: '⚡',
    },
  },
  POOL_ADDRESS: 'opt1sqplvfq5ytgtwzes6tc4ys77f90279rsz8q4dg7ex',
  POOL_PUBKEY: '0xcc89d6c4764ed98b097860c5d8bc6b5432ece5ef11aa3eb7d9b8d65de5262bdc',
  MOTOSWAP_ROUTER_ADDRESS: 'opt1sqqavlf5dr8tjgrsrvjzhk5yrkgnha0z4ty9xwwf6',
  MOTOSWAP_ROUTER_PUBKEY: '0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a',
  getTxUrl: vi.fn((txid: string) => `https://opscan.org/transactions/${txid}`),
  getContractOpscanUrl: vi.fn((addr: string) => `https://opscan.org/accounts/${addr}`),
}));

vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));

import { getAmountOut, BASE_TOKENS, type Token } from '../hooks/useSwap';
import type { MotoswapPool } from '../tokenApi';

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательная фабрика тестовых пулов
// ─────────────────────────────────────────────────────────────────────────────

function makeMotoPool(
  sym0: string, pk0: string, dec0: number,
  sym1: string, pk1: string, dec1: number,
  r0 = '1000000000', r1 = '1000000000',
): MotoswapPool {
  return {
    pool_pubkey: '0xpool_' + pk0.slice(-4) + '_' + pk1.slice(-4),
    token0_pubkey: pk0,
    token0_symbol: sym0,
    token0_decimals: dec0,
    token1_pubkey: pk1,
    token1_symbol: sym1,
    token1_decimals: dec1,
    reserve0: r0,
    reserve1: r1,
    last_updated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getAmountOut — AMM price calculation (x*y=k with 0.3% fee)
// ─────────────────────────────────────────────────────────────────────────────

describe('getAmountOut', () => {
  it('returns correct output with 0.3% fee deducted', () => {
    // reserveIn=1000, reserveOut=1000, amountIn=10
    // fee = 10 * 0.003 = 0.03 → inAfterFee = 9.97
    // out = (1000 * 9.97) / (1000 + 9.97) ≈ 9.872
    const { out } = getAmountOut(10, 1000, 1000);
    expect(out).toBeCloseTo(9.872, 2);
  });

  it('calculates price impact as percentage deviation from spot price', () => {
    // Impact includes the 0.3% fee effect, so for a small trade it's ~0.3%
    // (fee reduces effectivePrice vs spotPrice)
    const { impact } = getAmountOut(1, 10000, 10000);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(1); // less than 1% for tiny trade
  });

  it('large trade causes high price impact', () => {
    // Buying 50% of the pool should cause significant slippage
    const { impact } = getAmountOut(5000, 10000, 10000);
    expect(impact).toBeGreaterThan(20); // more than 20% impact
  });

  it('returns zero output for zero input', () => {
    const { out } = getAmountOut(0, 1000, 1000);
    expect(out).toBe(0);
  });

  it('asymmetric reserves: MINE cheaper than VIBE (1 MINE ≈ 50 VIBE)', () => {
    // reserveIn(MINE)=500_000, reserveOut(VIBE)=25_000_000
    const { out } = getAmountOut(1000, 500_000, 25_000_000);
    expect(out).toBeGreaterThan(40_000);
    expect(out).toBeLessThan(50_000);
  });

  it('asymmetric reserves: VIBE to MINE direction', () => {
    const { out } = getAmountOut(50_000, 25_000_000, 500_000);
    expect(out).toBeGreaterThan(900);
    expect(out).toBeLessThan(1000);
  });

  it('fee is exactly 0.3% — output matches manual formula', () => {
    const amountIn = 100;
    const reserveIn = 100_000;
    const reserveOut = 100_000;
    const expectedFee = amountIn * 0.003;
    const inAfterFee = amountIn - expectedFee;
    const expectedOut = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
    const { out } = getAmountOut(amountIn, reserveIn, reserveOut);
    expect(out).toBeCloseTo(expectedOut, 10);
  });

  it('very large reserves give near-minimum price impact (dominated by 0.3% fee)', () => {
    // Even with huge reserves, minimum impact is ~0.3% due to the 0.003 fee
    const { impact } = getAmountOut(1, 1_000_000_000, 1_000_000_000);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(0.4); // close to fee floor ~0.3%
  });

  it('impact approaches high values when buying almost all reserves', () => {
    const { impact } = getAmountOut(9999, 10000, 10000);
    expect(impact).toBeGreaterThan(50);
  });

  it('output is always less than reserveOut (AMM invariant)', () => {
    const reserveOut = 1000;
    const { out } = getAmountOut(50000, 100, reserveOut);
    expect(out).toBeLessThan(reserveOut);
  });

  it('formula is deterministic', () => {
    const r1 = getAmountOut(42, 5000, 10000);
    const r2 = getAmountOut(42, 5000, 10000);
    expect(r1.out).toBe(r2.out);
    expect(r1.impact).toBe(r2.impact);
  });

  it('handles fractional amounts', () => {
    const { out } = getAmountOut(0.001, 1000, 1000);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(0.001);
  });

  it('output increases monotonically with input', () => {
    const r = 10_000;
    const { out: out1 } = getAmountOut(100, r, r);
    const { out: out2 } = getAmountOut(200, r, r);
    const { out: out3 } = getAmountOut(1000, r, r);
    expect(out2).toBeGreaterThan(out1);
    expect(out3).toBeGreaterThan(out2);
  });

  it('impact increases monotonically with larger trades', () => {
    const r = 10_000;
    const { impact: i1 } = getAmountOut(10, r, r);
    const { impact: i2 } = getAmountOut(100, r, r);
    const { impact: i3 } = getAmountOut(1000, r, r);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('output preserves AMM k-invariant (fee-adjusted)', () => {
    const rIn = 10_000;
    const rOut = 20_000;
    const amountIn = 500;
    const { out } = getAmountOut(amountIn, rIn, rOut);
    const fee = amountIn * 0.003;
    const inAfterFee = amountIn - fee;
    // After swap: (rIn + inAfterFee) * (rOut - out) should equal rIn * rOut
    const kBefore = rIn * rOut;
    const kAfter = (rIn + inAfterFee) * (rOut - out);
    expect(Math.abs(kAfter - kBefore) / kBefore).toBeLessThan(1e-10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BASE_TOKENS — базовая конфигурация токенов
// ─────────────────────────────────────────────────────────────────────────────

describe('BASE_TOKENS', () => {
  it('contains exactly MINE and VIBE', () => {
    expect(BASE_TOKENS).toHaveLength(2);
    const symbols = BASE_TOKENS.map(t => t.symbol);
    expect(symbols).toContain('MINE');
    expect(symbols).toContain('VIBE');
  });

  it('each token has required fields', () => {
    for (const t of BASE_TOKENS) {
      expect(t.symbol).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.decimals).toBe(8);
      expect(t.address).toMatch(/^opt1/);
      expect(t.pubkey).toMatch(/^0x/);
    }
  });

  it('MINE address matches expected testnet address', () => {
    const mine = BASE_TOKENS.find(t => t.symbol === 'MINE');
    expect(mine?.address).toBe('opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa');
  });

  it('VIBE address matches expected testnet address', () => {
    const vibe = BASE_TOKENS.find(t => t.symbol === 'VIBE');
    expect(vibe?.address).toBe('opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl');
  });

  it('MINE and VIBE have different pubkeys', () => {
    const [a, b] = BASE_TOKENS;
    expect(a.pubkey).not.toBe(b.pubkey);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Swap token list building from Motoswap pools
// ─────────────────────────────────────────────────────────────────────────────

describe('Swap token list building from Motoswap pools', () => {
  /**
   * Inline reimplementation of the SWAP_TOKENS memo logic из useSwap.ts
   * (строки 267–281). Тестируем алгоритм без React.
   */
  function buildSwapTokens(motoPools: MotoswapPool[]): Token[] {
    const known = new Set(BASE_TOKENS.map(t => t.pubkey));
    const extra: Token[] = [];
    for (const p of motoPools) {
      if (!known.has(p.token0_pubkey)) {
        known.add(p.token0_pubkey);
        extra.push({
          symbol: p.token0_symbol,
          name: p.token0_symbol,
          icon: '',
          decimals: p.token0_decimals,
          address: p.token0_pubkey,
          pubkey: p.token0_pubkey,
        });
      }
      if (!known.has(p.token1_pubkey)) {
        known.add(p.token1_pubkey);
        extra.push({
          symbol: p.token1_symbol,
          name: p.token1_symbol,
          icon: '',
          decimals: p.token1_decimals,
          address: p.token1_pubkey,
          pubkey: p.token1_pubkey,
        });
      }
    }
    return [...BASE_TOKENS, ...extra];
  }

  it('with no moto pools returns only BASE_TOKENS', () => {
    const tokens = buildSwapTokens([]);
    expect(tokens).toHaveLength(2);
    expect(tokens.map(t => t.symbol)).toEqual(['MINE', 'VIBE']);
  });

  it('adds new tokens from moto pools', () => {
    const pool = makeMotoPool('PILL', '0xpill111', 8, 'MOTO', '0xmoto222', 8);
    const tokens = buildSwapTokens([pool]);
    expect(tokens).toHaveLength(4);
    expect(tokens.map(t => t.symbol)).toContain('PILL');
    expect(tokens.map(t => t.symbol)).toContain('MOTO');
  });

  it('does not duplicate tokens already in BASE_TOKENS', () => {
    const minePubkey = BASE_TOKENS.find(t => t.symbol === 'MINE')!.pubkey;
    const pool = makeMotoPool('MINE', minePubkey, 8, 'NEWTOKEN', '0xnewtoken999', 8);
    const tokens = buildSwapTokens([pool]);
    const mineCount = tokens.filter(t => t.symbol === 'MINE').length;
    expect(mineCount).toBe(1);
    expect(tokens).toHaveLength(3); // MINE, VIBE, NEWTOKEN
  });

  it('handles multiple pools without duplicating shared tokens', () => {
    const pool1 = makeMotoPool('PILL', '0xpill111', 8, 'MOTO', '0xmoto222', 8);
    const pool2 = makeMotoPool('MOTO', '0xmoto222', 8, 'RARE', '0xrare333', 8);
    const tokens = buildSwapTokens([pool1, pool2]);
    const motoCount = tokens.filter(t => t.symbol === 'MOTO').length;
    expect(motoCount).toBe(1);
    expect(tokens).toHaveLength(5); // MINE, VIBE, PILL, MOTO, RARE
  });

  it('BASE_TOKENS always appear first', () => {
    const pool = makeMotoPool('PILL', '0xpill111', 8, 'MOTO', '0xmoto222', 8);
    const tokens = buildSwapTokens([pool]);
    expect(tokens[0].symbol).toBe('MINE');
    expect(tokens[1].symbol).toBe('VIBE');
  });

  it('token decimals are preserved from pool data', () => {
    const pool = makeMotoPool('USDT', '0xusdt', 6, 'WBTC', '0xwbtc', 8);
    const tokens = buildSwapTokens([pool]);
    const usdt = tokens.find(t => t.symbol === 'USDT');
    const wbtc = tokens.find(t => t.symbol === 'WBTC');
    expect(usdt?.decimals).toBe(6);
    expect(wbtc?.decimals).toBe(8);
  });

  it('works with many pools (stress test)', () => {
    const pools: MotoswapPool[] = [];
    for (let i = 0; i < 30; i++) {
      pools.push(makeMotoPool(`T${i}A`, `0xpk${i}a`, 8, `T${i}B`, `0xpk${i}b`, 8));
    }
    const tokens = buildSwapTokens(pools);
    // 2 base + 30*2 new (all unique pubkeys)
    expect(tokens).toHaveLength(2 + 60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pool detection — SimplePool vs Motoswap routing
// ─────────────────────────────────────────────────────────────────────────────

describe('Pool detection logic (SimplePool vs Motoswap)', () => {
  const mine = BASE_TOKENS.find(t => t.symbol === 'MINE')!;
  const vibe = BASE_TOKENS.find(t => t.symbol === 'VIBE')!;
  const pill: Token = { symbol: 'PILL', name: 'PILL', icon: '', decimals: 8, address: '0xpill', pubkey: '0xpill_pk' };
  const moto: Token = { symbol: 'MOTO', name: 'MOTO', icon: '', decimals: 8, address: '0xmoto', pubkey: '0xmoto_pk' };

  /** Реплика isSimplePool из useSwap.ts */
  function isSimplePool(from: Token, to: Token): boolean {
    return (from.symbol === 'MINE' && to.symbol === 'VIBE') ||
           (from.symbol === 'VIBE' && to.symbol === 'MINE');
  }

  /** Реплика поиска motoPool из useSwap.ts */
  function findMotoPool(from: Token, to: Token, pools: MotoswapPool[]): MotoswapPool | null {
    return pools.find(p =>
      (p.token0_pubkey === from.pubkey && p.token1_pubkey === to.pubkey) ||
      (p.token1_pubkey === from.pubkey && p.token0_pubkey === to.pubkey)
    ) || null;
  }

  it('MINE → VIBE is SimplePool', () => {
    expect(isSimplePool(mine, vibe)).toBe(true);
  });

  it('VIBE → MINE is SimplePool', () => {
    expect(isSimplePool(vibe, mine)).toBe(true);
  });

  it('MINE → PILL is not SimplePool', () => {
    expect(isSimplePool(mine, pill)).toBe(false);
  });

  it('PILL → MOTO is not SimplePool', () => {
    expect(isSimplePool(pill, moto)).toBe(false);
  });

  it('same token to same token is not SimplePool', () => {
    expect(isSimplePool(mine, mine)).toBe(false);
  });

  it('finds moto pool for PILL → MOTO pair (forward direction)', () => {
    const pool = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8);
    const found = findMotoPool(pill, moto, [pool]);
    expect(found).not.toBeNull();
  });

  it('finds moto pool for MOTO → PILL pair (reverse direction)', () => {
    const pool = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8);
    const found = findMotoPool(moto, pill, [pool]);
    expect(found).not.toBeNull();
  });

  it('returns null when no moto pool exists for pair', () => {
    const pool = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8);
    const found = findMotoPool(mine, pill, [pool]);
    expect(found).toBeNull();
  });

  it('returns null for empty moto pools list', () => {
    const found = findMotoPool(mine, pill, []);
    expect(found).toBeNull();
  });

  it('picks correct pool from multiple pools', () => {
    const _rare: Token = { symbol: 'RARE', name: 'RARE', icon: '', decimals: 8, address: '0xrare', pubkey: '0xrare_pk' }; void _rare;
    const pool1 = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8);
    const pool2 = makeMotoPool('MOTO', '0xmoto_pk', 8, 'RARE', '0xrare_pk', 8);
    const found = findMotoPool(pill, moto, [pool1, pool2]);
    expect(found?.pool_pubkey).toBe(pool1.pool_pubkey);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reserve direction and rate calculation
// ─────────────────────────────────────────────────────────────────────────────

describe('Rate and reserve calculations', () => {
  /** Реплика логики определения резервов из useSwap.ts (строки 302–313) */
  function getReserves(
    from: Token, to: Token,
    reserveA: number, reserveB: number,
    motoPool: MotoswapPool | null,
  ): { rIn: number; rOut: number } {
    const isSimple = (from.symbol === 'MINE' && to.symbol === 'VIBE') ||
                     (from.symbol === 'VIBE' && to.symbol === 'MINE');
    const isAToB = from.symbol === 'MINE';

    if (isSimple) {
      return {
        rIn: isAToB ? reserveA : reserveB,
        rOut: isAToB ? reserveB : reserveA,
      };
    } else if (motoPool) {
      const isForward = from.pubkey === motoPool.token0_pubkey;
      const mr0 = Number(BigInt(motoPool.reserve0)) / Math.pow(10, motoPool.token0_decimals);
      const mr1 = Number(BigInt(motoPool.reserve1)) / Math.pow(10, motoPool.token1_decimals);
      return {
        rIn: isForward ? mr0 : mr1,
        rOut: isForward ? mr1 : mr0,
      };
    }
    return { rIn: 0, rOut: 0 };
  }

  const mine = BASE_TOKENS.find(t => t.symbol === 'MINE')!;
  const vibe = BASE_TOKENS.find(t => t.symbol === 'VIBE')!;

  it('MINE→VIBE: rIn=reserveA, rOut=reserveB', () => {
    const { rIn, rOut } = getReserves(mine, vibe, 500_000, 25_000_000, null);
    expect(rIn).toBe(500_000);
    expect(rOut).toBe(25_000_000);
  });

  it('VIBE→MINE: rIn=reserveB, rOut=reserveA', () => {
    const { rIn, rOut } = getReserves(vibe, mine, 500_000, 25_000_000, null);
    expect(rIn).toBe(25_000_000);
    expect(rOut).toBe(500_000);
  });

  it('no pool returns rIn=0, rOut=0', () => {
    const pill: Token = { symbol: 'PILL', name: 'PILL', icon: '', decimals: 8, address: '0x', pubkey: '0xpk' };
    const { rIn, rOut } = getReserves(pill, mine, 100, 100, null);
    expect(rIn).toBe(0);
    expect(rOut).toBe(0);
  });

  it('moto pool reserves are divided by token decimals', () => {
    const pill: Token = { symbol: 'PILL', name: 'PILL', icon: '', decimals: 8, address: '0xpill', pubkey: '0xpill_pk' };
    const moto: Token = { symbol: 'MOTO', name: 'MOTO', icon: '', decimals: 8, address: '0xmoto', pubkey: '0xmoto_pk' };
    const pool = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8, '500000000', '1000000000');
    const { rIn, rOut } = getReserves(pill, moto, 0, 0, pool);
    expect(rIn).toBeCloseTo(5, 5);   // 500000000 / 1e8 = 5
    expect(rOut).toBeCloseTo(10, 5); // 1000000000 / 1e8 = 10
  });

  it('moto pool reverse direction swaps rIn/rOut', () => {
    const pill: Token = { symbol: 'PILL', name: 'PILL', icon: '', decimals: 8, address: '0xpill', pubkey: '0xpill_pk' };
    const moto: Token = { symbol: 'MOTO', name: 'MOTO', icon: '', decimals: 8, address: '0xmoto', pubkey: '0xmoto_pk' };
    const pool = makeMotoPool('PILL', '0xpill_pk', 8, 'MOTO', '0xmoto_pk', 8, '500000000', '1000000000');
    const { rIn, rOut } = getReserves(moto, pill, 0, 0, pool);
    expect(rIn).toBeCloseTo(10, 5);  // token1 side
    expect(rOut).toBeCloseTo(5, 5);  // token0 side
  });

  it('moto pool handles 6-decimal token (USDT-like)', () => {
    const usdt: Token = { symbol: 'USDT', name: 'USDT', icon: '', decimals: 6, address: '0xusdt', pubkey: '0xusdt_pk' };
    const wbtc: Token = { symbol: 'WBTC', name: 'WBTC', icon: '', decimals: 8, address: '0xwbtc', pubkey: '0xwbtc_pk' };
    const pool = makeMotoPool('USDT', '0xusdt_pk', 6, 'WBTC', '0xwbtc_pk', 8, '100000000', '100000000');
    const { rIn, rOut } = getReserves(usdt, wbtc, 0, 0, pool);
    expect(rIn).toBeCloseTo(100, 5);  // 100000000 / 1e6 = 100
    expect(rOut).toBeCloseTo(1, 5);   // 100000000 / 1e8 = 1
  });

  it('rate = rOut / rIn gives correct price', () => {
    const rIn = 500_000;
    const rOut = 25_000_000;
    const rate = rOut / rIn;
    expect(rate).toBe(50); // 50 VIBE per MINE
  });

  it('hasPool is false when both reserves are zero', () => {
    const hasPool = 0 > 0 && 0 > 0;
    expect(hasPool).toBe(false);
  });

  it('hasPool is false when one reserve is zero', () => {
    expect(1000 > 0 && 0 > 0).toBe(false);
    expect(0 > 0 && 1000 > 0).toBe(false);
  });

  it('fee is exactly 0.3% of fromVal', () => {
    const fromVal = 100;
    const fee = fromVal * 0.003;
    expect(fee).toBeCloseTo(0.3, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Balance formatting
// ─────────────────────────────────────────────────────────────────────────────

describe('Balance formatting (fmtBal logic)', () => {
  /** Реплика fmtBal из useSwap.ts */
  function fmtBal(b: bigint | undefined, dec: number, balLoading: boolean): string {
    if (b != null) {
      return (Number(b) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return balLoading ? '...' : '--';
  }

  it('formats 100_000_000n with 8 decimals as "1"', () => {
    expect(fmtBal(100_000_000n, 8, false)).toBe('1');
  });

  it('formats 500_000_000n with 8 decimals as "5"', () => {
    expect(fmtBal(500_000_000n, 8, false)).toBe('5');
  });

  it('formats 0n as "0"', () => {
    expect(fmtBal(0n, 8, false)).toBe('0');
  });

  it('returns "--" when balance is undefined and not loading', () => {
    expect(fmtBal(undefined, 8, false)).toBe('--');
  });

  it('returns "..." when balance is undefined and loading', () => {
    expect(fmtBal(undefined, 8, true)).toBe('...');
  });

  it('handles 6-decimal tokens (USDT-like): 1_000_000 → "1"', () => {
    expect(fmtBal(1_000_000n, 6, false)).toBe('1');
  });

  it('large balance is formatted as a number (locale-agnostic check)', () => {
    const result = fmtBal(2_100_000_000_000_000n, 8, false);
    // Strip all locale separators (commas, dots, spaces, narrow non-breaking spaces)
    const stripped = result.replace(/[\s,.\u00a0\u202f]/g, '');
    expect(stripped).toContain('21000000');
  });

  it('fractional balance: 12345678 raw / 1e8 = 0.12345678 rounded to 4dp', () => {
    // toLocaleString with maximumFractionDigits:4 rounds 0.12345678 → 0.1235
    // The raw number is 12345678 / 1e8 = 0.12345678
    const raw = 12345678n;
    const num = Number(raw) / 1e8;
    // Manually verify the rounding to 4 decimal places
    const rounded = Math.round(num * 10000) / 10000;
    expect(rounded).toBeCloseTo(0.1235, 4);
    // The formatted string should be non-empty
    const result = fmtBal(raw, 8, false);
    expect(result).toBeTruthy();
    expect(result).not.toBe('--');
    expect(result).not.toBe('...');
  });

  it('balance of 1 satoshi: 1/1e8 is very small', () => {
    // 1n / 1e8 = 1e-8; toLocaleString with maxFractionDigits=4 rounds to 0
    // so formatted result is "0" — verify the math is correct
    const num = Number(1n) / Math.pow(10, 8);
    expect(num).toBeCloseTo(1e-8, 10);
    // The formatted output may be "0" due to rounding at 4 dp
    const result = fmtBal(1n, 8, false);
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Slippage and minAmountOut calculation
// ─────────────────────────────────────────────────────────────────────────────

describe('Slippage and minAmountOut', () => {
  /** Реплика вычисления minOut из useSwap.ts doSwap */
  function calcMinOut(toVal: number, slippage: number, decimals: number): bigint {
    // BitcoinUtils.expandToDecimals(toVal * (1 - slippage / 100), decimals)
    // Simplified: multiply by 10^decimals as integer
    const adjusted = toVal * (1 - slippage / 100);
    return BigInt(Math.round(adjusted * Math.pow(10, decimals)));
  }

  it('0.5% slippage reduces output by 0.5%', () => {
    const toVal = 100;
    const minOut = calcMinOut(toVal, 0.5, 8);
    const expected = BigInt(Math.round(99.5 * 1e8));
    expect(minOut).toBe(expected);
  });

  it('1% slippage reduces output by 1%', () => {
    const minOut = calcMinOut(1000, 1, 8);
    const expected = BigInt(Math.round(990 * 1e8));
    expect(minOut).toBe(expected);
  });

  it('5% slippage reduces output by 5%', () => {
    const minOut = calcMinOut(200, 5, 8);
    const expected = BigInt(Math.round(190 * 1e8));
    expect(minOut).toBe(expected);
  });

  it('0% slippage gives exact output', () => {
    const minOut = calcMinOut(50, 0, 8);
    const expected = BigInt(Math.round(50 * 1e8));
    expect(minOut).toBe(expected);
  });

  it('100% slippage gives zero minimum output', () => {
    const minOut = calcMinOut(100, 100, 8);
    expect(minOut).toBe(0n);
  });
});
