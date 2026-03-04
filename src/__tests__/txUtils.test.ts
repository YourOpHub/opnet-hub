import { describe, it, expect, vi } from 'vitest';
import { withRetry, formatTxError } from '../txUtils';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 2, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, 2, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'));
    await expect(withRetry(fn, 1, 10)).rejects.toThrow('always fail');
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

describe('formatTxError', () => {
  it('formats UTXO error', () => {
    expect(formatTxError(new Error('no utxo available'))).toContain('No BTC UTXOs');
  });

  it('formats allowance error', () => {
    expect(formatTxError(new Error('insufficient allowance'))).toContain('Allowance not yet confirmed');
  });

  it('formats timeout error', () => {
    expect(formatTxError(new Error('fetch timeout'))).toContain('Network timeout');
  });

  it('handles non-Error input', () => {
    expect(formatTxError('string error')).toBe('Transaction failed');
  });

  it('appends retry hint for revert', () => {
    const msg = formatTxError(new Error('execution reverted'));
    expect(msg).toContain('revert');
    expect(msg).toContain('Try again');
  });
});
