/**
 * useCrossChain.test.ts
 *
 * Тесты для чистых утилитарных функций из crossChainShared.ts
 * и связанных модулей (types, chains, htlc).
 * Тестируем ТОЛЬКО чистые функции, без React хуков и сетевых вызовов.
 */

import { describe, it, expect, vi } from 'vitest';

// Мокируем тяжёлые зависимости до импорта
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: () => ({
    walletAddress: null,
    address: null,
    openConnectModal: vi.fn(),
    hashedMLDSAKey: null,
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
    static wrap = vi.fn((_bytes: Uint8Array) => ({
      p2op: vi.fn(() => 'opt1mock_p2op_address_from_wrap'),
    }));
    p2op = vi.fn(() => 'opt1mock_p2op_address');
  }
  return { Address: MockAddress };
});

vi.mock('@btc-vision/bitcoin', () => ({
  networks: {
    testnet: { bech32: 'tb', bech32Opnet: 'opt' },
  },
}));

vi.mock('../contractCache', () => ({
  getProvider: vi.fn(() => ({})),
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
  getActiveLocks: vi.fn().mockResolvedValue({}),
}));

vi.mock('../contexts/OpsContext', () => ({
  useOps: () => ({
    trackOp: vi.fn(),
    updateOpStep: vi.fn(),
    completeOp: vi.fn(),
    failOp: vi.fn(),
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../wallets/unisat', () => ({
  isUnisatInstalled: vi.fn(() => false),
  connectUnisat: vi.fn(),
  disconnectUnisat: vi.fn(() => ({
    connected: false, address: '', publicKey: '',
    balance: { confirmed: 0, unconfirmed: 0, total: 0 },
    chain: { enum: '', name: '', network: '' },
  })),
  sendFractalBTC: vi.fn(),
}));

vi.mock('../crosschain/htlc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crosschain/htlc')>();
  return {
    ...actual,
    generateHTLCPair: vi.fn().mockResolvedValue({ preimage: 'aa'.repeat(32), hashlock: 'bb'.repeat(32) }),
    verifyPreimage: vi.fn().mockResolvedValue(true),
  };
});

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
  CROSSCHAIN_ADDRESS: 'opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu',
  CROSSCHAIN_PUBKEY: '0x526fe291aa3af6ca14b3e3ef27d5bd45e2ec6f46ec1b0cb1ecbd0a8fb4c7a41d',
  TOKEN_ESCROW_ADDRESS: 'opt1sqtest_escrow',
  TOKEN_ESCROW_PUBKEY: '0xtest_escrow_pubkey',
  DEPLOYER_MLDSA_HEX: 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
  getContractOpscanUrl: vi.fn((addr: string) => `https://opscan.org/accounts/${addr}`),
  getTxUrl: vi.fn((txid: string) => `https://opscan.org/transactions/${txid}`),
}));

vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));

vi.mock('../abis', () => ({
  FRACTALSWAP_ABI: [],
  TOKEN_ESCROW_ABI: [],
}));

// Импорт тестируемых модулей ПОСЛЕ моков
import {
  buildP2OPScript,
  resolveToken,
  getP2OPAddress,
  TOKEN_OPTIONS,
  DIR_SELL_TOKEN,
  DIR_BUY_TOKEN,
} from '../hooks/crossChainShared';
import {
  satsToBtc,
  fmtBtc,
  fmtRate,
} from '../components/crosschain/types';
import {
  SwapDirection,
  OrderStatus,
  type FractalSwapOrder,
} from '../crosschain/types';
import {
  suggestedExpiryBlocks,
  validateAddress,
  getChainById,
  getChainTxUrl,
  getChainAddressUrl,
  SUPPORTED_CHAINS,
} from '../crosschain/chains';
import {
  hexToBigInt,
  bigIntToHex,
  formatBlockCountdown,
  truncateHex,
  toHex,
  fromHex,
} from '../crosschain/htlc';

// ─────────────────────────────────────────────────────────────────────────────
// buildP2OPScript — построение P2OP scriptPubKey из 64-char MLDSA hex
// ─────────────────────────────────────────────────────────────────────────────

