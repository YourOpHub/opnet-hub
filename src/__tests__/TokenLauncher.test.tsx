/**
 * TokenLauncher.test.tsx -- Tests for src/components/TokenLauncher.tsx
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
    openConnectModal: vi.fn(),
  })),
}));

vi.mock('@btc-vision/transaction', () => ({
  BinaryWriter: vi.fn().mockImplementation(() => ({
    writeU256: vi.fn(), writeU8: vi.fn(), writeStringWithLength: vi.fn(),
    writeBoolean: vi.fn(), getBuffer: vi.fn(() => new Uint8Array()),
  })),
  Address: { fromString: vi.fn() },
}));

vi.mock('@btc-vision/bitcoin', () => ({
  Transaction: { fromHex: vi.fn(() => ({ getId: () => 'txid123' })) },
  networks: {
    opnetTestnet: { bech32: 'opt' },
    bitcoin: { bech32: 'bc' },
    regtest: { bech32: 'bcrt' },
  },
}));

vi.mock('../contractCache', () => ({ getProvider: vi.fn(() => ({})) }));
vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  CURRENT_ENV: 'testnet',
}));
vi.mock('../opnet', () => ({
  getNetwork: vi.fn(() => 'testnet'),
  setNetwork: vi.fn(),
}));
vi.mock('../contracts', () => ({
  getTxUrl: vi.fn((t: string) => `https://tx/${t}`),
}));

import TokenLauncher from '../components/TokenLauncher';

describe('TokenLauncher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the launcher heading', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText(/Token Launcher/)).toBeTruthy();
  });

  it('renders token name input with default value', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const nameInput = screen.getByLabelText('Token name');
    expect(nameInput).toBeTruthy();
    expect((nameInput as HTMLInputElement).value).toBe('My Token');
  });

  it('renders token symbol input', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const symInput = screen.getByLabelText('Token symbol');
    expect(symInput).toBeTruthy();
    expect((symInput as HTMLInputElement).value).toBe('MTK');
  });

  it('renders total supply input', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Total Supply')).toBeTruthy();
  });

  it('renders preset buttons', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('MEME')).toBeTruthy();
    expect(screen.getByText('GOLD')).toBeTruthy();
    expect(screen.getByText('COM')).toBeTruthy();
  });

  it('applies preset on click', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const memePreset = screen.getByText('MEME').closest('button');
    if (memePreset) fireEvent.click(memePreset);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect((screen.getByLabelText('Token name') as HTMLInputElement).value).toBe('Meme Coin');
    expect((screen.getByLabelText('Token symbol') as HTMLInputElement).value).toBe('MEME');
  });

  it('renders mode toggle (standard vs mintable)', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText(/Standard/)).toBeTruthy();
    expect(screen.getByText(/Mintable/)).toBeTruthy();
  });

  it('renders connect wallet button when not connected', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Connect Wallet to Deploy')).toBeTruthy();
  });

  it('renders verify section', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('form', { name: /Verify deployment/ })).toBeTruthy();
  });

  it('renders live preview', async () => {
    render(<TokenLauncher />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Live Preview')).toBeTruthy();
  });
});
