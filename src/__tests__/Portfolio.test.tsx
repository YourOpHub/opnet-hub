/**
 * Portfolio.test.tsx -- Tests for src/components/Portfolio.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1testwallet',
    walletInstance: null,
    address: null,
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  OP_20_ABI: [],
  BitcoinUtils: { formatUnits: vi.fn((v: bigint) => String(Number(v) / 1e8)) },
}));

vi.mock('../abis', () => ({ POOL_LP_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));

vi.mock('../opnet', () => ({
  getBalance: vi.fn().mockResolvedValue(50000n),
  getBlockHeight: vi.fn().mockResolvedValue(100),
  getNetwork: vi.fn(() => 'testnet'),
  setNetwork: vi.fn(),
  getTokenBalance: vi.fn().mockResolvedValue(1000000n),
  formatSats: vi.fn((v: bigint) => (Number(v) / 1e8).toFixed(8)),
}));

vi.mock('../contracts', () => ({
  DEPLOYED_CONTRACTS: {
    MINE: { address: 'opt1sqtest1', pubkey: '0xabc', symbol: 'MINE', name: 'Mine Token', decimals: 8, supply: 21000000, icon: 'M' },
  },
  POOL_ADDRESS: 'opt1sqpool',
  MINE_DEPLOY_TXID: 'txmine',
  VIBE_DEPLOY_TXID: 'txvibe',
  getContractOpscanUrl: vi.fn(() => ''),
  getTxUrl: vi.fn(() => ''),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({ usd: 97000, usd_24h_change: 2 }),
}));

vi.mock('../txHistory', () => ({
  getTxHistory: vi.fn(() => []),
  formatTimeAgo: vi.fn(() => '1m ago'),
}));

import Portfolio from '../components/Portfolio';

describe('Portfolio', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders with wallet connected', async () => {
    const { container } = render(<Portfolio />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('renders portfolio heading', async () => {
    render(<Portfolio />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const text = document.body.textContent || '';
    expect(text).toContain('Portfolio');
  });

  it('renders wallet info', async () => {
    render(<Portfolio />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const text = document.body.textContent || '';
    // Without walletInstance, Portfolio shows "Connect Wallet to View Portfolio"
    expect(text).toContain('Connect Wallet');
  });
});
