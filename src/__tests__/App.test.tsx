import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock walletconnect
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: () => ({
    openConnectModal: vi.fn(),
    disconnect: vi.fn(),
    walletAddress: null,
    connecting: false,
    address: null,
  }),
  WalletConnectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock opnet (heavy dependency)
vi.mock('opnet', () => {
  class MockProvider {
    getBlockNumber = vi.fn().mockResolvedValue(100n);
    gasParameters = vi.fn().mockResolvedValue({
      bitcoin: { recommended: { low: 2, medium: 4 } },
      gasPerSat: 1000000n,
      baseGas: 500000000n,
    });
  }
  return {
    getContract: vi.fn(),
    OP_20_ABI: [],
    JSONRpcProvider: MockProvider,
    ABIDataTypes: { UINT256: 'uint256' },
    BitcoinAbiTypes: { Function: 'Function' },
  };
});

import App from '../App';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it('shows Connect Wallet button when not connected', () => {
    render(<App />);
    expect(screen.getAllByText('Connect Wallet').length).toBeGreaterThan(0);
  });

  it('renders navigation groups', () => {
    render(<App />);
    // Both desktop and mobile navs have these labels
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DeFi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Explore').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Play').length).toBeGreaterThan(0);
  });

  it('renders footer with links', () => {
    render(<App />);
    expect(screen.getByText('Docs')).toBeTruthy();
    expect(screen.getByText('OPScan')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  it('navigates on Home click', () => {
    render(<App />);
    const homeBtn = screen.getAllByText('Home')[0];
    fireEvent.click(homeBtn);
    expect(document.querySelector('.M')).toBeTruthy();
  });
});
