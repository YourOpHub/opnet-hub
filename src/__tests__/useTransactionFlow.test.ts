import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionFlow } from '../hooks/useTransactionFlow';

describe('useTransactionFlow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    expect(result.current.step).toBe('idle');
    expect(result.current.txHash).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('transitions through startApproval', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    act(() => result.current.startApproval());
    expect(result.current.step).toBe('approving');
  });

  it('transitions through startExecution', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    act(() => result.current.startExecution());
    expect(result.current.step).toBe('executing');
  });

  it('transitions to done with txHash', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    act(() => result.current.setDone('0xabc123'));
    expect(result.current.step).toBe('done');
    expect(result.current.txHash).toBe('0xabc123');
  });

  it('transitions to error with message', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    act(() => result.current.startApproval());
    act(() => result.current.setError('something broke'));
    expect(result.current.step).toBe('error');
    expect(result.current.error).toBe('something broke');
  });

  it('reset clears state and localStorage', () => {
    const { result } = renderHook(() => useTransactionFlow('test-flow'));
    act(() => result.current.setDone('0xabc'));
    act(() => result.current.reset());
    expect(result.current.step).toBe('idle');
    expect(result.current.txHash).toBeUndefined();
    // After reset, useEffect re-saves {step:'idle'}, so localStorage has the idle state
    const stored = localStorage.getItem('opnet_txflow_test-flow');
    expect(stored === null || JSON.parse(stored).step === 'idle').toBe(true);
  });

  it('persists state to localStorage', () => {
    const { result } = renderHook(() => useTransactionFlow('persist-test'));
    act(() => result.current.startApproval());
    const stored = JSON.parse(localStorage.getItem('opnet_txflow_persist-test') || '{}');
    expect(stored.step).toBe('approving');
  });

  it('restores state from localStorage', () => {
    localStorage.setItem('opnet_txflow_restore-test', JSON.stringify({ step: 'executing' }));
    const { result } = renderHook(() => useTransactionFlow('restore-test'));
    expect(result.current.step).toBe('executing');
  });
});
