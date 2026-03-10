/**
 * LaunchpadForm.test.tsx -- Tests for src/components/launchpad/LaunchpadForm.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@btc-vision/walletconnect', () => ({
  useWalletConnect: vi.fn(() => ({
    walletAddress: 'opt1testaddr',
    walletInstance: { web3: { deployContract: vi.fn() } },
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('@btc-vision/bitcoin', () => ({
  Transaction: { fromHex: vi.fn(() => ({ getId: () => 'txid123' })) },
  networks: {
    opnetTestnet: { bech32: 'opt' },
    bitcoin: { bech32: 'bc' },
    regtest: { bech32: 'bcrt' },
  },
}));

vi.mock('@btc-vision/transaction', () => ({
  BinaryWriter: vi.fn().mockImplementation(() => ({
    writeU256: vi.fn(), writeU8: vi.fn(), writeStringWithLength: vi.fn(),
    writeBoolean: vi.fn(), getBuffer: vi.fn(() => new Uint8Array()),
  })),
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
}));

vi.mock('../abis', () => ({ LAUNCHPAD_ABI: [] }));
vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));

vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(() => ({ current: null })),
}));

import LaunchpadForm from '../components/launchpad/LaunchpadForm';

describe('LaunchpadForm', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns null when not open', () => {
    const { container } = render(
      <LaunchpadForm open={false} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(container.children.length).toBe(0);
  });

  it('renders dialog when open', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('dialog', { name: /Deploy new token contract/ })).toBeTruthy();
  });

  it('renders Deploy Contract heading', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('Deploy Contract')).toBeTruthy();
  });

  it('renders name and ticker inputs', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Token name')).toBeTruthy();
    expect(screen.getByLabelText('Token ticker symbol')).toBeTruthy();
  });

  it('renders description textarea', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Token description')).toBeTruthy();
  });

  it('renders total supply input', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Total supply')).toBeTruthy();
  });

  it('renders mint percentage slider', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('Initial mint percentage')).toBeTruthy();
  });

  it('renders deploy cost info', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/Deploy cost/)).toBeTruthy();
  });

  it('renders close button', async () => {
    const onClose = vi.fn();
    render(<LaunchpadForm open={true} onClose={onClose} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const closeBtn = screen.getByLabelText('Close deploy dialog');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders social link inputs', async () => {
    render(<LaunchpadForm open={true} onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByPlaceholderText('example.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('@handle')).toBeTruthy();
    expect(screen.getByPlaceholderText('t.me/group')).toBeTruthy();
  });
});
