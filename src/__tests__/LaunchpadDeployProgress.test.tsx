/**
 * LaunchpadDeployProgress.test.tsx -- Tests for src/components/launchpad/LaunchpadDeployProgress.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { LaunchToken } from '../launchpad/types';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1testaddr',
    address: 'opt1testaddr',
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: {
    expandToDecimals: vi.fn(() => 0n),
    formatUnits: vi.fn(() => '0'),
  },
}));

vi.mock('../abis', () => ({ LAUNCHPAD_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
}));
vi.mock('../contracts', () => ({
  getContractOpscanUrl: vi.fn((a: string) => `https://opscan/${a}`),
  getTxUrl: vi.fn((t: string) => `https://tx/${t}`),
}));
vi.mock('../txUtils', () => ({
  buildTxParams: vi.fn().mockResolvedValue({}),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  formatTxError: vi.fn((e: unknown) => String(e)),
}));
vi.mock('../launchpad/types', () => ({
  getProgress: vi.fn(() => 0.5),
  isGraduated: vi.fn(() => false),
  fmtNum: vi.fn((n: number) => String(n)),
  hashColor: vi.fn(() => ['#F7931A', '#e8850f']),
  genLogo: vi.fn(() => 'data:image/svg+xml,<svg></svg>'),
  timeAgo: vi.fn(() => '1h ago'),
  GRADUATION_PCT: 0.8,
}));
vi.mock('../launchpad/store', () => ({
  addTrade: vi.fn(() => []),
}));
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));

import LaunchpadDeployProgress from '../components/launchpad/LaunchpadDeployProgress';

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
    createdAt: Date.now() - 3600000,
    description: 'A test token',
    image: null,
    status: 'bonding',
    txHash: 'tx123abc',
    trades: [],
    replies: [],
    likes: 0,
    ...overrides,
  };
}

describe('LaunchpadDeployProgress', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const baseProps = {
    selected: null as LaunchToken | null,
    userBal: 0,
    holderCount: 0,
    opscanHolderList: [] as Array<{ address: string; balance: string }>,
    opscanHolders: null as number | null,
    mintAmt: '',
    setMintAmt: vi.fn(),
    minting: false,
    setMinting: vi.fn(),
    mintStep: '',
    setMintStep: vi.fn(),
    onTokensChange: vi.fn(),
    onSelectedChange: vi.fn(),
    syncToken: vi.fn().mockResolvedValue(undefined),
    syncBalance: vi.fn().mockResolvedValue(undefined),
  };

  it('shows placeholder when no token selected', async () => {
    render(<LaunchpadDeployProgress {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/Select a contract from the sidebar/)).toBeTruthy();
  });

  it('renders token name and symbol when selected', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Test Token')).toBeTruthy();
    expect(screen.getByText('$TEST')).toBeTruthy();
  });

  it('renders supply section', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Supply')).toBeTruthy();
  });

  it('renders public mint panel for bonding token', async () => {
    const token = makeToken({ status: 'bonding' });
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getAllByText('Public Mint').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Mint amount')).toBeTruthy();
  });

  it('renders links section', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Links & Trade')).toBeTruthy();
  });

  it('renders recent activity section', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Recent Activity')).toBeTruthy();
    expect(screen.getByRole('list', { name: /Recent activity/ })).toBeTruthy();
  });

  it('shows ON-CHAIN badge for opt1sq addresses', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('ON-CHAIN')).toBeTruthy();
  });

  it('shows pending confirmation for pending_confirm status', async () => {
    const token = makeToken({ status: 'pending_confirm' });
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Awaiting Confirmation')).toBeTruthy();
  });

  it('shows description when present', async () => {
    const token = makeToken({ description: 'A cool token' });
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('A cool token')).toBeTruthy();
  });

  it('shows empty activity message', async () => {
    const token = makeToken();
    render(<LaunchpadDeployProgress {...baseProps} selected={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/No mints yet/)).toBeTruthy();
  });
});
