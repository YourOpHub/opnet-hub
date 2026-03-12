/**
 * MultiSenderReview.test.tsx -- Tests for src/components/multisender/MultiSenderReview.tsx
 *
 * Covers: summary cards, recipient table, gas estimate, wallet status
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock walletConnect
vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: '',
    openConnectModal: vi.fn(),
  })),
}));

import { useWalletConnect } from '@btc-vision/walletconnect';
import MultiSenderReview from '../components/multisender/MultiSenderReview';

const mkRecipient = (addr: string, amt: string) => ({ address: addr, amount: amt, valid: true });

describe('MultiSenderReview', () => {
  const defaultProps = {
    tokenSymbol: 'MINE',
    validRecipients: [
      mkRecipient('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my', '100'),
      mkRecipient('opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa', '250'),
    ],
    totalAmount: 350,
    estimatedGasSats: 10000,
    estimatedGasBtc: '0.000100',
  };

  it('renders summary cards', () => {
    render(<MultiSenderReview {...defaultProps} />);
    expect(screen.getByText('MINE')).toBeTruthy();
    // Recipients count shown in summary card
    const summaryCards = document.querySelectorAll('.ms-summary-val');
    expect(summaryCards.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('350')).toBeTruthy(); // total amount
  });

  it('renders recipient table', () => {
    render(<MultiSenderReview {...defaultProps} />);
    expect(screen.getByText('Review Transfers')).toBeTruthy();
    // Table headers
    expect(screen.getByText('Recipient')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
  });

  it('shows gas estimate', () => {
    render(<MultiSenderReview {...defaultProps} />);
    // Gas estimate: ~10,000 sats (~0.000100 BTC), toLocaleString may not add commas in jsdom
    expect(screen.getByText(/10.?000/)).toBeTruthy();
    expect(screen.getByText(/0\.000100/)).toBeTruthy();
  });

  it('shows connect wallet alert when not connected', () => {
    render(<MultiSenderReview {...defaultProps} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Connect your wallet to proceed.')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('shows wallet address when connected', () => {
    vi.mocked(useWalletConnect).mockReturnValue({
      walletAddress: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my',
      openConnectModal: vi.fn(),
    } as unknown as ReturnType<typeof useWalletConnect>);

    render(<MultiSenderReview {...defaultProps} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Wallet:/)).toBeTruthy();
  });

  it('shows Custom when tokenSymbol is empty', () => {
    render(<MultiSenderReview {...defaultProps} tokenSymbol="" />);
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('truncates long addresses in table', () => {
    render(<MultiSenderReview {...defaultProps} />);
    // The long opt1 address should be truncated with ...
    const cells = screen.getAllByText(/\.\.\./);
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });
});
