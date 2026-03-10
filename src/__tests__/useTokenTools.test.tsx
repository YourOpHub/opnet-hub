/**
 * useTokenTools.test.tsx -- Tests for src/hooks/useTokenTools.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockOpenConnectModal = vi.fn();
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1testwallet',
    address: 'senderAddr',
    openConnectModal: mockOpenConnectModal,
  })),
}));

const mockProvider = { callContract: vi.fn() };
vi.mock('../contractCache', () => ({
  getProvider: vi.fn(() => mockProvider),
}));

const mockTrackOp = vi.fn();
const mockCompleteOp = vi.fn();
const mockFailOp = vi.fn();
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: mockTrackOp,
    completeOp: mockCompleteOp,
    failOp: mockFailOp,
    activeOps: [],
    historyOps: [],
    activeCount: 0,
    updateOpStep: vi.fn(),
    dismissOp: vi.fn(),
  })),
}));

import { useTokenTools } from '../hooks/useTokenTools';

describe('useTokenTools', () => {
  it('returns walletAddress from walletconnect', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.walletAddress).toBe('opt1testwallet');
  });

  it('returns senderAddr', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.senderAddr).toBe('senderAddr');
  });

  it('returns openConnectModal function', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.openConnectModal).toBe(mockOpenConnectModal);
  });

  it('returns provider', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.provider).toBe(mockProvider);
  });

  it('returns trackOp from OpsContext', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.trackOp).toBe(mockTrackOp);
  });

  it('returns completeOp from OpsContext', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.completeOp).toBe(mockCompleteOp);
  });

  it('returns failOp from OpsContext', () => {
    const { result } = renderHook(() => useTokenTools());
    expect(result.current.failOp).toBe(mockFailOp);
  });
});
