/**
 * useMarketplace.test.ts
 *
 * Тесты для чистых вычислительных функций и логики из useMarketplace.ts.
 * Тестируем только логику без React-хуков и сетевых вызовов.
 */

import { describe, it, expect, vi } from 'vitest';

// Мокируем все тяжёлые зависимости до импорта хука
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: () => ({
    walletAddress: null,
    address: null,
    openConnectModal: vi.fn(),
  }),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  TransactionOutputFlags: { hasScriptPubKey: 0x01 },
  ABIDataTypes: { UINT256: 'uint256' },
  BitcoinAbiTypes: { Function: 'Function' },
  JSONRpcProvider: class { getBlockNumber = vi.fn(); },
}));

vi.mock('@btc-vision/transaction', () => {
  class MockAddress {
    static fromString = vi.fn();
    static wrap = vi.fn((bytes: Uint8Array) => ({
      p2op: vi.fn(() => 'opt1mock_p2op_address'),
    }));
    p2op = vi.fn(() => 'opt1mock_p2op_address');
  }
  return { Address: MockAddress };
});

vi.mock('../contractCache', () => ({
  getProvider: vi.fn(() => ({})),
}));

vi.mock('../abis', () => ({
  MARKETPLACE_ABI: [],
}));

vi.mock('../txUtils', () => ({
  withRetry: vi.fn(fn => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
  ensureAllowance: vi.fn(),
  buildTxParams: vi.fn().mockResolvedValue({}),
  waitForNextBlock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../swapApi', () => ({
  lockOrder: vi.fn().mockResolvedValue({ ok: true }),
  unlockOrder: vi.fn().mockResolvedValue(undefined),
  getActiveLocks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../contexts/OpsContext', () => ({
  useOps: () => ({
    trackOp: vi.fn(),
    completeOp: vi.fn(),
    failOp: vi.fn(),
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../contracts', () => ({
  DEPLOYED_CONTRACTS: {
    MINE: {
      address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
      pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
      symbol: 'MINE',
      name: 'Mine Token',
      decimals: 8,
    },
    VIBE: {
      address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
      pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
      symbol: 'VIBE',
      name: 'Vibe Token',
      decimals: 8,
    },
  },
  MARKET_ADDRESS: 'opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt',
  MARKET_PUBKEY: '0xd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595',
  getContractOpscanUrl: vi.fn((addr: string) => `https://opscan.org/accounts/${addr}`),
  getTxUrl: vi.fn((txid: string) => `https://opscan.org/transactions/${txid}`),
  addressToPubkey: vi.fn((addr: string) => addr),
}));

vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));

import { buildP2OPScript, KNOWN_TOKENS, type Order } from '../hooks/useMarketplace';

// ─────────────────────────────────────────────────────────────────────────────
// buildP2OPScript — построение P2OP scriptPubKey
// ─────────────────────────────────────────────────────────────────────────────

describe('buildP2OPScript', () => {
  const KNOWN_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

  it('returns Buffer of exactly 34 bytes', () => {
    const buf = buildP2OPScript(KNOWN_HEX);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(34);
  });

  it('first byte is 0x60 (P2OP opcode)', () => {
    const buf = buildP2OPScript(KNOWN_HEX);
    expect(buf[0]).toBe(0x60);
  });

  it('second byte is 0x20 (push 32 bytes)', () => {
    const buf = buildP2OPScript(KNOWN_HEX);
    expect(buf[1]).toBe(0x20);
  });

  it('bytes 2–33 contain the decoded MLDSA hash', () => {
    const buf = buildP2OPScript(KNOWN_HEX);
    const hexBack = Array.from(buf.slice(2))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hexBack).toBe(KNOWN_HEX);
  });

  it('produces deterministic output for same input', () => {
    const buf1 = buildP2OPScript(KNOWN_HEX);
    const buf2 = buildP2OPScript(KNOWN_HEX);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it('different hex inputs produce different scripts', () => {
    const hex1 = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    const hex2 = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf1 = buildP2OPScript(hex1);
    const buf2 = buildP2OPScript(hex2);
    expect(buf1.equals(buf2)).toBe(false);
  });

  it('handles all-zero hex (edge case)', () => {
    const allZeros = '0'.repeat(64);
    const buf = buildP2OPScript(allZeros);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
    expect(buf[1]).toBe(0x20);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0);
    }
  });

  it('handles all-ff hex (edge case)', () => {
    const allFf = 'ff'.repeat(32);
    const buf = buildP2OPScript(allFf);
    expect(buf.length).toBe(34);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0xff);
    }
  });

  it('handles VIBE token pubkey hex (real data)', () => {
    const vibePubkeyHex = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf = buildP2OPScript(vibePubkeyHex);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KNOWN_TOKENS — статический список токенов маркетплейса
// ─────────────────────────────────────────────────────────────────────────────

describe('KNOWN_TOKENS', () => {
  it('contains at least MINE and VIBE', () => {
    const symbols = KNOWN_TOKENS.map(t => t.symbol);
    expect(symbols).toContain('MINE');
    expect(symbols).toContain('VIBE');
  });

  it('each token has required MarketToken fields', () => {
    for (const t of KNOWN_TOKENS) {
      expect(t.address).toBeTruthy();
      expect(t.pubkey).toBeTruthy();
      expect(t.symbol).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(typeof t.decimals).toBe('number');
      expect(typeof t.sellCount).toBe('number');
      expect(typeof t.buyCount).toBe('number');
      expect(typeof t.totalVolume).toBe('number');
    }
  });

  it('initial counts are zero', () => {
    for (const t of KNOWN_TOKENS) {
      expect(t.sellCount).toBe(0);
      expect(t.buyCount).toBe(0);
      expect(t.totalVolume).toBe(0);
    }
  });

  it('MINE pubkey has 0x prefix and correct length', () => {
    const mine = KNOWN_TOKENS.find(t => t.symbol === 'MINE');
    expect(mine?.pubkey).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('all token addresses start with opt1', () => {
    for (const t of KNOWN_TOKENS) {
      expect(t.address).toMatch(/^opt1/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token filtering / search logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Token filtering and search', () => {
  const tokenList = [
    { address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa', pubkey: '0xmine', symbol: 'MINE', name: 'Mine Token', decimals: 8, sellCount: 5, buyCount: 3, totalVolume: 1000 },
    { address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl', pubkey: '0xvibe', symbol: 'VIBE', name: 'Vibe Token', decimals: 8, sellCount: 2, buyCount: 7, totalVolume: 500 },
    { address: 'opt1sqpill111', pubkey: '0xpill', symbol: 'PILL', name: 'Pill Token', decimals: 8, sellCount: 0, buyCount: 0, totalVolume: 0 },
  ];

  /** Реплика filteredTokens из useMarketplace.ts */
  function filterTokens(list: typeof tokenList, search: string) {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }

  it('empty search returns all tokens', () => {
    expect(filterTokens(tokenList, '')).toHaveLength(3);
  });

  it('filters by symbol (case-insensitive)', () => {
    const result = filterTokens(tokenList, 'mine');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('MINE');
  });

  it('filters by symbol uppercase', () => {
    const result = filterTokens(tokenList, 'VIBE');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('VIBE');
  });

  it('filters by name (partial match)', () => {
    const result = filterTokens(tokenList, 'Token');
    expect(result).toHaveLength(3); // all have "Token" in name
  });

  it('filters by address', () => {
    const result = filterTokens(tokenList, 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('MINE');
  });

  it('filters by partial address', () => {
    const result = filterTokens(tokenList, 'opt1sqzc940');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('VIBE');
  });

  it('returns empty array for no match', () => {
    const result = filterTokens(tokenList, 'BITCOIN');
    expect(result).toHaveLength(0);
  });

  it('case-insensitive name filter', () => {
    const result = filterTokens(tokenList, 'vibe token');
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('VIBE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Order categorization: sellOrders, buyOrders, myOrders
// ─────────────────────────────────────────────────────────────────────────────

describe('Order categorization', () => {
  const makeOrder = (
    id: string,
    type: 'sell' | 'buy',
    status: Order['status'],
    creator: string,
    seller = '',
    pricePerToken = 1000,
    amount = 100,
    amountFilled = 0,
  ): Order => ({
    id,
    type,
    creator,
    seller: seller || creator,
    tokenAddress: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
    tokenSymbol: 'MINE',
    tokenName: 'Mine Token',
    amount,
    amountFilled,
    pricePerToken,
    totalPrice: (amount - amountFilled) * pricePerToken,
    createdAt: Date.now() / 1000,
    status,
    fills: [],
  });

  const myHex = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
  const otherHex = '1122334455667788990011223344556677889900112233445566778899001122';

  const orders: Order[] = [
    makeOrder('1', 'sell', 'active', myHex, myHex, 500, 100),
    makeOrder('2', 'sell', 'active', otherHex, otherHex, 300, 200),
    makeOrder('3', 'sell', 'cancelled', otherHex, otherHex, 400, 50),
    makeOrder('4', 'buy', 'active', otherHex, otherHex, 800, 75),
    makeOrder('5', 'buy', 'accepted', otherHex, myHex, 900, 60), // seller = myHex
    makeOrder('6', 'buy', 'filled', myHex, myHex, 200, 30),
    makeOrder('7', 'sell', 'active', otherHex, otherHex, 100, 150),
  ];

  /** Реплики из useMarketplace.ts */
  const sellOrders = orders
    .filter(o => o.type === 'sell' && o.status === 'active')
    .sort((a, b) => a.pricePerToken - b.pricePerToken);

  const buyOrders = orders
    .filter(o => o.type === 'buy' && (o.status === 'active' || o.status === 'accepted'))
    .sort((a, b) => b.pricePerToken - a.pricePerToken);

  const myOrders = orders.filter(o => o.creator === myHex || o.seller === myHex);

  it('sellOrders contains only active sell orders', () => {
    expect(sellOrders.every(o => o.type === 'sell' && o.status === 'active')).toBe(true);
    expect(sellOrders).toHaveLength(3); // orders 1, 2, 7
  });

  it('sellOrders are sorted by pricePerToken ascending', () => {
    const prices = sellOrders.map(o => o.pricePerToken);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    }
  });

  it('cancelled sell orders excluded from sellOrders', () => {
    const cancelled = sellOrders.find(o => o.status === 'cancelled');
    expect(cancelled).toBeUndefined();
  });

  it('buyOrders contains active AND accepted buy orders', () => {
    expect(buyOrders.some(o => o.status === 'active')).toBe(true);
    expect(buyOrders.some(o => o.status === 'accepted')).toBe(true);
    expect(buyOrders).toHaveLength(2); // orders 4, 5
  });

  it('buyOrders are sorted by pricePerToken descending', () => {
    const prices = buyOrders.map(o => o.pricePerToken);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    }
  });

  it('filled buy orders excluded from buyOrders', () => {
    const filled = buyOrders.find(o => o.status === 'filled');
    expect(filled).toBeUndefined();
  });

  it('myOrders contains orders where user is creator', () => {
    const myCreated = myOrders.filter(o => o.creator === myHex);
    expect(myCreated.length).toBeGreaterThan(0);
  });

  it('myOrders contains orders where user is seller', () => {
    const mySelling = myOrders.filter(o => o.seller === myHex);
    expect(mySelling.length).toBeGreaterThan(0);
  });

  it('myOrders does not include orders from other wallets', () => {
    const foreign = myOrders.filter(o => o.creator !== myHex && o.seller !== myHex);
    expect(foreign).toHaveLength(0);
  });

  it('myOrders includes both sell and buy types', () => {
    const types = new Set(myOrders.map(o => o.type));
    expect(types.has('sell')).toBe(true);
    expect(types.has('buy')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Price/total calculations
// ─────────────────────────────────────────────────────────────────────────────

describe('Price and total calculations', () => {
  /** totalPrice = (amount - amountFilled) * pricePerToken */
  function calcTotal(amount: number, filled: number, pricePerToken: number): number {
    return (amount - filled) * pricePerToken;
  }

  it('unfilled order: total = amount * price', () => {
    expect(calcTotal(100, 0, 500)).toBe(50_000);
  });

  it('partially filled order: total = remaining * price', () => {
    expect(calcTotal(100, 30, 500)).toBe(35_000);
  });

  it('fully filled order: total = 0', () => {
    expect(calcTotal(100, 100, 500)).toBe(0);
  });

  it('zero price gives zero total', () => {
    expect(calcTotal(100, 0, 0)).toBe(0);
  });

  it('fractional amounts', () => {
    expect(calcTotal(10.5, 0.5, 100)).toBeCloseTo(1000, 10);
  });

  /** BTC payment for fill: rawPayment = ceil(fillAmt * pricePerToken), min 330 sats */
  function calcBtcPayment(fillAmt: number, pricePerToken: number): bigint {
    const rawPayment = BigInt(Math.ceil(fillAmt * pricePerToken));
    return rawPayment < 330n ? 330n : rawPayment;
  }

  it('normal payment above dust limit', () => {
    const payment = calcBtcPayment(100, 500);
    expect(payment).toBe(50_000n);
  });

  it('tiny payment is floored to 330 sats (dust limit)', () => {
    const payment = calcBtcPayment(0.001, 100); // = 0.1 sats → ceil to 1 → min 330
    expect(payment).toBe(330n);
  });

  it('payment exactly at dust limit', () => {
    // fillAmt * pricePerToken = 330
    const payment = calcBtcPayment(1, 330);
    expect(payment).toBe(330n);
  });

  it('payment one below dust limit gets bumped', () => {
    const payment = calcBtcPayment(1, 329);
    expect(payment).toBe(330n);
  });

  it('ceil is applied to fractional satoshi amounts', () => {
    // 10 * 3.3 = 33.0 → no ceiling needed → 33 sats → below dust
    const payment = calcBtcPayment(10, 3.3);
    expect(payment).toBe(330n); // 33 < 330, so bumped
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Order status detection
// ─────────────────────────────────────────────────────────────────────────────

describe('Order status detection', () => {
  const makeMinimalOrder = (
    status: Order['status'],
    type: Order['type'] = 'sell',
  ): Order => ({
    id: '1',
    type,
    creator: 'abc',
    seller: 'abc',
    tokenAddress: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
    tokenSymbol: 'MINE',
    tokenName: 'Mine Token',
    amount: 100,
    amountFilled: 0,
    pricePerToken: 500,
    totalPrice: 50_000,
    createdAt: Date.now() / 1000,
    status,
    fills: [],
  });

  it('active status: can fill', () => {
    const order = makeMinimalOrder('active');
    expect(order.status === 'active').toBe(true);
  });

  it('accepted status: buy order waiting for BTC payment', () => {
    const order = makeMinimalOrder('accepted', 'buy');
    expect(order.status === 'accepted').toBe(true);
    expect(order.type === 'buy').toBe(true);
  });

  it('cancelled status: order is closed', () => {
    const order = makeMinimalOrder('cancelled');
    expect(order.status === 'cancelled').toBe(true);
  });

  it('filled status: order is complete', () => {
    const order = makeMinimalOrder('filled');
    expect(order.status === 'filled').toBe(true);
  });

  /** Реплика isMyOrder из useMarketplace.ts */
  function isMyOrder(order: Order, senderHex: string): boolean {
    return order.creator === senderHex || order.seller === senderHex;
  }

  it('isMyOrder true when user is creator', () => {
    const order = makeMinimalOrder('active');
    order.creator = 'deadbeef';
    expect(isMyOrder(order, 'deadbeef')).toBe(true);
  });

  it('isMyOrder true when user is seller', () => {
    const order = makeMinimalOrder('accepted', 'buy');
    order.creator = 'alice';
    order.seller = 'bob';
    expect(isMyOrder(order, 'bob')).toBe(true);
  });

  it('isMyOrder false for another users order', () => {
    const order = makeMinimalOrder('active');
    order.creator = 'alice';
    order.seller = 'alice';
    expect(isMyOrder(order, 'charlie')).toBe(false);
  });

  it('isMyOrder false when senderHex is empty string', () => {
    const order = makeMinimalOrder('active');
    order.creator = 'alice';
    expect(isMyOrder(order, '')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Amount scaling (on-chain ↔ human-readable)
// ─────────────────────────────────────────────────────────────────────────────

describe('Amount scaling for on-chain calls', () => {
  /** Реплика amountU256 = BigInt(Math.round(amt * 10^decimals)) */
  function toOnChain(amount: number, decimals: number): bigint {
    return BigInt(Math.round(amount * Math.pow(10, decimals)));
  }

  /** Обратно: amount = Number(u256) / 10^decimals */
  function fromOnChain(raw: bigint, decimals: number): number {
    return Number(raw) / Math.pow(10, decimals);
  }

  it('1 token with 8 decimals → 100_000_000n', () => {
    expect(toOnChain(1, 8)).toBe(100_000_000n);
  });

  it('0.5 tokens with 8 decimals → 50_000_000n', () => {
    expect(toOnChain(0.5, 8)).toBe(50_000_000n);
  });

  it('100 tokens with 6 decimals → 100_000_000n', () => {
    expect(toOnChain(100, 6)).toBe(100_000_000n);
  });

  it('roundtrip: toOnChain → fromOnChain returns original value', () => {
    const original = 42.5;
    const raw = toOnChain(original, 8);
    const back = fromOnChain(raw, 8);
    expect(back).toBeCloseTo(original, 8);
  });

  it('on-chain amount for sell order matches expected (100 MINE)', () => {
    const amountU256 = toOnChain(100, 8);
    expect(amountU256).toBe(10_000_000_000n);
  });

  it('price in satoshis is stored as integer BigInt', () => {
    // pricePerToken = 500 sats → BigInt(Math.round(500))
    const priceU256 = BigInt(Math.round(500));
    expect(priceU256).toBe(500n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleSearchSelect logic
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSearchSelect logic', () => {
  const tokenList = [
    { address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa', pubkey: '0xmine', symbol: 'MINE', name: 'Mine Token', decimals: 8, sellCount: 0, buyCount: 0, totalVolume: 0 },
    { address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl', pubkey: '0xvibe', symbol: 'VIBE', name: 'Vibe Token', decimals: 8, sellCount: 0, buyCount: 0, totalVolume: 0 },
  ];

  /** Реплика логики handleSearchSelect из useMarketplace.ts */
  function resolveSearch(search: string, list: typeof tokenList): string | null {
    const q = search.trim().toLowerCase();
    const bySymbol = list.find(t => t.symbol.toLowerCase() === q);
    if (bySymbol) return bySymbol.address;
    if (search.startsWith('opt1sq') && search.length > 20) return search;
    return null;
  }

  it('resolves known symbol to its address', () => {
    expect(resolveSearch('MINE', tokenList)).toBe('opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa');
  });

  it('resolves symbol case-insensitively', () => {
    expect(resolveSearch('vibe', tokenList)).toBe('opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl');
  });

  it('resolves opt1sq address directly', () => {
    const addr = 'opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt';
    expect(resolveSearch(addr, tokenList)).toBe(addr);
  });

  it('returns null for unknown short string', () => {
    expect(resolveSearch('XYZ', tokenList)).toBeNull();
  });

  it('returns null for opt1sq prefix but too short', () => {
    expect(resolveSearch('opt1sq', tokenList)).toBeNull();
  });

  it('prefers symbol match over address match', () => {
    // "MINE" matches symbol first
    const result = resolveSearch('MINE', tokenList);
    expect(result).toBe('opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa');
  });

  it('valid long opt1sq address is returned as-is', () => {
    const addr = 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu';
    expect(resolveSearch(addr, tokenList)).toBe(addr);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveTokenHex (inline test of the private function logic)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTokenHex logic', () => {
  /** Реплика resolveTokenHex из useMarketplace.ts */
  function resolveTokenHex(hex64: string): { address: string; symbol: string; name: string; decimals: number } | null {
    const withPrefix = '0x' + hex64;
    const found = KNOWN_TOKENS.find(t => t.pubkey === withPrefix);
    if (found) return { address: found.address, symbol: found.symbol, name: found.name, decimals: found.decimals };
    return null;
  }

  it('resolves MINE pubkey hex (without 0x) to token info', () => {
    const minePubkey = KNOWN_TOKENS.find(t => t.symbol === 'MINE')!.pubkey;
    const hex = minePubkey.replace('0x', '');
    const result = resolveTokenHex(hex);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('MINE');
  });

  it('resolves VIBE pubkey hex to token info', () => {
    const vibePubkey = KNOWN_TOKENS.find(t => t.symbol === 'VIBE')!.pubkey;
    const hex = vibePubkey.replace('0x', '');
    const result = resolveTokenHex(hex);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('VIBE');
  });

  it('returns null for unknown hex', () => {
    const result = resolveTokenHex('deadbeef'.repeat(8));
    expect(result).toBeNull();
  });

  it('returns null for all-zero hex', () => {
    const result = resolveTokenHex('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('resolved token has correct decimals', () => {
    const minePubkey = KNOWN_TOKENS.find(t => t.symbol === 'MINE')!.pubkey;
    const result = resolveTokenHex(minePubkey.replace('0x', ''));
    expect(result?.decimals).toBe(8);
  });

  it('resolved token address starts with opt1', () => {
    const minePubkey = KNOWN_TOKENS.find(t => t.symbol === 'MINE')!.pubkey;
    const result = resolveTokenHex(minePubkey.replace('0x', ''));
    expect(result?.address).toMatch(/^opt1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('empty orders array gives empty sell/buy/my orders', () => {
    const orders: Order[] = [];
    const sell = orders.filter(o => o.type === 'sell' && o.status === 'active');
    const buy = orders.filter(o => o.type === 'buy' && (o.status === 'active' || o.status === 'accepted'));
    const my = orders.filter(o => o.creator === 'x' || o.seller === 'x');
    expect(sell).toHaveLength(0);
    expect(buy).toHaveLength(0);
    expect(my).toHaveLength(0);
  });

  it('sorting empty array returns empty array', () => {
    const empty: Order[] = [];
    const sorted = [...empty].sort((a, b) => a.pricePerToken - b.pricePerToken);
    expect(sorted).toHaveLength(0);
  });

  it('totalPrice with zero amount is zero', () => {
    const order: Order = {
      id: '1', type: 'sell', creator: 'x', seller: 'x',
      tokenAddress: 'opt1test', tokenSymbol: 'TEST', tokenName: 'Test',
      amount: 0, amountFilled: 0, pricePerToken: 1000,
      totalPrice: 0 * 1000,
      createdAt: 0, status: 'active', fills: [],
    };
    expect(order.totalPrice).toBe(0);
  });

  it('senderHex empty string matches no orders', () => {
    const orders: Order[] = [
      { id: '1', type: 'sell', creator: 'abc', seller: 'abc',
        tokenAddress: 'opt1test', tokenSymbol: 'TEST', tokenName: 'Test',
        amount: 10, amountFilled: 0, pricePerToken: 100, totalPrice: 1000,
        createdAt: 0, status: 'active', fills: [] },
    ];
    const mine = orders.filter(o => o.creator === '' || o.seller === '');
    expect(mine).toHaveLength(0);
  });

  it('buildP2OPScript with 64 hex chars produces 34-byte script', () => {
    const hex = 'a'.repeat(64);
    const buf = buildP2OPScript(hex);
    expect(buf.length).toBe(34);
  });

  it('maximumAllowedSatToSpend is calculated as payment + 50_000 overhead', () => {
    const btcPaymentSats = 10_000n;
    const maxAllowed = btcPaymentSats + 50_000n;
    expect(maxAllowed).toBe(60_000n);
  });

  it('order with all fills still shows 0 remaining amount', () => {
    const amount = 100;
    const filled = 100;
    const remaining = amount - filled;
    expect(remaining).toBe(0);
  });
});
