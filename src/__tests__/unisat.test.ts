/**
 * unisat.test.ts -- Tests for src/wallets/unisat.ts
 *
 * Covers: getUnisat, isUnisatInstalled, connectUnisat, disconnectUnisat,
 *         sendFractalBTC, getFractalTxUrl, getFractalAddressUrl,
 *         FRACTAL_CHAINS, FRACTAL_EXPLORER
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getUnisat,
  isUnisatInstalled,
  connectUnisat,
  disconnectUnisat,
  sendFractalBTC,
  getFractalTxUrl,
  getFractalAddressUrl,
  FRACTAL_CHAINS,
  FRACTAL_EXPLORER,
} from '../wallets/unisat';

function makeMockUnisat(overrides: Record<string, unknown> = {}) {
  return {
    requestAccounts: vi.fn().mockResolvedValue(['tb1qtest123']),
    getAccounts: vi.fn().mockResolvedValue(['tb1qtest123']),
    getPublicKey: vi.fn().mockResolvedValue('03abcdef1234567890'),
    getBalance: vi.fn().mockResolvedValue({ confirmed: 100000, unconfirmed: 0, total: 100000 }),
    getNetwork: vi.fn().mockResolvedValue('testnet'),
    switchNetwork: vi.fn().mockResolvedValue(undefined),
    getChain: vi.fn().mockResolvedValue({ enum: 'FRACTAL_BITCOIN_TESTNET', name: 'Fractal Bitcoin Testnet', network: 'testnet' }),
    switchChain: vi.fn().mockResolvedValue({ enum: 'FRACTAL_BITCOIN_TESTNET', name: 'Fractal Bitcoin Testnet', network: 'testnet' }),
    sendBitcoin: vi.fn().mockResolvedValue('txid123'),
    signPsbt: vi.fn().mockResolvedValue('signed_hex'),
    signMessage: vi.fn().mockResolvedValue('signature'),
    pushPsbt: vi.fn().mockResolvedValue('pushed_txid'),
    pushTx: vi.fn().mockResolvedValue('pushed_txid'),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

describe('wallets/unisat', () => {
  beforeEach(() => {
    // Clear any previous unisat mock
    (window as any).unisat = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).unisat;
  });

  // ---- FRACTAL_CHAINS ----
  describe('FRACTAL_CHAINS', () => {
    it('has MAINNET and TESTNET', () => {
      expect(FRACTAL_CHAINS.MAINNET).toBe('FRACTAL_BITCOIN_MAINNET');
      expect(FRACTAL_CHAINS.TESTNET).toBe('FRACTAL_BITCOIN_TESTNET');
    });
  });

  // ---- FRACTAL_EXPLORER ----
  describe('FRACTAL_EXPLORER', () => {
    it('has testnet and mainnet URLs', () => {
      expect(FRACTAL_EXPLORER.testnet).toContain('testnet');
      expect(FRACTAL_EXPLORER.mainnet).toContain('mempool.fractalbitcoin.io');
      expect(FRACTAL_EXPLORER.mainnet).not.toContain('testnet');
    });
  });

  // ---- getUnisat ----
  describe('getUnisat', () => {
    it('returns null when unisat is not installed', () => {
      expect(getUnisat()).toBeNull();
    });

    it('returns the unisat provider when installed', () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;
      expect(getUnisat()).toBe(mock);
    });
  });

  // ---- isUnisatInstalled ----
  describe('isUnisatInstalled', () => {
    it('returns false when not installed', () => {
      expect(isUnisatInstalled()).toBe(false);
    });

    it('returns true when installed', () => {
      (window as any).unisat = makeMockUnisat();
      expect(isUnisatInstalled()).toBe(true);
    });
  });

  // ---- connectUnisat ----
  describe('connectUnisat', () => {
    it('throws when unisat is not installed', async () => {
      await expect(connectUnisat()).rejects.toThrow('UniSat Wallet not installed');
    });

    it('connects and returns wallet state', async () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;

      const state = await connectUnisat(true);
      expect(state.connected).toBe(true);
      expect(state.address).toBe('tb1qtest123');
      expect(state.publicKey).toBe('03abcdef1234567890');
      expect(state.balance.total).toBe(100000);
      expect(state.chain.enum).toBe('FRACTAL_BITCOIN_TESTNET');
    });

    it('calls switchChain with testnet chain by default', async () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;

      await connectUnisat(true);
      expect(mock.switchChain).toHaveBeenCalledWith('FRACTAL_BITCOIN_TESTNET');
    });

    it('calls switchChain with mainnet chain when testnet=false', async () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;

      await connectUnisat(false);
      expect(mock.switchChain).toHaveBeenCalledWith('FRACTAL_BITCOIN_MAINNET');
    });

    it('falls back to getChain if switchChain fails', async () => {
      const mock = makeMockUnisat({
        switchChain: vi.fn().mockRejectedValue(new Error('user rejected')),
      });
      (window as any).unisat = mock;

      const state = await connectUnisat(true);
      expect(state.connected).toBe(true);
      expect(mock.getChain).toHaveBeenCalled();
    });

    it('throws when no accounts returned', async () => {
      const mock = makeMockUnisat({
        requestAccounts: vi.fn().mockResolvedValue([]),
      });
      (window as any).unisat = mock;

      await expect(connectUnisat()).rejects.toThrow('No accounts returned');
    });

    it('uses fresh accounts after switchChain', async () => {
      const mock = makeMockUnisat({
        requestAccounts: vi.fn().mockResolvedValue(['tb1qold']),
        getAccounts: vi.fn().mockResolvedValue(['tb1qfresh']),
      });
      (window as any).unisat = mock;

      const state = await connectUnisat(true);
      expect(state.address).toBe('tb1qfresh');
    });
  });

  // ---- disconnectUnisat ----
  describe('disconnectUnisat', () => {
    it('returns empty state', () => {
      const state = disconnectUnisat();
      expect(state.connected).toBe(false);
      expect(state.address).toBe('');
      expect(state.publicKey).toBe('');
      expect(state.balance.total).toBe(0);
      expect(state.chain.enum).toBe('');
    });
  });

  // ---- sendFractalBTC ----
  describe('sendFractalBTC', () => {
    it('throws when unisat not connected', async () => {
      await expect(sendFractalBTC('tb1qrecipient', 10000)).rejects.toThrow('UniSat not connected');
    });

    it('sends BTC via unisat', async () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;

      const txid = await sendFractalBTC('tb1qrecipient', 10000, 2);
      expect(txid).toBe('txid123');
      expect(mock.sendBitcoin).toHaveBeenCalledWith('tb1qrecipient', 10000, { feeRate: 2 });
    });

    it('uses default feeRate=1', async () => {
      const mock = makeMockUnisat();
      (window as any).unisat = mock;

      await sendFractalBTC('tb1qrecipient', 5000);
      expect(mock.sendBitcoin).toHaveBeenCalledWith('tb1qrecipient', 5000, { feeRate: 1 });
    });
  });

  // ---- getFractalTxUrl ----
  describe('getFractalTxUrl', () => {
    it('returns testnet URL by default', () => {
      const url = getFractalTxUrl('abc123');
      expect(url).toContain('testnet');
      expect(url).toContain('/tx/abc123');
    });

    it('returns mainnet URL when testnet=false', () => {
      const url = getFractalTxUrl('abc123', false);
      expect(url).not.toContain('testnet');
      expect(url).toContain('/tx/abc123');
    });

    it('handles empty txid', () => {
      const url = getFractalTxUrl('');
      expect(url).toContain('/tx/');
    });
  });

  // ---- getFractalAddressUrl ----
  describe('getFractalAddressUrl', () => {
    it('returns testnet URL by default', () => {
      const url = getFractalAddressUrl('tb1qtest');
      expect(url).toContain('testnet');
      expect(url).toContain('/address/tb1qtest');
    });

    it('returns mainnet URL when testnet=false', () => {
      const url = getFractalAddressUrl('bc1qmain', false);
      expect(url).not.toContain('testnet');
      expect(url).toContain('/address/bc1qmain');
    });

    it('handles empty address', () => {
      const url = getFractalAddressUrl('');
      expect(url).toContain('/address/');
    });
  });
});
