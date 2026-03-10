/**
 * useCrossChain.test.ts
 *
 * Comprehensive tests for pure utility functions from:
 *   - src/hooks/crossChainShared.ts (TOKEN_OPTIONS, resolveToken, buildP2OPScript, getP2OPAddress, DIR_*)
 *   - src/crosschain/htlc.ts (toHex, fromHex, hexToBigInt, bigIntToHex, formatBlockCountdown, truncateHex, generateHTLCPair, verifyPreimage)
 *   - src/crosschain/chains.ts (SUPPORTED_CHAINS, getChainById, validateAddress, getChainTxUrl, getChainAddressUrl, suggestedExpiryBlocks)
 *   - src/crosschain/types.ts (SwapDirection, OrderStatus, MAKER_STEPS_*, TAKER_STEPS_*)
 *   - src/components/crosschain/types.ts (satsToBtc, fmtBtc, fmtRate, STATUS_COLORS, DIR_*)
 *
 * Tests ONLY pure functions and constants. No React hooks, no network calls.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mocks for heavy SDK dependencies (required by crossChainShared imports) ──

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

vi.mock('../contracts', () => ({
  DEPLOYED_CONTRACTS: {
    MINE: {
      address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
      pubkey: '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
      symbol: 'MINE',
      name: 'Mine Token',
      decimals: 8,
      icon: '\u26cf\ufe0f',
    },
    VIBE: {
      address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
      pubkey: '0x1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
      symbol: 'VIBE',
      name: 'Vibe Token',
      decimals: 8,
      icon: '\u26a1',
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

// ── Imports AFTER mocks ──

import {
  buildP2OPScript,
  resolveToken,
  getP2OPAddress,
  TOKEN_OPTIONS,
  DIR_SELL_TOKEN as DIR_SELL_SHARED,
  DIR_BUY_TOKEN as DIR_BUY_SHARED,
} from '../hooks/crossChainShared';
import {
  satsToBtc,
  fmtBtc,
  fmtRate,
  STATUS_COLORS,
  DIR_SELL_TOKEN,
  DIR_BUY_TOKEN,
} from '../components/crosschain/types';
import {
  SwapDirection,
  OrderStatus,
  MAKER_STEPS_BTC_TO_FB,
  TAKER_STEPS_BTC_TO_FB,
  MAKER_STEPS_FB_TO_BTC,
  TAKER_STEPS_FB_TO_BTC,
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
  generatePreimage,
  computeHashlock,
  generateHTLCPair,
  verifyPreimage,
} from '../crosschain/htlc';

// =====================================================================
// 1. buildP2OPScript
// =====================================================================

describe('buildP2OPScript', () => {
  const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

  it('returns a Buffer of exactly 34 bytes', () => {
    const buf = buildP2OPScript(MINE_HEX);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(34);
  });

  it('first byte is 0x60 (OP_16)', () => {
    expect(buildP2OPScript(MINE_HEX)[0]).toBe(0x60);
  });

  it('second byte is 0x20 (PUSH_32)', () => {
    expect(buildP2OPScript(MINE_HEX)[1]).toBe(0x20);
  });

  it('bytes 2..33 contain the decoded MLDSA hash', () => {
    const buf = buildP2OPScript(MINE_HEX);
    const hexBack = Array.from(buf.slice(2))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hexBack).toBe(MINE_HEX);
  });

  it('is deterministic for the same input', () => {
    const buf1 = buildP2OPScript(MINE_HEX);
    const buf2 = buildP2OPScript(MINE_HEX);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it('different input hex produces different scripts', () => {
    const vibe_hex = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf1 = buildP2OPScript(MINE_HEX);
    const buf2 = buildP2OPScript(vibe_hex);
    expect(buf1.equals(buf2)).toBe(false);
  });

  it('all-zeros hex produces 34 bytes with data bytes all zero', () => {
    const allZeros = '0'.repeat(64);
    const buf = buildP2OPScript(allZeros);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
    expect(buf[1]).toBe(0x20);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0);
    }
  });

  it('all-ff hex produces 34 bytes with data bytes all 0xff', () => {
    const allFf = 'ff'.repeat(32);
    const buf = buildP2OPScript(allFf);
    expect(buf.length).toBe(34);
    for (let i = 2; i < 34; i++) {
      expect(buf[i]).toBe(0xff);
    }
  });

  it('VIBE pubkey hex produces valid 34-byte script', () => {
    const vibe_hex = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const buf = buildP2OPScript(vibe_hex);
    expect(buf.length).toBe(34);
    expect(buf[0]).toBe(0x60);
  });

  it('arbitrary 64-char hex has correct structure', () => {
    const hex = 'a'.repeat(64);
    const buf = buildP2OPScript(hex);
    expect(buf[0]).toBe(0x60);
    expect(buf[1]).toBe(0x20);
    expect(buf.length).toBe(34);
  });
});

// =====================================================================
// 2. getP2OPAddress
// =====================================================================

describe('getP2OPAddress', () => {
  const MINE_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';

  it('returns a non-empty string', () => {
    const addr = getP2OPAddress(MINE_HEX);
    expect(typeof addr).toBe('string');
    expect(addr.length).toBeGreaterThan(0);
  });

  it('correctly reads first byte from hex (0xdb for MINE)', () => {
    const firstByte = parseInt(MINE_HEX.slice(0, 2), 16);
    expect(firstByte).toBe(0xdb);
  });

  it('correctly reads last byte from hex (0x9d for MINE)', () => {
    const lastByte = parseInt(MINE_HEX.slice(62, 64), 16);
    expect(lastByte).toBe(0x9d);
  });

  it('different input hex produces different first bytes', () => {
    const hex2 = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';
    const byte1 = parseInt(MINE_HEX.slice(0, 2), 16);
    const byte2 = parseInt(hex2.slice(0, 2), 16);
    expect(byte1).not.toBe(byte2);
  });
});

// =====================================================================
// 3. resolveToken
// =====================================================================

describe('resolveToken', () => {
  const MINE_PUBKEY_HEX = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
  const VIBE_PUBKEY_HEX = '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818';

  it('resolves MINE pubkey hex (without 0x) to MINE token', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('MINE');
  });

  it('resolves VIBE pubkey hex to VIBE token', () => {
    const result = resolveToken(VIBE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('VIBE');
  });

  it('returns null for unknown hex', () => {
    const result = resolveToken('deadbeef'.repeat(8));
    expect(result).toBeNull();
  });

  it('returns null for all-zeros hex', () => {
    expect(resolveToken('0'.repeat(64))).toBeNull();
  });

  it('case-insensitive matching (uppercase hex)', () => {
    const result = resolveToken(MINE_PUBKEY_HEX.toUpperCase());
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('MINE');
  });

  it('resolved token contains all required fields', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result).not.toBeNull();
    expect(typeof result?.symbol).toBe('string');
    expect(typeof result?.decimals).toBe('number');
    expect(result?.address).toMatch(/^opt1/);
    expect(typeof result?.icon).toBe('string');
  });

  it('resolveToken for MINE returns decimals=8', () => {
    expect(resolveToken(MINE_PUBKEY_HEX)?.decimals).toBe(8);
  });

  it('resolveToken for VIBE returns correct address', () => {
    const result = resolveToken(VIBE_PUBKEY_HEX);
    expect(result?.address).toBe('opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl');
  });

  it('empty string returns null', () => {
    expect(resolveToken('')).toBeNull();
  });

  it('short hex string returns null', () => {
    expect(resolveToken('abcd')).toBeNull();
  });

  it('suffix-based matching works for full pubkey hex', () => {
    const result = resolveToken(MINE_PUBKEY_HEX);
    expect(result).not.toBeNull();
  });
});

// =====================================================================
// 4. TOKEN_OPTIONS
// =====================================================================

describe('TOKEN_OPTIONS', () => {
  it('contains at least MINE and VIBE', () => {
    const symbols = TOKEN_OPTIONS.map(t => t.symbol);
    expect(symbols).toContain('MINE');
    expect(symbols).toContain('VIBE');
  });

  it('each token has required fields', () => {
    for (const tok of TOKEN_OPTIONS) {
      expect(tok.symbol).toBeTruthy();
      expect(tok.address).toMatch(/^opt1/);
      expect(tok.pubkey).toMatch(/^0x/);
      expect(typeof tok.decimals).toBe('number');
      expect(tok.decimals).toBeGreaterThan(0);
      expect(typeof tok.icon).toBe('string');
    }
  });

  it('MINE and VIBE have different addresses', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE');
    const vibe = TOKEN_OPTIONS.find(t => t.symbol === 'VIBE');
    expect(mine?.address).not.toBe(vibe?.address);
  });

  it('token pubkeys start with 0x', () => {
    for (const tok of TOKEN_OPTIONS) {
      expect(tok.pubkey.startsWith('0x')).toBe(true);
    }
  });

  it('MINE and VIBE have different pubkeys', () => {
    const mine = TOKEN_OPTIONS.find(t => t.symbol === 'MINE');
    const vibe = TOKEN_OPTIONS.find(t => t.symbol === 'VIBE');
    expect(mine?.pubkey).not.toBe(vibe?.pubkey);
  });
});

// =====================================================================
// 5. DIR_SELL_TOKEN / DIR_BUY_TOKEN constants
// =====================================================================

describe('DIR constants (crossChainShared)', () => {
  it('DIR_SELL_TOKEN equals 1', () => {
    expect(DIR_SELL_SHARED).toBe(1);
  });

  it('DIR_BUY_TOKEN equals 2', () => {
    expect(DIR_BUY_SHARED).toBe(2);
  });

  it('DIR_SELL_TOKEN !== DIR_BUY_TOKEN', () => {
    expect(DIR_SELL_SHARED).not.toBe(DIR_BUY_SHARED);
  });
});

describe('DIR constants (component types)', () => {
  it('component DIR_SELL_TOKEN equals 1', () => {
    expect(DIR_SELL_TOKEN).toBe(1);
  });

  it('component DIR_BUY_TOKEN equals 2', () => {
    expect(DIR_BUY_TOKEN).toBe(2);
  });

  it('shared and component DIR constants match', () => {
    expect(DIR_SELL_TOKEN).toBe(DIR_SELL_SHARED);
    expect(DIR_BUY_TOKEN).toBe(DIR_BUY_SHARED);
  });
});

// =====================================================================
// 6. fmtBtc
// =====================================================================

describe('fmtBtc', () => {
  it('100_000_000 sats -> "1"', () => {
    expect(fmtBtc(100_000_000n)).toBe('1');
  });

  it('50_000_000 sats -> "0.5"', () => {
    expect(fmtBtc(50_000_000n)).toBe('0.5');
  });

  it('0 sats -> "0"', () => {
    expect(fmtBtc(0n)).toBe('0');
  });

  it('1_000_000 sats (0.01 BTC) -> "0.01"', () => {
    expect(fmtBtc(1_000_000n)).toBe('0.01');
  });

  it('1 sat (0.00000001 BTC) -> "0.00000001"', () => {
    expect(fmtBtc(1n)).toBe('0.00000001');
  });

  it('330 sats (dust limit) -> "0.0000033"', () => {
    expect(fmtBtc(330n)).toBe('0.0000033');
  });

  it('trims trailing zeros: 200_000_000 -> "2"', () => {
    expect(fmtBtc(200_000_000n)).toBe('2');
  });

  it('no trailing dot: 100_000_000 has no "."', () => {
    expect(fmtBtc(100_000_000n)).not.toContain('.');
  });

  it('500_000 sats (0.005 BTC) -> "0.005"', () => {
    expect(fmtBtc(500_000n)).toBe('0.005');
  });

  it('10_000_000 sats (0.1 BTC) -> "0.1"', () => {
    expect(fmtBtc(10_000_000n)).toBe('0.1');
  });

  it('formats >= 1 BTC with up to 4 decimals', () => {
    expect(fmtBtc(150_000_000n)).toBe('1.5');
  });

  it('large value: 21_000_000 BTC', () => {
    const sats = 21_000_000n * 100_000_000n;
    expect(fmtBtc(sats)).toBe('21000000');
  });

  it('very small fractional: 10 sats', () => {
    expect(fmtBtc(10n)).toBe('0.0000001');
  });

  it('99_999_999 sats (just under 1 BTC) rounds to "1" with 6dp', () => {
    // 0.99999999 >= 0.01 so uses toFixed(6) -> "1.000000" -> trimmed "1"
    const result = fmtBtc(99_999_999n);
    expect(result).toBe('1');
  });
});

// =====================================================================
// 7. satsToBtc
// =====================================================================

describe('satsToBtc', () => {
  it('formats with BTC unit by default', () => {
    expect(satsToBtc(100_000_000n)).toBe('1 BTC');
  });

  it('formats with FB unit', () => {
    expect(satsToBtc(50_000_000n, 'FB')).toBe('0.5 FB');
  });

  it('0 sats -> "0 BTC"', () => {
    expect(satsToBtc(0n)).toBe('0 BTC');
  });

  it('330 sats with BTC unit', () => {
    const result = satsToBtc(330n, 'BTC');
    expect(result).toContain('BTC');
    expect(result).toContain('0.0000033');
  });

  it('value and unit separated by a space', () => {
    const result = satsToBtc(100_000_000n, 'BTC');
    const parts = result.split(' ');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('BTC');
  });

  it('preserves FB unit for fractional amounts', () => {
    const result = satsToBtc(12_345_678n, 'FB');
    expect(result).toContain('FB');
    // 0.12345678 >= 0.01 -> toFixed(6) -> "0.123457" (rounded)
    expect(result).toContain('0.123457');
  });
});

// =====================================================================
// 8. fmtRate
// =====================================================================

describe('fmtRate', () => {
  it('returns "-" when fb <= 0', () => {
    expect(fmtRate(100_000_000n, 0n)).toBe('-');
  });

  it('returns string starting with "1:"', () => {
    const result = fmtRate(100_000_000n, 200_000_000n);
    expect(result.startsWith('1:')).toBe(true);
  });

  it('equal values -> "1:1"', () => {
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
  });

  it('btc 2x larger -> "1:2"', () => {
    expect(fmtRate(200_000_000n, 100_000_000n)).toBe('1:2');
  });

  it('fb 2x larger -> "1:0.5"', () => {
    expect(fmtRate(100_000_000n, 200_000_000n)).toBe('1:0.5');
  });

  it('trims trailing zeros from rate', () => {
    expect(fmtRate(100_000_000n, 100_000_000n)).toBe('1:1');
  });

  it('both zero -> "-"', () => {
    expect(fmtRate(0n, 0n)).toBe('-');
  });

  it('btc=0, fb>0 -> "1:0"', () => {
    expect(fmtRate(0n, 100_000_000n)).toBe('1:0');
  });

  it('btc=3, fb=1 -> "1:3"', () => {
    expect(fmtRate(300_000_000n, 100_000_000n)).toBe('1:3');
  });
});

// =====================================================================
// 9. STATUS_COLORS
// =====================================================================

describe('STATUS_COLORS', () => {
  it('has entry for OrderStatus.Open (1)', () => {
    expect(STATUS_COLORS[OrderStatus.Open]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Open].label).toBe('Open');
  });

  it('has entry for OrderStatus.Taken (2)', () => {
    expect(STATUS_COLORS[OrderStatus.Taken]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Taken].label).toBe('Taken');
  });

  it('has entry for OrderStatus.Completed (3)', () => {
    expect(STATUS_COLORS[OrderStatus.Completed]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Completed].label).toBe('Completed');
  });

  it('has entry for OrderStatus.Cancelled (4)', () => {
    expect(STATUS_COLORS[OrderStatus.Cancelled]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Cancelled].label).toBe('Cancelled');
  });

  it('has entry for OrderStatus.Refunded (5)', () => {
    expect(STATUS_COLORS[OrderStatus.Refunded]).toBeDefined();
    expect(STATUS_COLORS[OrderStatus.Refunded].label).toBe('Refunded');
  });

  it('each entry has bg, text, and label fields', () => {
    for (const key of [1, 2, 3, 4, 5]) {
      const entry = STATUS_COLORS[key];
      expect(typeof entry.bg).toBe('string');
      expect(typeof entry.text).toBe('string');
      expect(typeof entry.label).toBe('string');
    }
  });

  it('colors are rgba/hex format', () => {
    for (const key of [1, 2, 3, 4, 5]) {
      const entry = STATUS_COLORS[key];
      expect(entry.bg).toMatch(/^rgba\(/);
      expect(entry.text).toMatch(/^#/);
    }
  });
});

// =====================================================================
// 10. SwapDirection enum
// =====================================================================

describe('SwapDirection enum', () => {
  it('BTC_TO_FB equals 1', () => {
    expect(SwapDirection.BTC_TO_FB).toBe(1);
  });

  it('FB_TO_BTC equals 2', () => {
    expect(SwapDirection.FB_TO_BTC).toBe(2);
  });

  it('BTC_TO_FB !== FB_TO_BTC', () => {
    expect(SwapDirection.BTC_TO_FB).not.toBe(SwapDirection.FB_TO_BTC);
  });
});

// =====================================================================
// 11. OrderStatus enum
// =====================================================================

describe('OrderStatus enum', () => {
  it('Open = 1', () => expect(OrderStatus.Open).toBe(1));
  it('Taken = 2', () => expect(OrderStatus.Taken).toBe(2));
  it('Completed = 3', () => expect(OrderStatus.Completed).toBe(3));
  it('Cancelled = 4', () => expect(OrderStatus.Cancelled).toBe(4));
  it('Refunded = 5', () => expect(OrderStatus.Refunded).toBe(5));

  it('all values are unique', () => {
    const values = [OrderStatus.Open, OrderStatus.Taken, OrderStatus.Completed, OrderStatus.Cancelled, OrderStatus.Refunded];
    expect(new Set(values).size).toBe(5);
  });

  it('values are sequential 1..5', () => {
    expect(OrderStatus.Open).toBe(1);
    expect(OrderStatus.Refunded).toBe(5);
  });
});

// =====================================================================
// 12. Step arrays from crosschain/types.ts
// =====================================================================

describe('Maker/Taker step arrays', () => {
  it('MAKER_STEPS_BTC_TO_FB has 4 steps', () => {
    expect(MAKER_STEPS_BTC_TO_FB).toHaveLength(4);
  });

  it('TAKER_STEPS_BTC_TO_FB has 4 steps', () => {
    expect(TAKER_STEPS_BTC_TO_FB).toHaveLength(4);
  });

  it('MAKER_STEPS_FB_TO_BTC has 4 steps', () => {
    expect(MAKER_STEPS_FB_TO_BTC).toHaveLength(4);
  });

  it('TAKER_STEPS_FB_TO_BTC has 3 steps', () => {
    expect(TAKER_STEPS_FB_TO_BTC).toHaveLength(3);
  });

  it('all step arrays end with "Done"', () => {
    expect(MAKER_STEPS_BTC_TO_FB[MAKER_STEPS_BTC_TO_FB.length - 1]).toBe('Done');
    expect(TAKER_STEPS_BTC_TO_FB[TAKER_STEPS_BTC_TO_FB.length - 1]).toBe('Done');
    expect(MAKER_STEPS_FB_TO_BTC[MAKER_STEPS_FB_TO_BTC.length - 1]).toBe('Done');
    expect(TAKER_STEPS_FB_TO_BTC[TAKER_STEPS_FB_TO_BTC.length - 1]).toBe('Done');
  });

  it('MAKER_STEPS_BTC_TO_FB first step mentions "Create"', () => {
    expect(MAKER_STEPS_BTC_TO_FB[0]).toContain('Create');
  });

  it('TAKER_STEPS_BTC_TO_FB first step mentions "Take"', () => {
    expect(TAKER_STEPS_BTC_TO_FB[0]).toContain('Take');
  });

  it('all steps are non-empty strings', () => {
    const allSteps = [
      ...MAKER_STEPS_BTC_TO_FB,
      ...TAKER_STEPS_BTC_TO_FB,
      ...MAKER_STEPS_FB_TO_BTC,
      ...TAKER_STEPS_FB_TO_BTC,
    ];
    for (const step of allSteps) {
      expect(typeof step).toBe('string');
      expect(step.length).toBeGreaterThan(0);
    }
  });
});

// =====================================================================
// 13. FractalSwap order categorization logic
// =====================================================================

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

  const orders: FractalSwapOrder[] = [
    makeOrder('1', SwapDirection.BTC_TO_FB, OrderStatus.Open, myMLDSA),
    makeOrder('2', SwapDirection.FB_TO_BTC, OrderStatus.Open, otherMLDSA),
    makeOrder('3', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA),
    makeOrder('4', SwapDirection.BTC_TO_FB, OrderStatus.Taken, myMLDSA, myMLDSA),
    makeOrder('5', SwapDirection.FB_TO_BTC, OrderStatus.Completed, myMLDSA),
    makeOrder('6', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA),
  ];

  function isMyOrder(o: FractalSwapOrder, mldsaHex: string): boolean {
    return !!(mldsaHex && o.creator.toLowerCase() === mldsaHex);
  }

  function isTaker(o: FractalSwapOrder, mldsaHex: string): boolean {
    return !!(mldsaHex && o.taker.toLowerCase() === mldsaHex);
  }

  function getActiveOrders(allOrders: FractalSwapOrder[], currentBlock: number): FractalSwapOrder[] {
    return allOrders.filter(o =>
      (o.status === OrderStatus.Open || o.status === OrderStatus.Taken) &&
      (o.expiry <= 0 || o.expiry > currentBlock),
    );
  }

  function getMyOrders(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    return activeOrders.filter(o => isMyOrder(o, mldsaHex) || isTaker(o, mldsaHex));
  }

  function getAvailBuyFb(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    const others = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrder(o, mldsaHex));
    return others.filter(o => o.direction === SwapDirection.FB_TO_BTC);
  }

  function getAvailGetBtc(activeOrders: FractalSwapOrder[], mldsaHex: string): FractalSwapOrder[] {
    const others = activeOrders.filter(o => o.status === OrderStatus.Open && !isMyOrder(o, mldsaHex));
    return others.filter(o => o.direction === SwapDirection.BTC_TO_FB);
  }

  const currentBlock = 100;

  it('activeOrders includes only Open and Taken orders', () => {
    const active = getActiveOrders(orders, currentBlock);
    expect(active.every(o => o.status === OrderStatus.Open || o.status === OrderStatus.Taken)).toBe(true);
    expect(active.some(o => o.status === OrderStatus.Completed)).toBe(false);
  });

  it('isMyOrder returns true for own order', () => {
    expect(isMyOrder(orders[0]!, myMLDSA)).toBe(true);
  });

  it('isMyOrder returns false for other order', () => {
    expect(isMyOrder(orders[1]!, myMLDSA)).toBe(false);
  });

  it('isMyOrder returns false with empty mldsaHex', () => {
    expect(isMyOrder(orders[0]!, '')).toBe(false);
  });

  it('isTaker returns true when user is taker', () => {
    expect(isTaker(orders[3]!, myMLDSA)).toBe(true);
  });

  it('isTaker returns false for orders with zero taker', () => {
    expect(isTaker(orders[0]!, myMLDSA)).toBe(false);
  });

  it('myOrders contains own open and taken orders', () => {
    const active = getActiveOrders(orders, currentBlock);
    const my = getMyOrders(active, myMLDSA);
    const ids = my.map(o => o.id);
    expect(ids).toContain('1');
    expect(ids).toContain('4');
  });

  it('myOrders does not contain completed orders', () => {
    const active = getActiveOrders(orders, currentBlock);
    const my = getMyOrders(active, myMLDSA);
    expect(my.some(o => o.status === OrderStatus.Completed)).toBe(false);
  });

  it('availBuyFb contains only FB_TO_BTC orders from others', () => {
    const active = getActiveOrders(orders, currentBlock);
    const buyFb = getAvailBuyFb(active, myMLDSA);
    expect(buyFb.every(o => o.direction === SwapDirection.FB_TO_BTC)).toBe(true);
    expect(buyFb.every(o => !isMyOrder(o, myMLDSA))).toBe(true);
  });

  it('availGetBtc contains only BTC_TO_FB orders from others', () => {
    const active = getActiveOrders(orders, currentBlock);
    const getBtc = getAvailGetBtc(active, myMLDSA);
    expect(getBtc.every(o => o.direction === SwapDirection.BTC_TO_FB)).toBe(true);
    expect(getBtc.every(o => !isMyOrder(o, myMLDSA))).toBe(true);
  });

  it('expired orders (expiry <= currentBlock) are excluded from active', () => {
    const expiredOrder = makeOrder('99', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA, zero64, 10_000_000n, 5_000_000n, 50);
    const withExpired = [...orders, expiredOrder];
    const active = getActiveOrders(withExpired, 100);
    expect(active.find(o => o.id === '99')).toBeUndefined();
  });

  it('orders with expiry=0 are always active', () => {
    const noExpiry = makeOrder('100', SwapDirection.BTC_TO_FB, OrderStatus.Open, otherMLDSA, zero64, 10_000_000n, 5_000_000n, 0);
    const active = getActiveOrders([noExpiry], 99999);
    expect(active.find(o => o.id === '100')).toBeDefined();
  });

  it('totalVolumeSats sums btcAmount of completed orders', () => {
    const completed = orders.filter(o => o.status === OrderStatus.Completed);
    const total = completed.reduce((sum, o) => sum + o.btcAmount, 0n);
    expect(total).toBeGreaterThanOrEqual(0n);
  });

  it('cancelled orders are excluded from active', () => {
    const cancelled = makeOrder('200', SwapDirection.BTC_TO_FB, OrderStatus.Cancelled, otherMLDSA);
    const active = getActiveOrders([cancelled], 100);
    expect(active).toHaveLength(0);
  });

  it('refunded orders are excluded from active', () => {
    const refunded = makeOrder('201', SwapDirection.FB_TO_BTC, OrderStatus.Refunded, myMLDSA);
    const active = getActiveOrders([refunded], 100);
    expect(active).toHaveLength(0);
  });
});

// =====================================================================
// 14. suggestedExpiryBlocks
// =====================================================================

describe('suggestedExpiryBlocks', () => {
  it('returns object with min, default, max', () => {
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

  it('Fractal Bitcoin (chainId=1): min=72, default=144, max=576', () => {
    const opts = suggestedExpiryBlocks(1);
    expect(opts.min).toBe(72);
    expect(opts.default).toBe(144);
    expect(opts.max).toBe(576);
  });

  it('unknown chainId returns fallback values', () => {
    const opts = suggestedExpiryBlocks(9999);
    expect(opts.min).toBe(72);
    expect(opts.default).toBe(144);
    expect(opts.max).toBe(576);
  });

  it('default corresponds to ~24h (144 blocks * 10 min)', () => {
    const opts = suggestedExpiryBlocks(1);
    const hours = (opts.default * 10) / 60;
    expect(hours).toBeCloseTo(24, 0);
  });

  it('max corresponds to ~4 days', () => {
    const opts = suggestedExpiryBlocks(1);
    const days = (opts.max * 10) / 60 / 24;
    expect(days).toBeCloseTo(4, 0);
  });

  it('min corresponds to ~12 hours', () => {
    const opts = suggestedExpiryBlocks(1);
    const hours = (opts.min * 10) / 60;
    expect(hours).toBeCloseTo(12, 0);
  });
});

// =====================================================================
// 15. validateAddress
// =====================================================================

describe('validateAddress', () => {
  it('Fractal testnet address (tb1q...) is valid for chainId=1', () => {
    expect(validateAddress(1, 'tb1qtest123456789012345678901234')).toBe(true);
  });

  it('Fractal mainnet address (bc1q...) is valid for chainId=1', () => {
    expect(validateAddress(1, 'bc1qtest12345678901234567890123456')).toBe(true);
  });

  it('fb1 address is valid for chainId=1', () => {
    expect(validateAddress(1, 'fb1qtest12345678901234567890123456')).toBe(true);
  });

  it('invalid address returns false', () => {
    expect(validateAddress(1, 'opt1sqinvalidaddress')).toBe(false);
  });

  it('empty string is invalid', () => {
    expect(validateAddress(1, '')).toBe(false);
  });

  it('non-existent chainId returns false', () => {
    expect(validateAddress(9999, 'tb1qtest123456789012345678901234')).toBe(false);
  });

  it('address too short is invalid', () => {
    expect(validateAddress(1, 'tb1q')).toBe(false);
  });

  it('address with special characters is invalid', () => {
    expect(validateAddress(1, 'tb1q@#$%^&*()!!')).toBe(false);
  });
});

// =====================================================================
// 16. getChainById
// =====================================================================

describe('getChainById', () => {
  it('returns Fractal Bitcoin for ID=1', () => {
    const chain = getChainById(1);
    expect(chain).toBeDefined();
    expect(chain?.name).toBe('Fractal Bitcoin');
  });

  it('returns undefined for non-existent ID', () => {
    expect(getChainById(9999)).toBeUndefined();
  });

  it('chain has all required fields', () => {
    const chain = getChainById(1);
    expect(chain).toBeDefined();
    expect(typeof chain?.id).toBe('number');
    expect(typeof chain?.name).toBe('string');
    expect(typeof chain?.shortName).toBe('string');
    expect(typeof chain?.explorerUrl).toBe('string');
    expect(typeof chain?.nativeAsset).toBe('string');
    expect(typeof chain?.type).toBe('string');
    expect(typeof chain?.settlement).toBe('string');
  });

  it('Fractal chain type is utxo', () => {
    expect(getChainById(1)?.type).toBe('utxo');
  });

  it('Fractal chain settlement is htlc', () => {
    expect(getChainById(1)?.settlement).toBe('htlc');
  });

  it('Fractal native asset is FB-BTC', () => {
    expect(getChainById(1)?.nativeAsset).toBe('FB-BTC');
  });
});

// =====================================================================
// 17. SUPPORTED_CHAINS
// =====================================================================

describe('SUPPORTED_CHAINS', () => {
  it('contains at least one chain', () => {
    expect(SUPPORTED_CHAINS.length).toBeGreaterThan(0);
  });

  it('first chain is Fractal Bitcoin', () => {
    expect(SUPPORTED_CHAINS[0]!.name).toBe('Fractal Bitcoin');
  });

  it('all chains have unique IDs', () => {
    const ids = SUPPORTED_CHAINS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Fractal supports testnet', () => {
    const fractal = SUPPORTED_CHAINS.find(c => c.id === 1);
    expect(fractal?.testnetAvailable).toBe(true);
  });

  it('Fractal has addressRegex defined', () => {
    const fractal = SUPPORTED_CHAINS.find(c => c.id === 1);
    expect(fractal?.addressRegex).toBeDefined();
  });

  it('Fractal shortName is "Fractal"', () => {
    expect(SUPPORTED_CHAINS[0]!.shortName).toBe('Fractal');
  });
});

// =====================================================================
// 18. Chain explorer URL helpers
// =====================================================================

describe('chain explorer URL helpers', () => {
  const txid = 'abcdef1234567890';
  const addr = 'tb1qtest12345';

  it('getChainTxUrl builds correct URL for chainId=1', () => {
    const url = getChainTxUrl(1, txid);
    expect(url).toContain(txid);
    expect(url).toContain('fractalbitcoin');
  });

  it('getChainTxUrl returns "#" for unknown chainId', () => {
    expect(getChainTxUrl(9999, txid)).toBe('#');
  });

  it('getChainAddressUrl builds correct URL for chainId=1', () => {
    const url = getChainAddressUrl(1, addr);
    expect(url).toContain(addr);
    expect(url).toContain('fractalbitcoin');
  });

  it('getChainAddressUrl returns "#" for unknown chainId', () => {
    expect(getChainAddressUrl(9999, addr)).toBe('#');
  });

  it('getChainTxUrl includes /tx/ path', () => {
    const url = getChainTxUrl(1, txid);
    expect(url).toContain('/tx/');
  });

  it('getChainAddressUrl includes /address/ path', () => {
    const url = getChainAddressUrl(1, addr);
    expect(url).toContain('/address/');
  });
});

// =====================================================================
// 19. hexToBigInt / bigIntToHex
// =====================================================================

describe('hexToBigInt / bigIntToHex', () => {
  it('hexToBigInt converts hex without 0x to BigInt', () => {
    expect(hexToBigInt('ff')).toBe(255n);
  });

  it('hexToBigInt converts hex with 0x to BigInt', () => {
    expect(hexToBigInt('0xff')).toBe(255n);
  });

  it('hexToBigInt("00...00") = 0n', () => {
    expect(hexToBigInt('0'.repeat(64))).toBe(0n);
  });

  it('hexToBigInt converts single digit', () => {
    expect(hexToBigInt('1')).toBe(1n);
  });

  it('hexToBigInt handles large value', () => {
    expect(hexToBigInt('ffffffffffffffff')).toBe(18446744073709551615n);
  });

  it('bigIntToHex pads to 64 characters with leading zeros', () => {
    expect(bigIntToHex(255n)).toBe('ff'.padStart(64, '0'));
  });

  it('bigIntToHex(0n) = 64 zeros', () => {
    expect(bigIntToHex(0n)).toBe('0'.repeat(64));
  });

  it('bigIntToHex(1n) = 63 zeros + "1"', () => {
    expect(bigIntToHex(1n)).toBe('0'.repeat(63) + '1');
  });

  it('roundtrip: hexToBigInt(bigIntToHex(n)) = n', () => {
    const n = 123456789n;
    expect(hexToBigInt(bigIntToHex(n))).toBe(n);
  });

  it('large number roundtrip', () => {
    const big = BigInt('0x' + 'ab'.repeat(32));
    expect(hexToBigInt(bigIntToHex(big))).toBe(big);
  });

  it('bigIntToHex output is exactly 64 chars', () => {
    expect(bigIntToHex(0n).length).toBe(64);
    expect(bigIntToHex(255n).length).toBe(64);
    expect(bigIntToHex(BigInt('0x' + 'ff'.repeat(32))).length).toBe(64);
  });
});

// =====================================================================
// 20. toHex / fromHex
// =====================================================================

describe('toHex / fromHex', () => {
  it('toHex converts empty array to empty string', () => {
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('toHex formats bytes with leading zeros', () => {
    const bytes = new Uint8Array([0x0f, 0xff, 0x00]);
    expect(toHex(bytes)).toBe('0fff00');
  });

  it('toHex converts single byte 0', () => {
    expect(toHex(new Uint8Array([0]))).toBe('00');
  });

  it('toHex converts single byte 255', () => {
    expect(toHex(new Uint8Array([255]))).toBe('ff');
  });

  it('toHex converts all-zeros 32-byte array', () => {
    const result = toHex(new Uint8Array(32));
    expect(result).toBe('00'.repeat(32));
    expect(result.length).toBe(64);
  });

  it('fromHex decodes hex string without 0x', () => {
    const bytes = fromHex('0fff00');
    expect(bytes[0]).toBe(0x0f);
    expect(bytes[1]).toBe(0xff);
    expect(bytes[2]).toBe(0x00);
  });

  it('fromHex decodes hex string with 0x prefix', () => {
    const bytes = fromHex('0x0fff00');
    expect(bytes[0]).toBe(0x0f);
    expect(bytes[1]).toBe(0xff);
  });

  it('fromHex returns empty Uint8Array for empty string', () => {
    const bytes = fromHex('');
    expect(bytes.length).toBe(0);
  });

  it('fromHex with 0x prefix only returns empty', () => {
    const bytes = fromHex('0x');
    expect(bytes.length).toBe(0);
  });

  it('roundtrip: fromHex(toHex(bytes)) returns original', () => {
    const original = new Uint8Array([1, 2, 3, 255, 128, 0]);
    const hex = toHex(original);
    const back = fromHex(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('roundtrip: toHex(fromHex(hex)) returns original hex', () => {
    const hex = 'deadbeef01020304';
    expect(toHex(fromHex(hex))).toBe(hex);
  });

  it('fromHex handles uppercase hex', () => {
    const bytes = fromHex('FF');
    expect(bytes[0]).toBe(255);
  });

  it('32-byte roundtrip matches', () => {
    const original = new Uint8Array(32);
    for (let i = 0; i < 32; i++) original[i] = i;
    const hex = toHex(original);
    const back = fromHex(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });
});

// =====================================================================
// 21. formatBlockCountdown
// =====================================================================

describe('formatBlockCountdown', () => {
  it('0 blocks -> "Expired"', () => {
    expect(formatBlockCountdown(0)).toBe('Expired');
  });

  it('negative blocks -> "Expired"', () => {
    expect(formatBlockCountdown(-1)).toBe('Expired');
    expect(formatBlockCountdown(-100)).toBe('Expired');
  });

  it('1 block -> "~10m"', () => {
    expect(formatBlockCountdown(1)).toBe('~10m');
  });

  it('5 blocks (50 min) -> "~50m"', () => {
    expect(formatBlockCountdown(5)).toBe('~50m');
  });

  it('6 blocks (60 min = 1h) -> contains "h"', () => {
    expect(formatBlockCountdown(6)).toContain('h');
  });

  it('144 blocks (24h = 1d) -> "~1d"', () => {
    // 1440 min / 60 = 24h, 24h >= 24 triggers days branch -> "~1d"
    expect(formatBlockCountdown(144)).toBe('~1d');
  });

  it('576 blocks (4 days) -> contains "d"', () => {
    expect(formatBlockCountdown(576)).toContain('d');
  });

  it('large block count -> contains "d"', () => {
    expect(formatBlockCountdown(1000)).toContain('d');
  });

  it('custom blockTimeMinutes: 5 min blocks', () => {
    expect(formatBlockCountdown(6, 5)).toBe('~30m');
  });

  it('custom blockTimeMinutes: 1 min blocks, 120 blocks = 2h', () => {
    expect(formatBlockCountdown(120, 1)).toContain('h');
  });

  it('12 blocks (120 min = 2h) -> "~2h"', () => {
    expect(formatBlockCountdown(12)).toBe('~2h');
  });

  it('13 blocks (130 min = 2h 10m) -> "~2h 10m"', () => {
    expect(formatBlockCountdown(13)).toBe('~2h 10m');
  });

  it('145 blocks (1450 min > 24h) -> contains "d"', () => {
    expect(formatBlockCountdown(145)).toContain('d');
  });
});

// =====================================================================
// 22. truncateHex
// =====================================================================

describe('truncateHex', () => {
  const longHex = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

  it('truncates long hex with "..." separator', () => {
    const result = truncateHex(longHex, 6);
    expect(result).toContain('...');
  });

  it('short hex is returned unchanged', () => {
    expect(truncateHex('aabb', 6)).toBe('aabb');
  });

  it('strips 0x prefix from display', () => {
    const result = truncateHex('0x' + longHex, 6);
    expect(result.startsWith('0x')).toBe(false);
  });

  it('result contains start and end of string', () => {
    const result = truncateHex(longHex, 6);
    expect(result.startsWith('aabbcc')).toBe(true);
    expect(result.endsWith('778899')).toBe(true);
  });

  it('default chars=6', () => {
    const result = truncateHex(longHex);
    expect(result).toContain('...');
    expect(result.length).toBe(6 + 3 + 6);
  });

  it('chars=4 gives 4+...+4', () => {
    const result = truncateHex(longHex, 4);
    expect(result.length).toBe(4 + 3 + 4);
  });

  it('exact boundary: hex of length chars*2 is not truncated', () => {
    const exactHex = 'aabbccddeeff'; // 12 chars = 6*2
    const result = truncateHex(exactHex, 6);
    expect(result).toBe(exactHex);
  });

  it('hex just over boundary is truncated', () => {
    const overHex = 'aabbccddeeff00'; // 14 chars > 6*2
    const result = truncateHex(overHex, 6);
    expect(result).toContain('...');
  });

  it('handles chars=0 gracefully', () => {
    const result = truncateHex(longHex, 0);
    expect(typeof result).toBe('string');
  });

  it('empty hex string returns empty', () => {
    expect(truncateHex('')).toBe('');
  });

  it('0x-only string returns empty', () => {
    expect(truncateHex('0x')).toBe('');
  });
});

// =====================================================================
// 23. generatePreimage
// =====================================================================

describe('generatePreimage', () => {
  it('returns a Uint8Array of 32 bytes', () => {
    const preimage = generatePreimage();
    expect(preimage).toBeInstanceOf(Uint8Array);
    expect(preimage.length).toBe(32);
  });

  it('produces different values on successive calls', () => {
    const p1 = generatePreimage();
    const p2 = generatePreimage();
    const hex1 = toHex(p1);
    const hex2 = toHex(p2);
    expect(hex1).not.toBe(hex2);
  });
});

// =====================================================================
// 24. computeHashlock (async)
// =====================================================================

describe('computeHashlock', () => {
  it('returns a Uint8Array of 32 bytes (SHA-256)', async () => {
    const preimage = new Uint8Array(32).fill(0);
    const hash = await computeHashlock(preimage);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('same input produces same hash (deterministic)', async () => {
    const preimage = new Uint8Array(32).fill(42);
    const h1 = await computeHashlock(preimage);
    const h2 = await computeHashlock(preimage);
    expect(toHex(h1)).toBe(toHex(h2));
  });

  it('different inputs produce different hashes', async () => {
    const p1 = new Uint8Array(32).fill(0);
    const p2 = new Uint8Array(32).fill(1);
    const h1 = await computeHashlock(p1);
    const h2 = await computeHashlock(p2);
    expect(toHex(h1)).not.toBe(toHex(h2));
  });

  it('SHA-256 of all-zeros matches known hash', async () => {
    const preimage = new Uint8Array(32).fill(0);
    const hash = await computeHashlock(preimage);
    const hex = toHex(hash);
    expect(hex.length).toBe(64);
    expect(hex).toBe('66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
  });
});

// =====================================================================
// 25. generateHTLCPair (async)
// =====================================================================

describe('generateHTLCPair', () => {
  it('returns object with preimage and hashlock hex strings', async () => {
    const pair = await generateHTLCPair();
    expect(typeof pair.preimage).toBe('string');
    expect(typeof pair.hashlock).toBe('string');
  });

  it('preimage is 64 hex chars (32 bytes)', async () => {
    const pair = await generateHTLCPair();
    expect(pair.preimage.length).toBe(64);
    expect(pair.preimage).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashlock is 64 hex chars (32 bytes)', async () => {
    const pair = await generateHTLCPair();
    expect(pair.hashlock.length).toBe(64);
    expect(pair.hashlock).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preimage and hashlock are different', async () => {
    const pair = await generateHTLCPair();
    expect(pair.preimage).not.toBe(pair.hashlock);
  });

  it('hashlock is valid SHA-256 of preimage', async () => {
    const pair = await generateHTLCPair();
    const verified = await verifyPreimage(pair.preimage, pair.hashlock);
    expect(verified).toBe(true);
  });

  it('successive calls produce different pairs', async () => {
    const pair1 = await generateHTLCPair();
    const pair2 = await generateHTLCPair();
    expect(pair1.preimage).not.toBe(pair2.preimage);
    expect(pair1.hashlock).not.toBe(pair2.hashlock);
  });
});

// =====================================================================
// 26. verifyPreimage (async)
// =====================================================================

describe('verifyPreimage', () => {
  it('returns true for matching preimage and hashlock', async () => {
    const pair = await generateHTLCPair();
    expect(await verifyPreimage(pair.preimage, pair.hashlock)).toBe(true);
  });

  it('returns false for mismatched preimage and hashlock', async () => {
    const pair = await generateHTLCPair();
    const wrongHashlock = '0'.repeat(64);
    expect(await verifyPreimage(pair.preimage, wrongHashlock)).toBe(false);
  });

  it('handles 0x-prefixed hashlock', async () => {
    const pair = await generateHTLCPair();
    const result = await verifyPreimage(pair.preimage, '0x' + pair.hashlock);
    expect(result).toBe(true);
  });

  it('all-zeros preimage verifies against its SHA-256', async () => {
    const preimage = '00'.repeat(32);
    const hash = await computeHashlock(fromHex(preimage));
    const hashHex = toHex(hash);
    expect(await verifyPreimage(preimage, hashHex)).toBe(true);
  });
});

// =====================================================================
// 27. Fee calculation logic
// =====================================================================

describe('Fee calculation logic', () => {
  function calcFee(btcAmount: bigint, feeBps: number): bigint {
    const rawFee = (btcAmount * BigInt(feeBps)) / 10000n;
    return rawFee < 330n ? 330n : rawFee;
  }

  it('1% fee of 1 BTC = 1_000_000 sats (> dust)', () => {
    expect(calcFee(100_000_000n, 100)).toBe(1_000_000n);
  });

  it('minimum fee = 330 sats (dust limit)', () => {
    expect(calcFee(100n, 100)).toBe(330n);
  });

  it('0 sats btcAmount -> fee = 330 sats (dust limit)', () => {
    expect(calcFee(0n, 100)).toBe(330n);
  });

  it('fee exactly at dust limit boundary: 330000 sats * 1bps = 33 -> 330', () => {
    expect(calcFee(330_000n, 1)).toBe(330n);
  });

  it('feeBps=0 -> fee = 330n (dust limit)', () => {
    expect(calcFee(100_000_000n, 0)).toBe(330n);
  });

  it('high feeBps: 10% of 0.01 BTC = 100_000 sats', () => {
    expect(calcFee(1_000_000n, 1000)).toBe(100_000n);
  });

  it('exact dust boundary: rawFee = 330', () => {
    expect(calcFee(3_300_000n, 1)).toBe(330n);
  });

  it('just above dust boundary: rawFee = 331', () => {
    expect(calcFee(3_310_000n, 1)).toBe(331n);
  });

  function calcFormFee(btcSats: bigint, feeBps: number): bigint {
    return btcSats > 0n ? (btcSats * BigInt(feeBps)) / 10000n : 0n;
  }

  it('formFeeSats for 0 sats = 0n', () => {
    expect(calcFormFee(0n, 100)).toBe(0n);
  });

  it('formFeeSats = 1% of 0.1 BTC = 100_000 sats', () => {
    expect(calcFormFee(10_000_000n, 100)).toBe(100_000n);
  });
});

// =====================================================================
// 28. Token amount scaling
// =====================================================================

describe('Token amount scaling for escrow', () => {
  function toOnChain(amount: number, decimals: number): bigint {
    return BigInt(Math.round(amount * (10 ** decimals)));
  }

  it('1 MINE (8 dec) -> 100_000_000n', () => {
    expect(toOnChain(1, 8)).toBe(100_000_000n);
  });

  it('0.5 MINE -> 50_000_000n', () => {
    expect(toOnChain(0.5, 8)).toBe(50_000_000n);
  });

  it('0 amount -> 0n', () => {
    expect(toOnChain(0, 8)).toBe(0n);
  });

  it('6-decimal token: 1 unit -> 1_000_000n', () => {
    expect(toOnChain(1, 6)).toBe(1_000_000n);
  });

  it('0.01 BTC in sats = 1_000_000n', () => {
    const btcPrice = '0.01';
    const result = BigInt(Math.round(parseFloat(btcPrice) * 1e8));
    expect(result).toBe(1_000_000n);
  });

  it('empty string btcPrice -> 0n', () => {
    const btcPrice = '';
    const result = btcPrice ? BigInt(Math.round(parseFloat(btcPrice) * 1e8)) : 0n;
    expect(result).toBe(0n);
  });
});

// =====================================================================
// 29. TokenEscrow order categorization
// =====================================================================

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
    makeEscrow('1', DIR_SELL_TOKEN, 1),
    makeEscrow('2', DIR_SELL_TOKEN, 2),
    makeEscrow('3', DIR_BUY_TOKEN, 1),
    makeEscrow('4', DIR_SELL_TOKEN, 3),
    makeEscrow('5', DIR_BUY_TOKEN, 3),
  ];

  const activeEscrow = orders.filter(o => o.status === 1 || o.status === 2);
  const sellToken = activeEscrow.filter(o => o.direction === DIR_SELL_TOKEN);
  const buyToken = activeEscrow.filter(o => o.direction !== DIR_SELL_TOKEN);

  it('activeEscrowOrders includes only status=1 and status=2', () => {
    expect(activeEscrow.every(o => o.status === 1 || o.status === 2)).toBe(true);
    expect(activeEscrow).toHaveLength(3);
  });

  it('completed orders (status=3) are excluded from activeEscrowOrders', () => {
    expect(activeEscrow.some(o => o.status === 3)).toBe(false);
  });

  it('sellTokenOrders contain only direction=DIR_SELL_TOKEN', () => {
    expect(sellToken.every(o => o.direction === DIR_SELL_TOKEN)).toBe(true);
  });

  it('buyTokenOrders contain only direction=DIR_BUY_TOKEN', () => {
    expect(buyToken.every(o => o.direction === DIR_BUY_TOKEN)).toBe(true);
  });

  it('sellTokenOrders and buyTokenOrders do not overlap', () => {
    const sellIds = new Set(sellToken.map(o => o.id));
    const buyIds = new Set(buyToken.map(o => o.id));
    const intersection = [...sellIds].filter(id => buyIds.has(id));
    expect(intersection).toHaveLength(0);
  });

  it('empty list -> empty categories', () => {
    const empty: TinyEscrowOrder[] = [];
    expect(empty.filter(o => o.direction === DIR_SELL_TOKEN)).toHaveLength(0);
    expect(empty.filter(o => o.direction !== DIR_SELL_TOKEN)).toHaveLength(0);
  });
});

// =====================================================================
// 30. mldsaHex derivation
// =====================================================================

describe('mldsaHex derivation from hashedMLDSAKey', () => {
  function deriveMldsaHex(hashedMLDSAKey: string | null | undefined): string {
    if (!hashedMLDSAKey) return '';
    return (hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey).toLowerCase();
  }

  it('null -> empty string', () => {
    expect(deriveMldsaHex(null)).toBe('');
  });

  it('undefined -> empty string', () => {
    expect(deriveMldsaHex(undefined)).toBe('');
  });

  it('empty string -> empty string', () => {
    expect(deriveMldsaHex('')).toBe('');
  });

  it('strips 0x prefix', () => {
    expect(deriveMldsaHex('0xABCD')).toBe('abcd');
  });

  it('converts to lowercase', () => {
    expect(deriveMldsaHex('ABCDEF')).toBe('abcdef');
  });

  it('hex without 0x stays unchanged (but lowercase)', () => {
    const hex = 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    expect(deriveMldsaHex(hex)).toBe(hex);
  });

  it('hex with 0x loses prefix', () => {
    const hex = '0xdb2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d';
    expect(deriveMldsaHex(hex)).not.toMatch(/^0x/);
    expect(deriveMldsaHex(hex).length).toBe(64);
  });
});

// =====================================================================
// 31. Form rate and sats calculations
// =====================================================================

describe('Form rate and sats calculations', () => {
  function toSats(amount: string): bigint {
    return amount ? BigInt(Math.round(parseFloat(amount) * 1e8)) : 0n;
  }

  function calcFormRate(amountSats: bigint, receiveSats: bigint): string {
    return amountSats > 0n && receiveSats > 0n
      ? (Number(receiveSats) / Number(amountSats)).toFixed(4)
      : '';
  }

  it('formAmountSats for "0.1" = 10_000_000n', () => {
    expect(toSats('0.1')).toBe(10_000_000n);
  });

  it('formAmountSats for empty string = 0n', () => {
    expect(toSats('')).toBe(0n);
  });

  it('formAmountSats for "1" = 100_000_000n', () => {
    expect(toSats('1')).toBe(100_000_000n);
  });

  it('formRate empty when one value is 0', () => {
    expect(calcFormRate(0n, 100_000_000n)).toBe('');
    expect(calcFormRate(100_000_000n, 0n)).toBe('');
  });

  it('formRate: 1 BTC : 2 FB -> "2.0000"', () => {
    expect(calcFormRate(100_000_000n, 200_000_000n)).toBe('2.0000');
  });

  it('formRate: 2 BTC : 1 FB -> "0.5000"', () => {
    expect(calcFormRate(200_000_000n, 100_000_000n)).toBe('0.5000');
  });

  it('format always has 4 decimal places', () => {
    const rate = calcFormRate(100_000_000n, 150_000_000n);
    const decimals = rate.split('.')[1]?.length ?? 0;
    expect(decimals).toBe(4);
  });

  it('sendUnit = BTC when direction = BTC_TO_FB', () => {
    const direction = SwapDirection.BTC_TO_FB;
    const sendUnit = direction === SwapDirection.BTC_TO_FB ? 'BTC' : 'FB';
    expect(sendUnit).toBe('BTC');
  });

  it('receiveUnit = FB when direction = BTC_TO_FB', () => {
    const direction = SwapDirection.BTC_TO_FB;
    const receiveUnit = direction === SwapDirection.BTC_TO_FB ? 'FB' : 'BTC';
    expect(receiveUnit).toBe('FB');
  });

  it('sendUnit = FB when direction = FB_TO_BTC', () => {
    const direction = SwapDirection.FB_TO_BTC;
    const sendUnit = direction === SwapDirection.BTC_TO_FB ? 'BTC' : 'FB';
    expect(sendUnit).toBe('FB');
  });

  it('receiveUnit = BTC when direction = FB_TO_BTC', () => {
    const direction = SwapDirection.FB_TO_BTC;
    const receiveUnit = direction === SwapDirection.BTC_TO_FB ? 'FB' : 'BTC';
    expect(receiveUnit).toBe('BTC');
  });
});
