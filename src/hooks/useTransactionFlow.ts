/**
 * useTransactionFlow — manages multi-step transaction flows in OPNet.
 *
 * Tracks state through: idle -> approving -> waiting -> executing -> done | error
 * Persists state to localStorage for resume capability across page reloads.
 * Polls block height to advance from 'waiting' to ready-for-execute.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getProvider } from '../contractCache';

export type TxStep = 'idle' | 'approving' | 'waiting' | 'executing' | 'done' | 'error';

export interface TxFlowState {
  step: TxStep;
  txHash?: string;
  error?: string;
  /** Block height when 'waiting' started — used by the poller */
  waitingSince?: number;
}

const STORAGE_PREFIX = 'opnet_txflow_';
const POLL_INTERVAL = 8_000; // 8s — matches txUtils pattern

function loadState(flowId: string): TxFlowState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + flowId);
    if (raw) return JSON.parse(raw) as TxFlowState;
  } catch { /* corrupt data — start fresh */ }
  return { step: 'idle' };
}

function saveState(flowId: string, state: TxFlowState): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + flowId, JSON.stringify(state));
  } catch { /* storage full or blocked — non-critical */ }
}

function clearState(flowId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + flowId);
  } catch { /* ignore */ }
}

export function useTransactionFlow(flowId: string) {
  const [state, setState] = useState<TxFlowState>(() => loadState(flowId));
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist every state change
  useEffect(() => {
    saveState(flowId, state);
  }, [flowId, state]);

  // Block polling: when step === 'waiting', poll until block advances
  useEffect(() => {
    if (state.step !== 'waiting') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const provider = getProvider();
    const startBlock = state.waitingSince ?? 0;

    pollingRef.current = setInterval(async () => {
      try {
        const current = await provider.getBlockNumber();
        if (Number(current) > startBlock) {
          // Block advanced — ready for execution
          setState(prev => prev.step === 'waiting' ? { ...prev, step: 'executing' } : prev);
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [state.step, state.waitingSince]);

  const startApproval = useCallback(() => {
    setState({ step: 'approving' });
  }, []);

  const startWaiting = useCallback(async () => {
    let blockHeight = 0;
    try {
      const provider = getProvider();
      blockHeight = Number(await provider.getBlockNumber());
    } catch { /* fallback to 0 — polling will still work */ }
    setState({ step: 'waiting', waitingSince: blockHeight });
  }, []);

  const startExecution = useCallback(() => {
    setState({ step: 'executing' });
  }, []);

  const setDone = useCallback((txHash: string) => {
    setState({ step: 'done', txHash });
  }, []);

  const setError = useCallback((msg: string) => {
    setState(prev => ({ ...prev, step: 'error', error: msg }));
  }, []);

  const reset = useCallback(() => {
    clearState(flowId);
    setState({ step: 'idle' });
  }, [flowId]);

  return {
    ...state,
    startApproval,
    startWaiting,
    startExecution,
    setDone,
    setError,
    reset,
  };
}
