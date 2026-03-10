/**
 * useTransactionFlow-extended.test.ts -- Extended tests for src/hooks/useTransactionFlow.ts
 *
 * Covers additional edge cases:
 *   - startWaiting block height tracking
 *   - Corrupted localStorage on load
 *   - Error preserves previous state fields
 *   - Multiple flow IDs isolation
 *   - State transitions: done -> reset -> idle
 *   - localStorage error handling (save/clear)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionFlow } from '../hooks/useTransactionFlow';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../contractCache', () => ({
  getProvider: () => ({
    getBlockNumber: vi.fn().mockResolvedValue(42n),
  }),
}));

describe('useTransactionFlow extended', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('startWaiting', () => {
    it('sets step to waiting with block height', async () => {
      const { result } = renderHook(() => useTransactionFlow('wait-test'));
      await act(async () => {
        await result.current.startWaiting();
      });
      expect(result.current.step).toBe('waiting');
      expect(result.current.waitingSince).toBe(42);
    });

    it('persists waitingSince to localStorage', async () => {
      const { result } = renderHook(() => useTransactionFlow('wait-persist'));
      await act(async () => {
        await result.current.startWaiting();
      });
      const stored = JSON.parse(localStorage.getItem('opnet_txflow_wait-persist')!);
      expect(stored.step).toBe('waiting');
      expect(stored.waitingSince).toBe(42);
    });
  });

  describe('error handling', () => {
    it('setError preserves previous step info in error message', () => {
      const { result } = renderHook(() => useTransactionFlow('error-test'));
      act(() => result.current.startApproval());
      act(() => result.current.setError('tx reverted'));
      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('tx reverted');
    });

    it('setError from idle', () => {
      const { result } = renderHook(() => useTransactionFlow('error-idle'));
      act(() => result.current.setError('something'));
      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('something');
    });

    it('setError multiple times updates error message', () => {
      const { result } = renderHook(() => useTransactionFlow('multi-error'));
      act(() => result.current.setError('first'));
      expect(result.current.error).toBe('first');
      act(() => result.current.setError('second'));
      expect(result.current.error).toBe('second');
    });
  });

  describe('localStorage edge cases', () => {
    it('handles corrupted JSON gracefully (returns idle)', () => {
      localStorage.setItem('opnet_txflow_corrupt', 'not-json');
      const { result } = renderHook(() => useTransactionFlow('corrupt'));
      expect(result.current.step).toBe('idle');
    });

    it('handles empty localStorage value', () => {
      localStorage.setItem('opnet_txflow_empty', '');
      const { result } = renderHook(() => useTransactionFlow('empty'));
      expect(result.current.step).toBe('idle');
    });

    it('restores full state from localStorage', () => {
      localStorage.setItem('opnet_txflow_full', JSON.stringify({
        step: 'done',
        txHash: '0xdeadbeef',
      }));
      const { result } = renderHook(() => useTransactionFlow('full'));
      expect(result.current.step).toBe('done');
      expect(result.current.txHash).toBe('0xdeadbeef');
    });

    it('restores error state from localStorage', () => {
      localStorage.setItem('opnet_txflow_err', JSON.stringify({
        step: 'error',
        error: 'previous error',
      }));
      const { result } = renderHook(() => useTransactionFlow('err'));
      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('previous error');
    });

    it('restores waiting state with waitingSince', () => {
      localStorage.setItem('opnet_txflow_waiting', JSON.stringify({
        step: 'waiting',
        waitingSince: 100,
      }));
      const { result } = renderHook(() => useTransactionFlow('waiting'));
      expect(result.current.step).toBe('waiting');
      expect(result.current.waitingSince).toBe(100);
    });
  });

  describe('flow isolation', () => {
    it('different flow IDs have independent state', () => {
      const { result: flowA } = renderHook(() => useTransactionFlow('flow-a'));
      const { result: flowB } = renderHook(() => useTransactionFlow('flow-b'));

      act(() => flowA.current.startApproval());
      expect(flowA.current.step).toBe('approving');
      expect(flowB.current.step).toBe('idle');
    });

    it('reset only clears its own flow', () => {
      const { result: flowA } = renderHook(() => useTransactionFlow('reset-a'));
      const { result: flowB } = renderHook(() => useTransactionFlow('reset-b'));

      act(() => flowA.current.setDone('0xaaa'));
      act(() => flowB.current.setDone('0xbbb'));

      act(() => flowA.current.reset());
      expect(flowA.current.step).toBe('idle');
      expect(flowB.current.step).toBe('done');
      expect(flowB.current.txHash).toBe('0xbbb');
    });
  });

  describe('full flow cycle', () => {
    it('idle -> approving -> executing -> done -> reset', () => {
      const { result } = renderHook(() => useTransactionFlow('cycle'));

      expect(result.current.step).toBe('idle');

      act(() => result.current.startApproval());
      expect(result.current.step).toBe('approving');

      act(() => result.current.startExecution());
      expect(result.current.step).toBe('executing');

      act(() => result.current.setDone('0xfinal'));
      expect(result.current.step).toBe('done');
      expect(result.current.txHash).toBe('0xfinal');

      act(() => result.current.reset());
      expect(result.current.step).toBe('idle');
      expect(result.current.txHash).toBeUndefined();
    });

    it('idle -> approving -> error -> reset', () => {
      const { result } = renderHook(() => useTransactionFlow('error-cycle'));

      act(() => result.current.startApproval());
      act(() => result.current.setError('user rejected'));
      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('user rejected');

      act(() => result.current.reset());
      expect(result.current.step).toBe('idle');
      expect(result.current.error).toBeUndefined();
    });
  });

  describe('setDone', () => {
    it('clears error when transitioning to done', () => {
      const { result } = renderHook(() => useTransactionFlow('done-clear'));
      act(() => result.current.setError('old error'));
      act(() => result.current.setDone('0xsuccess'));
      expect(result.current.step).toBe('done');
      expect(result.current.error).toBeUndefined();
    });
  });

  describe('startExecution', () => {
    it('can be called from any step', () => {
      const { result } = renderHook(() => useTransactionFlow('exec-any'));
      act(() => result.current.startExecution());
      expect(result.current.step).toBe('executing');
    });
  });
});
