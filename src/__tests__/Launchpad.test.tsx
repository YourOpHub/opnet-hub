/**
 * Launchpad.test.tsx -- Tests for src/components/Launchpad.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({ walletAddress: '', address: null })),
}));

vi.mock('opnet', () => ({ getContract: vi.fn() }));
vi.mock('../abis', () => ({ LAUNCHPAD_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../txUtils', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../launchpad/store', () => ({
  loadTokens: vi.fn(() => []),
  saveTokens: vi.fn(),
  addToken: vi.fn(),
}));

vi.mock('../launchpad/api', () => ({
  isServerAvailable: vi.fn().mockResolvedValue(false),
  fetchTokens: vi.fn().mockResolvedValue([]),
  registerToken: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../components/launchpad/LaunchpadForm', () => ({
  default: () => null,
}));
vi.mock('../components/launchpad/LaunchpadTokenList', () => ({
  default: () => null,
}));
vi.mock('../components/launchpad/LaunchpadDeployProgress', () => ({
  default: () => null,
}));

import Launchpad from '../components/Launchpad';

describe('Launchpad', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders without crashing', async () => {
    const { container } = render(<Launchpad />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.children.length).toBeGreaterThan(0);
  });
});
