/**
 * MultiSenderComponent.test.tsx -- Tests for src/components/MultiSender.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: '',
    address: null,
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  OP_20_ABI: [],
}));

vi.mock('@btc-vision/transaction', () => ({
  Address: { fromString: vi.fn() },
}));

vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
}));

vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));

vi.mock('../txUtils', () => ({
  buildTxParams: vi.fn().mockResolvedValue({}),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));

vi.mock('../components/multisender/MultiSenderSetup', () => ({
  default: () => <div data-testid="setup">Setup</div>,
  parseRecipients: vi.fn(() => []),
  formatAmount: vi.fn(() => 0n),
}));

vi.mock('../components/multisender/MultiSenderReview', () => ({
  default: () => <div data-testid="review">Review</div>,
}));

vi.mock('../components/multisender/MultiSenderProgress', () => ({
  default: () => <div data-testid="progress">Progress</div>,
}));

import MultiSender from '../components/MultiSender';

describe('MultiSender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the multi-sender heading', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Multi-Sender')).toBeTruthy();
  });

  it('renders wizard step navigation', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('navigation', { name: /wizard/i })).toBeTruthy();
  });

  it('renders step label for step 1', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Select Token')).toBeTruthy();
  });

  it('renders back and next buttons', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('renders info footer', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('note')).toBeTruthy();
  });

  it('back button is disabled on step 1', async () => {
    render(<MultiSender />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const backBtn = screen.getByText('Back');
    expect((backBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
