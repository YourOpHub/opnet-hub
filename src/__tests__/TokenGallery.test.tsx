/**
 * TokenGallery.test.tsx -- Tests for src/components/TokenGallery.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: '',
    walletInstance: null,
    address: null,
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  BitcoinUtils: {
    formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)),
    expandToDecimals: vi.fn(() => 0n),
  },
}));

vi.mock('../abis', () => ({ MINTABLE_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({ gasParameters: vi.fn().mockResolvedValue({ bitcoin: { recommended: { medium: 10 }, conservative: 10 }, gasPerSat: 1n, baseGas: 5000n }) })) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));
vi.mock('../opnet', () => ({
  getNetwork: vi.fn(() => 'testnet'),
  setNetwork: vi.fn(),
  getTokenTotalSupply: vi.fn().mockResolvedValue(0n),
}));
vi.mock('../contracts', () => ({
  DEPLOYED_CONTRACTS: {
    MINE: {
      address: 'opt1sqtest1', pubkey: '0xabc', symbol: 'MINE', name: 'Mine Token',
      decimals: 8, supply: 21000000, icon: 'M', description: 'test', deployTxid: 'tx1',
      publicMint: true, maxMintPerTx: 1000000,
    },
  },
  getContractOpscanUrl: vi.fn((a: string) => `https://opscan.org/${a}`),
  getTxUrl: vi.fn((t: string) => `https://tx/${t}`),
}));
vi.mock('../txHistory', () => ({
  addTxRecord: vi.fn(),
  getTxHistory: vi.fn(() => []),
  formatTimeAgo: vi.fn(() => '1m ago'),
}));
vi.mock('../contexts/OpsContext', () => ({
  useOps: vi.fn(() => ({
    trackOp: vi.fn(), completeOp: vi.fn(), failOp: vi.fn(),
    activeOps: [], historyOps: [], activeCount: 0,
    updateOpStep: vi.fn(), dismissOp: vi.fn(),
  })),
}));
vi.mock('../tokenApi', () => ({
  fetchAllTokens: vi.fn().mockResolvedValue([
    { symbol: 'TEST', name: 'Test Token', address: '0xabc', pubkey: '0xabc123', decimals: 8, total_supply: '100000000000000', deploy_block: 100, mintable: 1, holder_count: 5 },
    { symbol: 'FOO', name: 'Foo Token', address: '0xdef', pubkey: '0xdef456', decimals: 8, total_supply: '0', deploy_block: 200, mintable: 0, holder_count: 0 },
  ]),
  formatTokenBalance: vi.fn((s: string) => s),
}));

import TokenGallery from '../components/TokenGallery';

describe('TokenGallery', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders heading', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getAllByText(/Tokens/).length).toBeGreaterThan(0);
  });

  it('renders tab buttons', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Featured')).toBeTruthy();
  });

  it('renders token table on All tab', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole('table', { name: 'Token list' })).toBeTruthy();
  });

  it('renders search input', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByLabelText(/Search tokens/)).toBeTruthy();
  });

  it('renders sort chips', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    // Sort chips include sort icon. Default sort is 'block' desc so shows ▼
    expect(screen.getByText('Sort:')).toBeTruthy();
    expect(screen.getByText(/A.Z/)).toBeTruthy();
  });

  it('renders mintable filter', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByLabelText('Filter mintable tokens')).toBeTruthy();
  });

  it('renders import section', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText(/Import token by address/)).toBeTruthy();
  });

  it('switches to Featured tab', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByText('Featured'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Mine Token')).toBeTruthy();
    expect(screen.getByText('ON-CHAIN')).toBeTruthy();
  });

  it('switches to My tab with empty state', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const myTab = screen.getAllByText(/My/)[0];
    if (myTab) fireEvent.click(myTab);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('No tokens deployed yet')).toBeTruthy();
  });

  it('renders About Tokens section', async () => {
    render(<TokenGallery />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('About Tokens')).toBeTruthy();
  });
});
