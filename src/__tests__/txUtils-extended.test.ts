/**
 * txUtils-extended.test.ts -- Extended tests for src/txUtils.ts
 *
 * Covers: additional formatTxError cases (502, CORS, own order, invalid epoch,
 *         signer not allowed), withRetry edge cases.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { withRetry, formatTxError } from '../txUtils';

// ---- formatTxError extended ----
describe('formatTxError extended', () => {
  it('formats 502 / bad gateway error', () => {
    const msg = formatTxError(new Error('received 502 bad gateway'));
    expect(msg).toContain('502');
    expect(msg).toContain('temporarily unavailable');
  });

  it('formats CORS error', () => {
    const msg = formatTxError(new Error('cors policy blocked'));
    expect(msg).toContain('CORS');
  });

  it('formats own order error', () => {
    const msg = formatTxError(new Error('cannot accept own order'));
    expect(msg).toContain('Cannot fill your own order');
  });

  it('formats invalid epoch error', () => {
    const msg = formatTxError(new Error('invalid epoch sequence'));
    expect(msg).toContain('encoding error');
  });

  it('formats feature data length error', () => {
    const msg = formatTxError(new Error('feature data length mismatch'));
    expect(msg).toContain('encoding error');
  });

  it('formats signer not allowed error', () => {
    const msg = formatTxError(new Error('signer is not allowed'));
    expect(msg).toContain('Wallet rejected');
  });

  it('handles plain string (non-Error) gracefully', () => {
    expect(formatTxError('some string')).toBe('Transaction failed');
    expect(formatTxError(null)).toBe('Transaction failed');
    expect(formatTxError(undefined)).toBe('Transaction failed');
    expect(formatTxError(42)).toBe('Transaction failed');
  });

  it('returns original message for unknown errors', () => {
    const msg = formatTxError(new Error('something completely random'));
    expect(msg).toBe('something completely random');
  });

  it('handles Error with allowance keyword', () => {
    const msg = formatTxError(new Error('allowance too low'));
    expect(msg).toContain('Allowance');
  });

  it('handles timeout keyword', () => {
    const msg = formatTxError(new Error('request timeout after 5000ms'));
    expect(msg).toContain('Network timeout');
  });

  it('handles fetch keyword', () => {
    const msg = formatTxError(new Error('fetch failed'));
    expect(msg).toContain('Network timeout');
  });

  it('revert message gets testnet hint appended', () => {
    const msg = formatTxError(new Error('execution revert: some reason'));
    expect(msg).toContain('revert');
    expect(msg).toContain('Try again');
    expect(msg).toContain('testnet');
  });

  it('no utxo message includes faucet hint on testnet', () => {
    const msg = formatTxError(new Error('no utxo found'));
    expect(msg).toContain('No BTC UTXOs');
    expect(msg).toContain('faucet');
  });
});

// ---- withRetry extended ----
describe('withRetry extended', () => {
  it('with 0 retries, only tries once', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, 0, 10)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('with default retries (2), tries 3 times total', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, 2, 10)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('succeeds on last retry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('final success');
    const result = await withRetry(fn, 2, 10);
    expect(result).toBe('final success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns non-string values', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'ok', count: 42 });
    const result = await withRetry(fn, 1, 10);
    expect(result).toEqual({ status: 'ok', count: 42 });
  });

  it('returns null values', async () => {
    const fn = vi.fn().mockResolvedValue(null);
    const result = await withRetry(fn, 1, 10);
    expect(result).toBeNull();
  });

  it('preserves error type from last attempt', async () => {
    const customError = new TypeError('custom type error');
    const fn = vi.fn().mockRejectedValue(customError);
    await expect(withRetry(fn, 0, 10)).rejects.toThrow(customError);
  });
});