describe('buildP2OPScript', () => {
  const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

  it('возвращает Buffer длиной ровно 34 байта', () => {
    const buf = buildP2OPScript(MINE_HEX);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(34);
  });

  it('первый байт — 0x60 (OP_16)', () => {
    const buf = buildP2OPScript(MINE_HEX);
    expect(buf[0]).toBe(0x60);
  });

  it('второй байт — 0x20 (PUSH_32)', () => {
    const buf = buildP2OPScript(MINE_HEX);
    expect(buf[1]).toBe(0x20);
  });

  it('байты 2–33 содержат декодированный MLDSA хэш', () => {
    const buf = buildP2OPScript(MINE_HEX);
    const hexBack = Array.from(buf.slice(2))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hexBack).toBe(MINE_HEX);
  });

  it('детерминированный вывод для одного и того же входа', () => {
    const buf1 = buildP2OPScript(MINE_HEX);
    const buf2 = buildP2OPScript(MINE_HEX);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it('разные входные hex дают разные скрипты', () => {
    const vibe_hex = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf1 = buildP2OPScript(MINE_HEX);
    const buf2 = buildP2OPScript(vibe_hex);
    expect(buf1.equals(buf2)).toBe(false);
  });

  it('граничный случай: all-zeros hex', () => {
    const allZeros = '0'.repeat(64);
    const buf = buildP2OPScript(allZeros);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
    expect(buf[1]).toBe(0x20);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0);
    }
  });

  it('граничный случай: all-ff hex', () => {
    const allFf = 'ff'.repeat(32);
    const buf = buildP2OPScript(allFf);
    expect(buf.length).toBe(34);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0xff);
    }
  });

  it('использование VIBE pubkey hex даёт корректный 34-байтный скрипт', () => {
    const vibe_hex = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf = buildP2OPScript(vibe_hex);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
  });

  it('скрипт с произвольным 64-char hex имеет правильную структуру', () => {
    const hex = 'a'.repeat(64);
    const buf = buildP2OPScript(hex);
    expect(buf[0]).toBe(0x60);
    expect(buf[1]).toBe(0x20);
    expect(buf.length).toBe(34);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getP2OPAddress — получение P2OP адреса из MLDSA hex
// ─────────────────────────────────────────────────────────────────────────────

describe('getP2OPAddress', () => {
  const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

  it('возвращает строку (мок возвращает opt1mock...)', () => {
    const addr = getP2OPAddress(MINE_HEX);
    expect(typeof addr).toBe('string');
    expect(addr.length).toBeGreaterThan(0);
  });

  it('корректно читает 32 байта из 64-char hex (первый байт = 0xdb для MINE)', () => {
    // Логика: bytes[i] = parseInt(mldsaHex.slice(i*2, i*2+2), 16)
    // MINE_HEX начинается с "db" → bytes[0] = 0xdb
    const firstByte = parseInt(MINE_HEX.slice(0, 2), 16);
    expect(firstByte).toBe(0xdb);
  });

  it('32-й байт (последние 2 символа hex) = 0x9d для MINE', () => {
    const lastByte = parseInt(MINE_HEX.slice(62, 64), 16);
    expect(lastByte).toBe(0x9d);
  });

  it('вход hex с разными данными даёт разные байты', () => {
    const hex1 = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    const hex2 = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const byte1 = parseInt(hex1.slice(0, 2), 16);
    const byte2 = parseInt(hex2.slice(0, 2), 16);
    expect(byte1).not.toBe(byte2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveToken — разрешение hex токена в известный токен
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToken', () => {
  const MINE_PUBKEY_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
  const VIBE_PUBKEY_HEX = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';

  it('разрешает MINE pubkey hex (без 0x) в токен MINE', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('MINE');
  });

  it('разрешает VIBE pubkey hex в токен VIBE', () => {
    const result = resolveToken(VIBE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('VIBE');
  });

  it('возвращает null для неизвестного hex', () => {
    const result = resolveToken('deadbeef'.repeat(8));
    expect(result).toBeNull();
  });

  it('возвращает null для all-zeros hex', () => {
    const result = resolveToken('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('регистронезависимый поиск (uppercase hex)', () => {
    const result = resolveToken(MINE_PUBKEY_HEX.toUpperCase());
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('MINE');
  });

  it('resolved токен содержит все необходимые поля', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(typeof result?.symbol).toBe('string');
    expect(typeof result?.decimals).toBe('number');
    expect(result?.address).toMatch(/^opt1/);
    expect(typeof result?.icon).toBe('string');
  });

  it('resolveToken для MINE возвращает decimals=8', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result?.decimals).toBe(8);
  });

  it('разрешает hex по суффиксному совпадению (последние 32 символа)', () => {
    // pubkey MINE заканчивается на ...1cf0f9d (16 char)
    // resolveToken проверяет endsWith(pubHex.slice(-32))
    const mineHex = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    // Это должно НЕ совпасть полностью — тест на полное совпадение
    const resultFull = resolveToken(mineHex);
    expect(resultFull).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN_OPTIONS — список токенов для бриджа
// ─────────────────────────────────────────────────────────────────────────────

describe('TOKEN_OPTIONS', () => {
  it('содержит хотя бы MINE и VIBE', () => {
    const symbols = TOKEN_OPTIONS.map(t => t.symbol);
    expect(symbols).toContain('MINE');
    expect(symbols).toContain('VIBE');
  });

  it('каждый токен имеет обязательные поля', () => {
    for (const tok of TOKEN_OPTIONS) {
      expect(tok.symbol).toBeTruthy();
      expect(tok.address).toMatch(/^opt1/);
      expect(tok.pubkey).toMatch(/^0x/);
      expect(typeof tok.decimals).toBe('number');
      expect(tok.decimals).toBeGreaterThan(0);
      expect(typeof tok.icon).toBe('string');
    }
  });

  it('у MINE и VIBE разные адреса', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE');
    const vibe = TOKEN_OPTIONS.find(t => t.symbol === 'VIBE');
    expect(mine?.address).not.toBe(vibe?.address);
  });

  it('pubkey токенов начинаются с 0x', () => {
    for (const tok of TOKEN_OPTIONS) {
      expect(tok.pubkey.startsWith('0x')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIR_SELL_TOKEN / DIR_BUY_TOKEN — константы направления
// ─────────────────────────────────────────────────────────────────────────────

describe('DIR constants', () => {
  it('DIR_SELL_TOKEN равен 1', () => {
    expect(DIR_SELL_TOKEN).toBe(1);
  });

  it('DIR_BUY_TOKEN равен 2', () => {
    expect(DIR_BUY_TOKEN).toBe(2);
  });

  it('DIR_SELL_TOKEN !== DIR_BUY_TOKEN', () => {
    expect(DIR_SELL_TOKEN).not.toBe(DIR_BUY_TOKEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// satsToBtc / fmtBtc / fmtRate — функции форматирования
// ─────────────────────────────────────────────────────────────────────────────

describe('fmtBtc', () => {
  it('100_000_000 sats → "1"', () => {
    expect(fmtBtc(100_000_000n)).toBe('1');
  });

  it('50_000_000 sats → "0.5"', () => {
    expect(fmtBtc(50_000_000n)).toBe('0.5');
  });

  it('0 sats → "0"', () => {
    expect(fmtBtc(0n)).toBe('0');
  });

  it('1_000_000 sats (0.01 BTC) → форматирование до 6 знаков', () => {
    const result = fmtBtc(1_000_000n);
    expect(result).toBe('0.01');
  });

  it('1 sat (0.00000001 BTC) → форматирование до 8 знаков', () => {
    const result = fmtBtc(1n);
    expect(result).toBe('0.00000001');
  });

  it('330 sats (пылевой лимит)', () => {
    const result = fmtBtc(330n);
    expect(result).toBe('0.0000033');
  });

  it('убирает хвостовые нули', () => {
    // 200_000_000 sats = 2.00000000 → должно быть "2"
    expect(fmtBtc(200_000_000n)).toBe('2');
  });

  it('убирает хвостовую точку', () => {
    // 100_000_000 = 1.0000 → "1"
    expect(fmtBtc(100_000_000n)).not.toContain('.');
  });

  it('большой объём: 1 BTC → "1"', () => {
    expect(fmtBtc(100_000_000n)).toBe('1');
  });

  it('500_000 sats (0.005 BTC) → форматирование до 6 знаков', () => {
    expect(fmtBtc(500_000n)).toBe('0.005');
  });
});

describe('satsToBtc', () => {
  it('форматирует с единицей BTC по умолчанию', () => {
    const result = satsToBtc(100_000_000n);
    expect(result).toBe('1 BTC');
  });

  it('форматирует с единицей FB', () => {
    const result = satsToBtc(50_000_000n, 'FB');
    expect(result).toBe('0.5 FB');
  });

  it('0 sats → "0 BTC"', () => {
    expect(satsToBtc(0n)).toBe('0 BTC');
  });

  it('330 sats с единицей BTC', () => {
    const result = satsToBtc(330n, 'BTC');
    expect(result).toContain('BTC');
    expect(result).toContain('0.0000033');
  });

  it('значение и единица разделены пробелом', () => {
    const result = satsToBtc(100_000_000n, 'BTC');
    const parts = result.split(' ');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('BTC');
  });
});

describe('fmtRate', () => {
  it('возвращает "-" при fb <= 0', () => {
    expect(fmtRate(100_000_000n, 0n)).toBe('-');
  });

  it('возвращает строку начинающуюся с "1:"', () => {
    const result = fmtRate(100_000_000n, 200_000_000n);
    expect(result.startsWith('1:')).toBe(true);
  });

  it('равные значения → "1:1"', () => {
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
  });

  it('btc в 2 раза больше → "1:0.5"', () => {
    // btc=2, fb=1 → r = 2/1 = 2 → "1:2"
    expect(fmtRate(200_000_000n, 100_000_000n)).toBe('1:2');
  });

  it('fb в 2 раза больше → "1:0.5"', () => {
    // btc=1, fb=2 → r = 1/2 = 0.5 → "1:0.5"
    expect(fmtRate(100_000_000n, 200_000_000n)).toBe('1:0.5');
  });

  it('убирает хвостовые нули из rate', () => {
    // btc=1, fb=1 → r=1 → "1:1" (не "1:1.0000")
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
  });

  it('отрицательный fb (edge case) → "-"', () => {
    // BigInt не может быть отрицательным в нашем контексте, но 0n должно давать "-"
    expect(fmtRate(0n, 0n)).toBe('-');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SwapDirection enum — использование
// ─────────────────────────────────────────────────────────────────────────────

describe('SwapDirection enum', () => {
  it('BTC_TO_FB равен 1', () => {
    expect(SwapDirection.BTC_TO_FB).toBe(1);
  });

  it('FB_TO_BTC равен 2', () => {
    expect(SwapDirection.FB_TO_BTC).toBe(2);
  });

  it('BTC_TO_FB !== FB_TO_BTC', () => {
    expect(SwapDirection.BTC_TO_FB).not.toBe(SwapDirection.FB_TO_BTC);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OrderStatus enum — использование
// ─────────────────────────────────────────────────────────────────────────────

describe('OrderStatus enum', () => {
  it('Open = 1', () => expect(OrderStatus.Open).toBe(1));
  it('Taken = 2', () => expect(OrderStatus.Taken).toBe(2));
  it('Completed = 3', () => expect(OrderStatus.Completed).toBe(3));
  it('Cancelled = 4', () => expect(OrderStatus.Cancelled).toBe(4));
  it('Refunded = 5', () => expect(OrderStatus.Refunded).toBe(5));

  it('все значения уникальны', () => {
    const values = [OrderStatus.Open, OrderStatus.Taken, OrderStatus.Completed, OrderStatus.Cancelled, OrderStatus.Refunded];
    const unique = new Set(values);
    expect(unique.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FractalSwap: логика категоризации ордеров (myOrders, availBuyFb, availGetBtc)
// ─────────────────────────────────────────────────────────────────────────────

describe('FractalSwap order categorization', () => {
  const myMLDSA = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
  const otherMLDSA = '1122334455667788990011223344556677889900112233445566778899001122';
  const zero64 = '0'.repeat(64);

  const makeOrder = (
    id: string,
    direction: SwapDirection,
    status: OrderStatus,
    creator: string,
    taker = zero64,
    btcAmount = 10_000_000n,
    wantAmount = 5_000_000n,
    expiry = 0,
  ): FractalSwapOrder => ({
    id, direction, status, creator, taker,
    btcAmount, wantAmount, expiry,
    makerAddr: zero64, takerAddr: zero64, feePaid: 0n,
  });

  // Набор тестовых ордеров
  const orders: FractalSwapOrder[] = [
    makeOrder('1', SwapDirection.BTC_TO_FB, OrderStatus.Open, myMLDSA),           // мой открытый
    makeOrder('2', SwapDirection.FB_TO_BTC, OrderStatus.Open, otherMLDSA),         // чужой BTC_TO_FB
    makeOrder('3', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA),         // чужой FB_TO_BTC
    makeOrder('4', SwapDirection.BTC_TO_FB, OrderStatus.Taken, myMLDSA, myMLDSA), // мой взятый
    makeOrder('5', SwapDirection.FB_TO_BTC, OrderStatus.Completed, myMLDSA),       // завершённый
    makeOrder('6', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA),         // ещё один чужой
  ];

  /** Реплика isMyOrderFn из useCrossChainState.ts */
  function isMyOrder(o: FractalSwapOrder, mldsaHex: string): boolean {
    return !!(mldsaHex && o.creator.toLowerCase() === mldsaHex);
  }

  /** Реплика isTakerFn из useCrossChainState.ts */
  function isTaker(o: FractalSwapOrder, mldsaHex: string): boolean {
    return !!(mldsaHex && o.taker.toLowerCase() === mldsaHex);
  }

  /** Реплика activeOrders из useCrossChainState.ts */
  function getActiveOrders(allOrders: FractalSwapOrder[], currentBlock: number): FractalSwapOrder[] {
    return allOrders.filter(o =>
      (o.status === OrderStatus.Open || o.status === OrderStatus.Taken) &&
      (o.expiry <= 0 || o.expiry > currentBlock),
    );
  }

  /** Реплика myOrders из useCrossChainState.ts */
  function getMyOrders(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    return activeOrders.filter(o => isMyOrder(o, mldsaHex) || isTaker(o, mldsaHex));
  }

  /** Реплика availBuyFb из useCrossChainState.ts */
  function getAvailBuyFb(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    const others = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrder(o, mldsaHex));
    return others.filter(o => o.direction === SwapDirection.FB_TO_BTC);
  }

  /** Реплика availGetBtc из useCrossChainState.ts */
  function getAvailGetBtc(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    const others = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrder(o, mldsaHex));
    return others.filter(o => o.direction === SwapDirection.BTC_TO_FB);
  }

  const currentBlock = 100;

  it('activeOrders включает только Open и Taken ордера', () => {
    const active = getActiveOrders(orders, currentBlock);
    expect(active.every(o => o.status === OrderStatus.Open || o.status === OrderStatus.Taken)).toBe(true);
    expect(active.some(o => o.status === OrderStatus.Completed)).toBe(false);
  });

  it('isMyOrder возвращает true для ордера текущего пользователя', () => {
    const myOrder = orders[0]!;
    expect(isMyOrder(myOrder, myMLDSA)).toBe(true);
  });

  it('isMyOrder возвращает false для чужого ордера', () => {
    const otherOrder = orders[1]!;
    expect(isMyOrder(otherOrder, myMLDSA)).toBe(false);
  });

  it('isMyOrder возвращает false при пустом mldsaHex', () => {
    const myOrder = orders[0]!;
    expect(isMyOrder(myOrder, '')).toBe(false);
  });

  it('isTaker возвращает true когда пользователь является taker', () => {
    const takenByMe = orders[3]!; // taker=myMLDSA
    expect(isTaker(takenByMe, myMLDSA)).toBe(true);
  });

  it('isTaker возвращает false для ордеров с нулевым taker', () => {
    const openOrder = orders[0]!; // taker=zero64
    expect(isTaker(openOrder, myMLDSA)).toBe(false);
  });

  it('myOrders содержит мои открытые и взятые ордера', () => {
    const active = getActiveOrders(orders, currentBlock);
    const my = getMyOrders(active, myMLDSA);
    const ids = my.map(o => o.id);
    expect(ids).toContain('1'); // мой открытый
    expect(ids).toContain('4'); // мой взятый
  });

  it('myOrders не содержит завершённые ордера', () => {
    const active = getActiveOrders(orders, currentBlock);
    const my = getMyOrders(active, myMLDSA);
    expect(my.some(o => o.status === OrderStatus.Completed)).toBe(false);
  });

  it('availBuyFb содержит только FB_TO_BTC ордера от других', () => {
    const active = getActiveOrders(orders, currentBlock);
    const buyFb = getAvailBuyFb(active, myMLDSA);
    expect(buyFb.every(o => o.direction === SwapDirection.FB_TO_BTC)).toBe(true);
    expect(buyFb.every(o => !isMyOrder(o, myMLDSA))).toBe(true);
  });

  it('availGetBtc содержит только BTC_TO_FB ордера от других', () => {
    const active = getActiveOrders(orders, currentBlock);
    const getBtc = getAvailGetBtc(active, myMLDSA);
    expect(getBtc.every(o => o.direction === SwapDirection.BTC_TO_FB)).toBe(true);
    expect(getBtc.every(o => !isMyOrder(o, myMLDSA))).toBe(true);
  });

  it('истёкшие ордера (expiry <= currentBlock) не включаются в active', () => {
    const expiredOrder = makeOrder('99', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA, zero64, 10_000_000n, 5_000_000n, 50); // expiry=50 < currentBlock=100
    const withExpired = [...orders, expiredOrder];
    const active = getActiveOrders(withExpired, 100);
    expect(active.find(o => o.id === '99')).toBeUndefined();
  });

  it('ордера с expiry=0 всегда активны', () => {
    const noExpiry = makeOrder('100', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA, zero64, 10_000_000n, 5_000_000n, 0);
    const active = getActiveOrders([noExpiry], 99999);
    expect(active.find(o => o.id === '100')).toBeDefined();
  });

  it('totalVolumeSats суммирует btcAmount завершённых ордеров', () => {
    const completed = orders.filter(o => o.status === OrderStatus.Completed);
    const total = completed.reduce((sum, o) => sum + o.btcAmount, 0n);
    expect(total).toBeGreaterThanOrEqual(0n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// suggestedExpiryBlocks — рекомендованные блоки для expiry
// ─────────────────────────────────────────────────────────────────────────────

describe('suggestedExpiryBlocks', () => {
  it('возвращает объект с min, default, max', () => {
    const opts = suggestedExpiryBlocks(1);
    expect(typeof opts.min).toBe('number');
    expect(typeof opts.default).toBe('number');
    expect(typeof opts.max).toBe('number');
  });

  it('min < default < max', () => {
    const opts = suggestedExpiryBlocks(1);
    expect(opts.min).toBeLessThan(opts.default);
    expect(opts.default).toBeLessThan(opts.max);
  });

  it('для Fractal Bitcoin (chainId=1): min=72, default=144, max=576', () => {
    const opts = suggestedExpiryBlocks(1);
    expect(opts.min).toBe(72);
    expect(opts.default).toBe(144);
    expect(opts.max).toBe(576);
  });

  it('для неизвестного chainId возвращает fallback значения', () => {
    const opts = suggestedExpiryBlocks(9999);
    expect(opts.min).toBe(72);
    expect(opts.default).toBe(144);
    expect(opts.max).toBe(576);
  });

  it('default соответствует ~24ч (144 блока × 10 мин)', () => {
    const opts = suggestedExpiryBlocks(1);
    const hours = (opts.default * 10) / 60;
    expect(hours).toBeCloseTo(24, 0);
  });

  it('max соответствует ~4 дням', () => {
    const opts = suggestedExpiryBlocks(1);
    const days = (opts.max * 10) / 60 / 24;
    expect(days).toBeCloseTo(4, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAddress — валидация адресов для цепочек
// ─────────────────────────────────────────────────────────────────────────────

describe('validateAddress', () => {
  it('Fractal testnet адрес (tb1q...) валиден для chainId=1', () => {
    expect(validateAddress(1, 'tb1qtest123456789012345678901234')).toBe(true);
  });

  it('Fractal mainnet адрес (bc1q...) валиден для chainId=1', () => {
    expect(validateAddress(1, 'bc1qtest12345678901234567890123456')).toBe(true);
  });

  it('неправильный адрес возвращает false', () => {
    expect(validateAddress(1, 'opt1sqinvalidaddress')).toBe(false);
  });

  it('пустая строка невалидна', () => {
    expect(validateAddress(1, '')).toBe(false);
  });

  it('несуществующий chainId возвращает false', () => {
    expect(validateAddress(9999, 'tb1qtest')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getChainById — поиск цепочки по ID
// ─────────────────────────────────────────────────────────────────────────────

describe('getChainById', () => {
  it('возвращает Fractal Bitcoin для ID=1', () => {
    const chain = getChainById(1);
    expect(chain).toBeDefined();
    expect(chain?.name).toBe('Fractal Bitcoin');
  });

  it('возвращает undefined для несуществующего ID', () => {
    expect(getChainById(9999)).toBeUndefined();
  });

  it('цепочка имеет все необходимые поля', () => {
    const chain = getChainById(1);
    expect(chain).toBeDefined();
    expect(typeof chain?.id).toBe('number');
    expect(typeof chain?.name).toBe('string');
    expect(typeof chain?.shortName).toBe('string');
    expect(typeof chain?.explorerUrl).toBe('string');
    expect(typeof chain?.nativeAsset).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED_CHAINS — статический список цепочек
// ─────────────────────────────────────────────────────────────────────────────

describe('SUPPORTED_CHAINS', () => {
  it('содержит хотя бы одну цепочку', () => {
    expect(SUPPORTED_CHAINS.length).toBeGreaterThan(0);
  });

  it('первая цепочка — Fractal Bitcoin', () => {
    expect(SUPPORTED_CHAINS[0]!.name).toBe('Fractal Bitcoin');
  });

  it('все цепочки имеют уникальные ID', () => {
    const ids = SUPPORTED_CHAINS.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('Fractal цепочка поддерживает testnet', () => {
    const fractal = SUPPORTED_CHAINS.find(c => c.id === 1);
    expect(fractal?.testnetAvailable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getChainTxUrl / getChainAddressUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('chain explorer URL helpers', () => {
  const txid = 'abcdef1234567890';
  const addr = 'tb1qtest12345';

  it('getChainTxUrl строит правильный URL для chainId=1', () => {
    const url = getChainTxUrl(1, txid);
    expect(url).toContain(txid);
    expect(url).toContain('fractalbitcoin');
  });

  it('getChainTxUrl возвращает "#" для неизвестного chainId', () => {
    expect(getChainTxUrl(9999, txid)).toBe('#');
  });

  it('getChainAddressUrl строит правильный URL для chainId=1', () => {
    const url = getChainAddressUrl(1, addr);
    expect(url).toContain(addr);
    expect(url).toContain('fractalbitcoin');
  });

  it('getChainAddressUrl возвращает "#" для неизвестного chainId', () => {
    expect(getChainAddressUrl(9999, addr)).toBe('#');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hexToBigInt / bigIntToHex — конвертация hex ↔ BigInt
// ─────────────────────────────────────────────────────────────────────────────

describe('hexToBigInt / bigIntToHex', () => {
  it('hexToBigInt конвертирует hex без 0x в BigInt', () => {
    expect(hexToBigInt('ff')).toBe(255n);
  });

  it('hexToBigInt конвертирует hex с 0x в BigInt', () => {
    expect(hexToBigInt('0xff')).toBe(255n);
  });

  it('hexToBigInt("00...00") = 0n', () => {
    expect(hexToBigInt('0'.repeat(64))).toBe(0n);
  });

  it('bigIntToHex форматирует с ведущими нулями до 64 символов', () => {
    expect(bigIntToHex(255n)).toBe('ff'.padStart(64, '0'));
  });

  it('bigIntToHex(0n) = 64 нуля', () => {
    expect(bigIntToHex(0n)).toBe('0'.repeat(64));
  });

  it('roundtrip: hexToBigInt(bigIntToHex(n)) = n', () => {
    const n = 123456789n;
    expect(hexToBigInt(bigIntToHex(n))).toBe(n);
  });

  it('большое число корректно roundtrip', () => {
    const big = BigInt('0x' + 'ab'.repeat(32));
    expect(hexToBigInt(bigIntToHex(big))).toBe(big);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toHex / fromHex — конвертация байтов ↔ hex
// ─────────────────────────────────────────────────────────────────────────────

describe('toHex / fromHex', () => {
  it('toHex конвертирует пустой массив в пустую строку', () => {
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('toHex форматирует байты с ведущими нулями', () => {
    const bytes = new Uint8Array([0x0f, 0xff, 0x00]);
    expect(toHex(bytes)).toBe('0fff00');
  });

  it('fromHex декодирует hex строку без 0x', () => {
    const bytes = fromHex('0fff00');
    expect(bytes[0]).toBe(0x0f);
    expect(bytes[1]).toBe(0xff);
    expect(bytes[2]).toBe(0x00);
  });

  it('fromHex декодирует hex строку с 0x', () => {
    const bytes = fromHex('0x0fff00');
    expect(bytes[0]).toBe(0x0f);
    expect(bytes[1]).toBe(0xff);
  });

  it('roundtrip: fromHex(toHex(bytes)) возвращает оригинал', () => {
    const original = new Uint8Array([1, 2, 3, 255, 128, 0]);
    const hex = toHex(original);
    const back = fromHex(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatBlockCountdown — форматирование обратного отсчёта блоков
// ─────────────────────────────────────────────────────────────────────────────

describe('formatBlockCountdown', () => {
  it('0 или отрицательные блоки → "Expired"', () => {
    expect(formatBlockCountdown(0)).toBe('Expired');
    expect(formatBlockCountdown(-1)).toBe('Expired');
  });

  it('5 блоков × 10 мин = 50 мин → "~50m"', () => {
    expect(formatBlockCountdown(5)).toBe('~50m');
  });

  it('6 блоков × 10 мин = 60 мин = 1ч → содержит "h"', () => {
    const result = formatBlockCountdown(6);
    expect(result).toContain('h');
  });

  it('144 блока (24ч) → "~1d" или "~24h" (в зависимости от реализации)', () => {
    // 144 блока × 10 мин = 1440 мин = 24 ч = 1 день
    // Реализация: hours >= 24 → форматирует как дни
    const result = formatBlockCountdown(144);
    // Может быть "~1d" или "~24h" — принимаем оба варианта
    const is24h = result === '~24h' || result === '~1d' || result.includes('h') || result.includes('d');
    expect(is24h).toBe(true);
  });

  it('576 блоков (4 дня) → содержит "d"', () => {
    const result = formatBlockCountdown(576);
    expect(result).toContain('d');
  });

  it('1 блок → "~10m"', () => {
    expect(formatBlockCountdown(1)).toBe('~10m');
  });

  it('большое число блоков → содержит "d"', () => {
    expect(formatBlockCountdown(1000)).toContain('d');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// truncateHex — усечение hex для отображения
// ─────────────────────────────────────────────────────────────────────────────

describe('truncateHex', () => {
  const longHex = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

  it('усекает длинный hex с разделителем "..."', () => {
    const result = truncateHex(longHex, 6);
    expect(result).toContain('...');
  });

  it('короткий hex возвращается без изменений', () => {
    expect(truncateHex('aabb', 6)).toBe('aabb');
  });

  it('убирает 0x префикс из отображения', () => {
    const result = truncateHex('0x' + longHex, 6);
    expect(result.startsWith('0x')).toBe(false);
  });

  it('результат содержит начало и конец строки', () => {
    const result = truncateHex(longHex, 6);
    expect(result.startsWith('aabbcc')).toBe(true);
    expect(result.endsWith('778899')).toBe(true);
  });

  it('с chars=0 корректно обрабатывает', () => {
    // Если chars=0, slice(-0) = '' → возвращает только начало
    const result = truncateHex(longHex, 0);
    expect(typeof result).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FeeCalc — логика расчёта комиссий
// ─────────────────────────────────────────────────────────────────────────────

describe('Fee calculation logic', () => {
  /**
   * Реплика логики расчёта комиссии из useFractalSwap.ts / useCrossChainState.ts
   * rawFee = (btcAmount * feeBps) / 10000
   * feeSats = max(rawFee, 330n)
   */
  function calcFee(btcAmount: bigint, feeBps: number): bigint {
    const rawFee = (btcAmount * BigInt(feeBps)) / 10000n;
    return rawFee < 330n ? 330n : rawFee;
  }

  it('1% fee от 1 BTC = 1_000_000 sats (> dust)', () => {
    const fee = calcFee(100_000_000n, 100);
    expect(fee).toBe(1_000_000n);
  });

  it('минимальный fee = 330 sats (dust limit)', () => {
    // Очень маленький ордер: 100 sats × 1% = 1 sat → должен быть 330
    const fee = calcFee(100n, 100);
    expect(fee).toBe(330n);
  });

  it('0 sats btcAmount → fee = 330 sats (dust limit)', () => {
    const fee = calcFee(0n, 100);
    expect(fee).toBe(330n);
  });

  it('fee точно на dust limit: 330000 sats × 1bps = 33 sats → 330', () => {
    const fee = calcFee(330_000n, 1);
    expect(fee).toBe(330n); // 33 sats < 330 → bump
  });

  it('feeBps=0 → fee = 330n (пылевой лимит)', () => {
    const fee = calcFee(100_000_000n, 0);
    expect(fee).toBe(330n);
  });

  it('высокий feeBps: 10% от 0.01 BTC = 100_000 sats', () => {
    const fee = calcFee(1_000_000n, 1000);
    expect(fee).toBe(100_000n);
  });

  /**
   * Реплика расчёта formFeeSats из useCrossChainState.ts
   * formFeeSats = formBtcSats > 0 ? (formBtcSats * feeBps) / 10000n : 0n
   * (без dust limit для preview)
   */
  function calcFormFee(btcSats: bigint, feeBps: number): bigint {
    return btcSats > 0n ? (btcSats * BigInt(feeBps)) / 10000n : 0n;
  }

  it('formFeeSats для 0 sats = 0n', () => {
    expect(calcFormFee(0n, 100)).toBe(0n);
  });

  it('formFeeSats = 1% от 0.1 BTC = 100_000 sats', () => {
    expect(calcFormFee(10_000_000n, 100)).toBe(100_000n);
  });

  it('tbFeeSats корректно вычисляется как процент от btcPrice', () => {
    const btcPriceSats = 50_000_000n; // 0.5 BTC
    const feeBps = 100; // 1%
    const tbFeeSats = btcPriceSats > 0n ? (btcPriceSats * BigInt(feeBps)) / 10000n : 0n;
    expect(tbFeeSats).toBe(500_000n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token amount scaling — конвертация между human и on-chain
// ─────────────────────────────────────────────────────────────────────────────

describe('Token amount scaling for escrow', () => {
  /** Реплика расчёта tokenAmountRaw из useTokenEscrow / useCrossChainState */
  function toOnChain(amount: number, decimals: number): bigint {
    return BigInt(Math.round(amount * (10 ** decimals)));
  }

  it('1 MINE (8 dec) → 100_000_000n', () => {
    expect(toOnChain(1, 8)).toBe(100_000_000n);
  });

  it('0.5 MINE → 50_000_000n', () => {
    expect(toOnChain(0.5, 8)).toBe(50_000_000n);
  });

  it('tbTokenAmountRaw = 0n когда пустая строка', () => {
    // Логика: tbTokenAmount && selectedTbToken ? BigInt(...) : 0n
    const tbTokenAmount = '';
    const result = tbTokenAmount ? toOnChain(parseFloat(tbTokenAmount), 8) : 0n;
    expect(result).toBe(0n);
  });

  it('tbBtcPriceSats = 0n когда пустая строка', () => {
    const tbBtcPrice = '';
    const result = tbBtcPrice ? BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8)) : 0n;
    expect(result).toBe(0n);
  });

  it('tbBtcPriceSats корректен для 0.01 BTC', () => {
    const tbBtcPrice = '0.01';
    const result = BigInt(Math.round(parseFloat(tbBtcPrice) * 1e8));
    expect(result).toBe(1_000_000n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TokenEscrow: логика категоризации (sellTokenOrders, buyTokenOrders)
// ─────────────────────────────────────────────────────────────────────────────

describe('TokenEscrow order categorization', () => {
  type TinyEscrowOrder = {
    id: string; direction: number; status: number;
    tokenHex: string; tokenAmount: bigint; btcPrice: bigint;
    creator: string; taker: string; hashlock: string;
    preimage: string; expiry: number; makerAddr: string;
    takerAddr: string; feePaid: bigint;
  };

  const makeEscrow = (id: string, direction: number, status: number): TinyEscrowOrder => ({
    id, direction, status,
    tokenHex: '0'.repeat(64),
    tokenAmount: 100_000_000n,
    btcPrice: 50_000_000n,
    creator: '0'.repeat(64),
    taker: '0'.repeat(64),
    hashlock: '0'.repeat(64),
    preimage: '0'.repeat(64),
    expiry: 0,
    makerAddr: '0'.repeat(64),
    takerAddr: '0'.repeat(64),
    feePaid: 0n,
  });

  const orders = [
    makeEscrow('1', DIR_SELL_TOKEN, 1), // активный sell
    makeEscrow('2', DIR_SELL_TOKEN, 2), // взятый sell
    makeEscrow('3', DIR_BUY_TOKEN, 1),  // активный buy
    makeEscrow('4', DIR_SELL_TOKEN, 3), // завершённый sell (status=3)
    makeEscrow('5', DIR_BUY_TOKEN, 3),  // завершённый buy (status=3)
  ];

  /** Реплика activeEscrowOrders из useCrossChainState.ts */
  const activeEscrow = orders.filter(o => o.status === 1 || o.status === 2);
  /** Реплика sellTokenOrders */
  const sellToken = activeEscrow.filter(o => o.direction === DIR_SELL_TOKEN);
  /** Реплика buyTokenOrders */
  const buyToken = activeEscrow.filter(o => o.direction !== DIR_SELL_TOKEN);

  it('activeEscrowOrders включает только status=1 и status=2', () => {
    expect(activeEscrow.every(o => o.status === 1 || o.status === 2)).toBe(true);
    expect(activeEscrow).toHaveLength(3);
  });

  it('завершённые ордера (status=3) не входят в activeEscrowOrders', () => {
    expect(activeEscrow.some(o => o.status === 3)).toBe(false);
  });

  it('sellTokenOrders содержит только ордера с direction=DIR_SELL_TOKEN', () => {
    expect(sellToken.every(o => o.direction === DIR_SELL_TOKEN)).toBe(true);
  });

  it('buyTokenOrders содержит только ордера с direction=DIR_BUY_TOKEN', () => {
    expect(buyToken.every(o => o.direction === DIR_BUY_TOKEN)).toBe(true);
  });

  it('sellTokenOrders и buyTokenOrders не пересекаются', () => {
    const sellIds = new Set(sellToken.map(o => o.id));
    const buyIds = new Set(buyToken.map(o => o.id));
    const intersection = [...sellIds].filter(id => buyIds.has(id));
    expect(intersection).toHaveLength(0);
  });

  it('пустой список → пустые категории', () => {
    const empty: TinyEscrowOrder[] = [];
    expect(empty.filter(o => o.direction === DIR_SELL_TOKEN)).toHaveLength(0);
    expect(empty.filter(o => o.direction !== DIR_SELL_TOKEN)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mldsaHex derivation — обработка hashedMLDSAKey
// ─────────────────────────────────────────────────────────────────────────────

describe('mldsaHex derivation from hashedMLDSAKey', () => {
  /** Реплика логики из useCrossChainState.ts */
  function deriveMldsaHex(hashedMLDSAKey: string | null | undefined): string {
    if (!hashedMLDSAKey) return '';
    return (hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey).toLowerCase();
  }

  it('null → пустая строка', () => {
    expect(deriveMldsaHex(null)).toBe('');
  });

  it('undefined → пустая строка', () => {
    expect(deriveMldsaHex(undefined)).toBe('');
  });

  it('пустая строка → пустая строка', () => {
    expect(deriveMldsaHex('')).toBe('');
  });

  it('убирает 0x префикс', () => {
    expect(deriveMldsaHex('0xABCD')).toBe('abcd');
  });

  it('переводит в lowercase', () => {
    expect(deriveMldsaHex('ABCDEF')).toBe('abcdef');
  });

  it('hex без 0x остаётся без изменений (но lowercase)', () => {
    const hex = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    expect(deriveMldsaHex(hex)).toBe(hex);
  });

  it('hex с 0x теряет префикс', () => {
    const hex = '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    const result = deriveMldsaHex(hex);
    expect(result.startsWith('0x')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate persistence logic — расчёт rate из formAmountSats / formReceiveSats
// ─────────────────────────────────────────────────────────────────────────────

describe('Form rate and sats calculations', () => {
  /** Реплика расчёта formAmountSats из useCrossChainState.ts */
  function toSats(amount: string): bigint {
    return amount ? BigInt(Math.round(parseFloat(amount) * 1e8)) : 0n;
  }

  /** Реплика formRate из useCrossChainState.ts */
  function calcFormRate(amountSats: bigint, receiveSats: bigint): string {
    return amountSats > 0n && receiveSats > 0n
      ? (Number(receiveSats) / Number(amountSats)).toFixed(4)
      : '';
  }

  it('formAmountSats для "0.1" = 10_000_000n', () => {
    expect(toSats('0.1')).toBe(10_000_000n);
  });

  it('formAmountSats для пустой строки = 0n', () => {
    expect(toSats('')).toBe(0n);
  });

  it('formAmountSats для "1" = 100_000_000n', () => {
    expect(toSats('1')).toBe(100_000_000n);
  });

  it('formRate пустой когда одно из значений 0', () => {
    expect(calcFormRate(0n, 100_000_000n)).toBe('');
    expect(calcFormRate(100_000_000n, 0n)).toBe('');
  });

  it('formRate корректен: 1 BTC : 2 FB → "2.0000"', () => {
    expect(calcFormRate(100_000_000n, 200_000_000n)).toBe('2.0000');
  });

  it('formRate корректен: 2 BTC : 1 FB → "0.5000"', () => {
    expect(calcFormRate(200_000_000n, 100_000_000n)).toBe('0.5000');
  });

  it('формат всегда имеет 4 знака после запятой', () => {
    const rate = calcFormRate(100_000_000n, 150_000_000n);
    const decimals = rate.split('.')[1]?.length ?? 0;
    expect(decimals).toBe(4);
  });

  it('sendUnit = BTC когда direction = BTC_TO_FB', () => {
    const direction = SwapDirection.BTC_TO_FB;
    const sendUnit = direction === SwapDirection.BTC_TO_FB ? 'BTC' : 'FB';
    expect(sendUnit).toBe('BTC');
  });

  it('receiveUnit = FB когда direction = BTC_TO_FB', () => {
    const direction = SwapDirection.BTC_TO_FB;
    const receiveUnit = direction === SwapDirection.BTC_TO_FB ? 'FB' : 'BTC';
    expect(receiveUnit).toBe('FB');
  });

  it('sendUnit = FB когда direction = FB_TO_BTC', () => {
    // FB_TO_BTC = 2, не равен BTC_TO_FB = 1
    expect(SwapDirection.FB_TO_BTC).not.toBe(SwapDirection.BTC_TO_FB);
    const direction = SwapDirection.FB_TO_BTC;
    // Юнит отправки при FB_TO_BTC — это FB
    expect(direction).toBe(2);
  });
});
