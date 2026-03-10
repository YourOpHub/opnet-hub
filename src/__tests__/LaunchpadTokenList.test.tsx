/**
 * LaunchpadTokenList.test.tsx -- Tests for src/components/launchpad/LaunchpadTokenList.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { LaunchToken } from '../launchpad/types';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
}));

vi.mock('../abis', () => ({ LAUNCHPAD_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
}));

vi.mock('../launchpad/types', () => ({
  getProgress: vi.fn(() => 0.5),
  isGraduated: vi.fn(() => false),
  hashColor: vi.fn(() => ['#F7931A', '#e8850f']),
  genLogo: vi.fn(() => 'data:image/svg+xml,<svg></svg>'),
  GRADUATION_PCT: 0.8,
}));

vi.mock('../launchpad/store', () => ({
  addToken: vi.fn((t: unknown) => [t]),
}));

vi.mock('../launchpad/api', () => ({
  registerToken: vi.fn().mockResolvedValue({ ok: true }),
}));

import LaunchpadTokenList from '../components/launchpad/LaunchpadTokenList';

function makeToken(overrides: Partial<LaunchToken> = {}): LaunchToken {
  return {
    address: 'opt1sqtest123456',
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 8,
    totalSupply: 21_000_000,
    publicMintSupply: 10_500_000,
    maxMintPerTx: 1_000_000,
    mintedSupply: 5_000_000,
    creator: 'opt1creator',
    createdAt: Date.now(),
    description: 'Test',
    image: null,
    status: 'bonding',
    trades: [],
    replies: [],
    likes: 0,
    ...overrides,
  };
}

describe('LaunchpadTokenList', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const baseProps = {
    tokens: [makeToken()],
    selected: null as LaunchToken | null,
    onSelect: vi.fn(),
    onTokensChange: vi.fn(),
    onDeployOpen: vi.fn(),
    onMintStep: vi.fn(),
    useServer: false,
  };

  it('renders Contracts heading', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Contracts')).toBeTruthy();
  });

  it('renders search input', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText(/Search contracts/)).toBeTruthy();
  });

  it('renders sort mode tabs', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('tablist', { name: /Sort mode/ })).toBeTruthy();
    expect(screen.getByText('1H Hot')).toBeTruthy();
    expect(screen.getByText('Newest')).toBeTruthy();
  });

  it('renders token list', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('list', { name: /Token contracts/ })).toBeTruthy();
    expect(screen.getByText('TEST')).toBeTruthy();
  });

  it('renders Deploy New Contract button', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Deploy New Contract')).toBeTruthy();
  });

  it('calls onDeployOpen when Deploy clicked', async () => {
    const props = { ...baseProps, onDeployOpen: vi.fn() };
    render(<LaunchpadTokenList {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.click(screen.getByText('Deploy New Contract'));
    expect(props.onDeployOpen).toHaveBeenCalled();
  });

  it('renders add contract input', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Add contract by address')).toBeTruthy();
  });

  it('renders empty state when no tokens match search', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const searchInput = screen.getByLabelText(/Search contracts/);
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('No contracts found')).toBeTruthy();
  });

  it('shows token count badge', async () => {
    render(<LaunchpadTokenList {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('1')).toBeTruthy();
  });
});
