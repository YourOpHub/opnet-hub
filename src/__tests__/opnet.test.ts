/**
 * opnet.test.ts — Tests for src/opnet.ts pure functions and RPC wrapper logic.
 *
 * Covers: formatSats, parseHexNumber, slotToPointer, base64ToHex, parseCallResult,
 *         decodeStorageVal, OP20_SLOTS, setNetwork, getNetwork, getRpcUrl,
 *         rpc retry/rate-limit logic, getBlockHeight, getBalance, callContract, etc.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to suppress warnings
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock config — needs to be before import
vi.mock('../config', () => ({
  CURRENT_ENV: 'testnet' as const,
}));

// Mock contracts (needed by getStorageAt)
vi.mock('../contracts', () => ({
  addressToPubkey: (addr: string) => addr.startsWith('opt1') ? '0xdeadbeef' : addr,
}));

// We need to access private functions so we'll test them via the public API
// and also re-implement some for unit-level testing
import {
  formatSats,
  setNetwork,
  getNetwork,
  getRpcUrl,
  OP20_SLOTS,
  getBlockHeight,
  getBalance,
  callContract,
  getCode,
  getGasParameters,
  getLatestEpoch,
  getMempoolInfo,
  getUTXOs,
  getTransaction,
  getTransactionReceipt,
  getLatestPendingTxs,
  getBlockByNumber,
  getPublicKeyInfo,
  getTokenBalance,
  // getTokenTotalSupply,
  // getOP20Info,
} from '../opnet';

// ─── formatSats ───
describe('formatSats', () => {
  it('formats values >= 1 BTC correctly', () => {
    expect(formatSats(100_000_000)).toBe('1.0000 BTC');
    expect(formatSats(250_000_000)).toBe('2.5000 BTC');
    expect(formatSats(1_000_000_000)).toBe('10.0000 BTC');
  });

  it('formats values >= 1M sats correctly', () => {
    expect(formatSats(1_000_000)).toBe('1.00M sats');
    expect(formatSats(5_500_000)).toBe('5.50M sats');
    expect(formatSats(99_999_999)).toBe('100.00M sats');
  });

  it('formats values >= 1K sats correctly', () => {
    expect(formatSats(1_000)).toBe('1.0K sats');
    expect(formatSats(50_000)).toBe('50.0K sats');
    expect(formatSats(999_999)).toBe('1000.0K sats');
  });

  it('formats values < 1K sats correctly', () => {
    expect(formatSats(0)).toBe('0 sats');
    expect(formatSats(1)).toBe('1 sats');
    expect(formatSats(500)).toBe('500 sats');
    expect(formatSats(999)).toBe('999 sats');
  });

  it('handles bigint inputs', () => {
    expect(formatSats(100_000_000n)).toBe('1.0000 BTC');
    expect(formatSats(500n)).toBe('500 sats');
    expect(formatSats(0n)).toBe('0 sats');
  });

  it('floors fractional sats for small values', () => {
    expect(formatSats(0.9)).toBe('0 sats');
    expect(formatSats(1.7)).toBe('1 sats');
  });
});

// ─── OP20_SLOTS ───
describe('OP20_SLOTS', () => {
  it('has the correct slot indices', () => {
    expect(OP20_SLOTS.NAME).toBe(0);
    expect(OP20_SLOTS.SYMBOL).toBe(1);
    expect(OP20_SLOTS.DECIMALS).toBe(2);
    expect(OP20_SLOTS.TOTAL_SUPPLY).toBe(3);
    expect(OP20_SLOTS.BALANCES).toBe(4);
  });
});

// ─── setNetwork / getNetwork / getRpcUrl ───
describe('network management', () => {
  afterEach(() => {
    setNetwork('testnet'); // reset
  });

  it('defaults to testnet', () => {
    expect(getNetwork()).toBe('testnet');
  });

  it('setNetwork changes current network', () => {
    setNetwork('mainnet');
    expect(getNetwork()).toBe('mainnet');
    setNetwork('regtest');
    expect(getNetwork()).toBe('regtest');
  });

  it('getRpcUrl returns correct URL for testnet', () => {
    setNetwork('testnet');
    expect(getRpcUrl()).toBe('https://testnet.opnet.org/api/v1/json-rpc');
  });

  it('getRpcUrl returns correct URL for mainnet', () => {
    setNetwork('mainnet');
    expect(getRpcUrl()).toBe('https://mainnet.opnet.org/api/v1/json-rpc');
  });

  it('getRpcUrl returns correct URL for regtest', () => {
    setNetwork('regtest');
    expect(getRpcUrl()).toBe('https://regtest.opnet.org/api/v1/json-rpc');
  });
});

// ─── RPC functions with mocked fetch ───
describe('RPC wrapper functions', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    setNetwork('testnet');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setNetwork('testnet');
  });

  function mockJsonRpcResponse(result: unknown) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ jsonrpc: '2.0', result, id: 1 }),
    });
  }

  function mockJsonRpcError(message: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ jsonrpc: '2.0', error: { message }, id: 1 }),
    });
  }

  // ─── getBlockHeight ───
  describe('getBlockHeight', () => {
    it('parses hex block height from RPC', async () => {
      mockJsonRpcResponse('0x81b');
      const height = await getBlockHeight();
      expect(height).toBe(2075);
    });

    it('parses integer block height', async () => {
      mockJsonRpcResponse(1000);
      const height = await getBlockHeight();
      expect(height).toBe(1000);
    });

    it('returns 0 for non-numeric response', async () => {
      mockJsonRpcResponse(null);
      const height = await getBlockHeight();
      expect(height).toBe(0);
    });

    it('parses decimal string', async () => {
      mockJsonRpcResponse('500');
      const height = await getBlockHeight();
      expect(height).toBe(500);
    });
  });

  // ─── getBalance ───
  describe('getBalance', () => {
    it('parses hex balance string', async () => {
      mockJsonRpcResponse('0x3e8'); // 1000
      const balance = await getBalance('opt1test');
      expect(balance).toBe(1000n);
    });

    it('parses hex balance without 0x prefix', async () => {
      mockJsonRpcResponse('3e8');
      const balance = await getBalance('opt1test');
      expect(balance).toBe(1000n);
    });

    it('returns 0n for non-string result', async () => {
      mockJsonRpcResponse(null);
      const balance = await getBalance('opt1test');
      expect(balance).toBe(0n);
    });

    it('returns 0n for invalid hex', async () => {
      mockJsonRpcResponse('not_hex');
      const balance = await getBalance('opt1test');
      expect(balance).toBe(0n);
    });

    it('returns 0n for number result', async () => {
      mockJsonRpcResponse(1000);
      const balance = await getBalance('opt1test');
      expect(balance).toBe(0n);
    });
  });

  // ─── getCode ───
  describe('getCode', () => {
    it('returns contract code object when bytecode present', async () => {
      mockJsonRpcResponse({ bytecode: '0xdeadbeef', contractAddress: 'opt1abc' });
      const code = await getCode('opt1abc');
      expect(code).toEqual({ bytecode: '0xdeadbeef', contractAddress: 'opt1abc' });
    });

    it('returns null for empty response', async () => {
      mockJsonRpcResponse({});
      const code = await getCode('opt1abc');
      expect(code).toBeNull();
    });

    it('returns null on RPC error', async () => {
      mockJsonRpcError('not found');
      const code = await getCode('opt1abc');
      expect(code).toBeNull();
    });
  });

  // ─── getGasParameters ───
  describe('getGasParameters', () => {
    it('returns gas parameters object', async () => {
      const gas = { blockNumber: '0x100', baseGas: '100', gasPerSat: '5', bitcoin: { conservative: '10' } };
      mockJsonRpcResponse(gas);
      const result = await getGasParameters();
      expect(result).toEqual(gas);
    });

    it('returns null on error', async () => {
      mockJsonRpcError('fail');
      const result = await getGasParameters();
      expect(result).toBeNull();
    });
  });

  // ─── getLatestEpoch ───
  describe('getLatestEpoch', () => {
    it('returns epoch object', async () => {
      const epoch = { number: 42, hash: '0xabc' };
      mockJsonRpcResponse(epoch);
      const result = await getLatestEpoch();
      expect(result).toEqual(epoch);
    });

    it('returns null on error', async () => {
      mockJsonRpcError('fail');
      const result = await getLatestEpoch();
      expect(result).toBeNull();
    });
  });

  // ─── getMempoolInfo ───
  describe('getMempoolInfo', () => {
    it('returns mempool stats', async () => {
      const info = { count: 10, opnetCount: 3, sizeBytes: 2048 };
      mockJsonRpcResponse(info);
      const result = await getMempoolInfo();
      expect(result).toEqual(info);
    });

    it('returns null on error', async () => {
      mockJsonRpcError('fail');
      const result = await getMempoolInfo();
      expect(result).toBeNull();
    });
  });

  // ─── getUTXOs ───
  describe('getUTXOs', () => {
    it('parses array result', async () => {
      const utxos = [{ transactionId: '0xabc', outputIndex: 0, value: 5000 }];
      mockJsonRpcResponse(utxos);
      const result = await getUTXOs('opt1addr');
      expect(result).toEqual(utxos);
    });

    it('parses { confirmed: [...] } result', async () => {
      const utxos = [{ transactionId: '0xdef', outputIndex: 1, value: 3000 }];
      mockJsonRpcResponse({ confirmed: utxos });
      const result = await getUTXOs('opt1addr');
      expect(result).toEqual(utxos);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network fail'));
      mockFetch.mockRejectedValueOnce(new Error('network fail'));
      mockFetch.mockRejectedValueOnce(new Error('network fail'));
      const result = await getUTXOs('opt1addr');
      expect(result).toEqual([]);
    });
  });

  // ─── getTransaction ───
  describe('getTransaction', () => {
    it('returns transaction from first attempt', async () => {
      const tx = { hash: '0xabc', status: 'confirmed' };
      mockJsonRpcResponse(tx);
      const result = await getTransaction('0xabc');
      expect(result).toEqual(tx);
    });

    it('tries with 0x prefix when hash has no prefix', async () => {
      mockJsonRpcError('not found');
      // retry 1
      mockJsonRpcError('not found');
      // retry 2
      mockJsonRpcError('not found');
      // Now try with 0x prefix
      const tx = { hash: '0xabc', status: 'confirmed' };
      mockJsonRpcResponse(tx);
      const result = await getTransaction('abc');
      expect(result).toEqual(tx);
    });

    it('returns null when all attempts fail', async () => {
      // first attempt (as-is): 3 retries
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      // second attempt (0x prefix): 3 retries
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      const result = await getTransaction('abc');
      expect(result).toBeNull();
    });
  });

  // ─── getTransactionReceipt ───
  describe('getTransactionReceipt', () => {
    it('returns receipt on success', async () => {
      const receipt = { hash: '0xabc', status: 'success' };
      mockJsonRpcResponse(receipt);
      const result = await getTransactionReceipt('0xabc');
      expect(result).toEqual(receipt);
    });

    it('returns null on RPC error', async () => {
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      mockJsonRpcError('not found');
      const result = await getTransactionReceipt('0xabc');
      expect(result).toBeNull();
    });
  });

  // ─── getLatestPendingTxs ───
  describe('getLatestPendingTxs', () => {
    it('returns array of pending txs', async () => {
      const txs = [{ hash: '0x1' }, { hash: '0x2' }];
      mockJsonRpcResponse(txs);
      const result = await getLatestPendingTxs(2);
      expect(result).toEqual(txs);
    });

    it('returns empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await getLatestPendingTxs();
      expect(result).toEqual([]);
    });

    it('returns empty array for non-array result', async () => {
      mockJsonRpcResponse({ something: 'not array' });
      const result = await getLatestPendingTxs();
      expect(result).toEqual([]);
    });
  });

  // ─── getBlockByNumber ───
  describe('getBlockByNumber', () => {
    it('formats block number as hex', async () => {
      const block = { number: '0x100', transactions: [] };
      mockJsonRpcResponse(block);
      const result = await getBlockByNumber(256);
      expect(result).toEqual(block);
      // Verify the RPC was called with hex formatted number
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
      expect(body.params[0]).toBe('0x100');
    });

    it('passes string block number as-is', async () => {
      const block = { number: '0x100', transactions: [] };
      mockJsonRpcResponse(block);
      await getBlockByNumber('latest');
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
      expect(body.params[0]).toBe('latest');
    });

    it('returns null on error', async () => {
      mockJsonRpcError('fail');
      mockJsonRpcError('fail');
      mockJsonRpcError('fail');
      const result = await getBlockByNumber(100);
      expect(result).toBeNull();
    });
  });

  // ─── getPublicKeyInfo ───
  describe('getPublicKeyInfo', () => {
    it('returns pubkey info on success', async () => {
      const info = { 'opt1abc': { mldsa: '0x123', tweaked: '0x456' } };
      mockJsonRpcResponse(info);
      const result = await getPublicKeyInfo(['opt1abc']);
      expect(result).toEqual(info);
    });

    it('returns null on error', async () => {
      mockJsonRpcError('fail');
      mockJsonRpcError('fail');
      mockJsonRpcError('fail');
      const result = await getPublicKeyInfo(['opt1abc']);
      expect(result).toBeNull();
    });
  });

  // ─── callContract ───
  describe('callContract', () => {
    it('strips leading 0x prefix from combined calldata', async () => {
      mockJsonRpcResponse({ result: btoa('\x00\x01\x02') });
      // callContract concatenates selector + body, then strips leading 0x
      await callContract('opt1abc', '0x12345678', 'deadbeef');
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
      expect(body.params[1]).toBe('12345678deadbeef');
    });

    it('returns hex from base64 result', async () => {
      // Base64 of [0x01, 0x02, 0x03]
      const b64 = btoa(String.fromCharCode(1, 2, 3));
      mockJsonRpcResponse({ result: b64 });
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBe('0x010203');
    });

    it('returns null for AA== (empty) result', async () => {
      mockJsonRpcResponse({ result: 'AA==' });
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBeNull();
    });

    it('returns null for error in result', async () => {
      mockJsonRpcResponse({ error: 'revert' });
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBeNull();
    });

    it('returns null for revert result', async () => {
      mockJsonRpcResponse({ revert: 'Some revert reason here' });
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBeNull();
    });

    it('returns hex result as-is when starts with 0x', async () => {
      mockJsonRpcResponse({ result: '0xdeadbeef' });
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBe('0xdeadbeef');
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await callContract('opt1abc', '12345678');
      expect(result).toBeNull();
    });
  });

  // ─── getTokenBalance ───
  describe('getTokenBalance', () => {
    it('returns balance from callContract result', async () => {
      // Simulate callContract returning a hex string
      const b64 = btoa(String.fromCharCode(0, 0, 0, 0, 0, 0, 0x03, 0xe8)); // 1000
      mockJsonRpcResponse({ result: b64 });
      const balance = await getTokenBalance('opt1token', 'abc123');
      expect(balance).toBe(0x000000000003e8n);
    });

    it('returns 0n on null result', async () => {
      mockJsonRpcResponse({ result: 'AA==' });
      const balance = await getTokenBalance('opt1token', 'abc123');
      expect(balance).toBe(0n);
    });

    it('returns 0n on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const balance = await getTokenBalance('opt1token', 'abc123');
      expect(balance).toBe(0n);
    });
  });

  // ─── RPC retry + rate-limit logic ───
  describe('rpc retry and rate-limit behavior', () => {
    it('retries on 429 status', async () => {
      // First call returns 429 rate limit
      mockFetch.mockResolvedValueOnce({ ok: true, status: 429, json: () => Promise.resolve({}) });
      // Second call succeeds
      mockJsonRpcResponse('0x10');
      const height = await getBlockHeight();
      expect(height).toBe(16);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on network error', async () => {
      // First two calls fail, third succeeds
      mockFetch.mockRejectedValueOnce(new Error('net'));
      mockFetch.mockRejectedValueOnce(new Error('net'));
      mockJsonRpcResponse('0x5');
      const height = await getBlockHeight();
      expect(height).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting retries', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      await expect(getBlockHeight()).rejects.toThrow('fail');
    });
  });
});
