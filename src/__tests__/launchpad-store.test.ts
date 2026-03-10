/**
 * launchpad-store.test.ts -- Tests for src/launchpad/store.ts
 *
 * Covers: loadTokens, saveTokens, addToken, updateToken, addTrade, addReply, toggleLike
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  loadTokens,
  saveTokens,
  addToken,
  updateToken,
  addTrade,
  addReply,
  toggleLike,
} from '../launchpad/store';

import type { LaunchToken, TradeRecord } from '../launchpad/types';

function makeToken(overrides: Partial<LaunchToken> = {}): LaunchToken {
  return {
    address: 'opt1test' + Math.random().toString(36).slice(2, 8),
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 8,
    totalSupply: 21_000_000,
    publicMintSupply: 10_500_000,
    maxMintPerTx: 1_000_000,
    mintedSupply: 0,
    creator: 'opt1creator',
    createdAt: Date.now(),
    description: 'Test token',
    image: null,
    status: 'bonding',
    trades: [],
    replies: [],
    likes: 0,
    ...overrides,
  };
}

describe('launchpad/store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ---- loadTokens ----
  describe('loadTokens', () => {
    it('returns seed tokens on first load', () => {
      const tokens = loadTokens();
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      const symbols = tokens.map(t => t.symbol);
      expect(symbols).toContain('MINE');
      expect(symbols).toContain('VIBE');
    });

    it('returns stored tokens when version matches', () => {
      const custom = [makeToken({ symbol: 'CUSTOM', address: 'opt1custom' })];
      localStorage.setItem('hub_launchpad_tokens', JSON.stringify({ version: 4, tokens: custom }));
      const tokens = loadTokens();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.symbol).toBe('CUSTOM');
    });

    it('returns seed tokens on version mismatch', () => {
      const custom = [makeToken({ symbol: 'OLD' })];
      localStorage.setItem('hub_launchpad_tokens', JSON.stringify({ version: 3, tokens: custom }));
      const tokens = loadTokens();
      // Should seed fresh tokens, not return the old version
      const symbols = tokens.map(t => t.symbol);
      expect(symbols).toContain('MINE');
      expect(symbols).not.toContain('OLD');
    });

    it('returns seed tokens on corrupted JSON', () => {
      localStorage.setItem('hub_launchpad_tokens', 'not-json');
      const tokens = loadTokens();
      expect(tokens.length).toBeGreaterThanOrEqual(2);
    });

    it('saves seed tokens to localStorage on first load', () => {
      loadTokens();
      const stored = localStorage.getItem('hub_launchpad_tokens');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.version).toBe(4);
      expect(parsed.tokens.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---- saveTokens ----
  describe('saveTokens', () => {
    it('saves tokens with version 4', () => {
      const tokens = [makeToken()];
      saveTokens(tokens);
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.version).toBe(4);
      expect(stored.tokens).toHaveLength(1);
    });

    it('overwrites previous tokens', () => {
      saveTokens([makeToken({ symbol: 'A' })]);
      saveTokens([makeToken({ symbol: 'B' })]);
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.tokens).toHaveLength(1);
      expect(stored.tokens[0].symbol).toBe('B');
    });

    it('saves empty array', () => {
      saveTokens([]);
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.tokens).toHaveLength(0);
    });
  });

  // ---- addToken ----
  describe('addToken', () => {
    it('adds token to the beginning of the list', () => {
      loadTokens(); // seed
      const newToken = makeToken({ symbol: 'NEW', address: 'opt1new' });
      const tokens = addToken(newToken);
      expect(tokens[0]!.symbol).toBe('NEW');
    });

    it('returns updated token list', () => {
      loadTokens(); // seed with MINE and VIBE
      const newToken = makeToken({ symbol: 'NEW', address: 'opt1new' });
      const tokens = addToken(newToken);
      expect(tokens.length).toBeGreaterThanOrEqual(3);
    });

    it('persists to localStorage', () => {
      loadTokens();
      const newToken = makeToken({ symbol: 'PERSISTED', address: 'opt1persist' });
      addToken(newToken);
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.tokens[0].symbol).toBe('PERSISTED');
    });
  });

  // ---- updateToken ----
  describe('updateToken', () => {
    it('updates an existing token by address', () => {
      const addr = 'opt1update';
      const initial = makeToken({ address: addr, symbol: 'OLD' });
      saveTokens([initial]);

      const tokens = updateToken(addr, { symbol: 'UPDATED' });
      expect(tokens[0]!.symbol).toBe('UPDATED');
      expect(tokens[0]!.address).toBe(addr);
    });

    it('does not add new token if address not found', () => {
      saveTokens([makeToken({ address: 'opt1exists' })]);
      const tokens = updateToken('opt1nonexistent', { symbol: 'GHOST' });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.symbol).not.toBe('GHOST');
    });

    it('persists update to localStorage', () => {
      const addr = 'opt1persist';
      saveTokens([makeToken({ address: addr, likes: 0 })]);
      updateToken(addr, { likes: 42 });
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.tokens[0].likes).toBe(42);
    });

    it('partially updates (keeps other fields)', () => {
      const addr = 'opt1partial';
      saveTokens([makeToken({ address: addr, symbol: 'KEEP', name: 'Keep Name' })]);
      updateToken(addr, { symbol: 'CHANGED' });
      const stored = JSON.parse(localStorage.getItem('hub_launchpad_tokens')!);
      expect(stored.tokens[0].symbol).toBe('CHANGED');
      expect(stored.tokens[0].name).toBe('Keep Name');
    });
  });

  // ---- addTrade ----
  describe('addTrade', () => {
    it('adds trade to correct token', () => {
      const addr = 'opt1trade';
      saveTokens([makeToken({ address: addr, trades: [] })]);
      const trade: TradeRecord = {
        id: 't1', type: 'buy', amount: 1_000, price: 0.01,
        wallet: 'opt1buyer', txHash: '0xabc', timestamp: Date.now(),
      };
      const tokens = addTrade(addr, trade);
      expect(tokens[0]!.trades).toHaveLength(1);
      expect(tokens[0]!.trades[0]!.id).toBe('t1');
    });

    it('increments mintedSupply on buy trades', () => {
      const addr = 'opt1buytrade';
      saveTokens([makeToken({ address: addr, mintedSupply: 100 })]);
      const trade: TradeRecord = {
        id: 't2', type: 'buy', amount: 500, price: 0.01,
        wallet: 'opt1buyer', txHash: '0xdef', timestamp: Date.now(),
      };
      const tokens = addTrade(addr, trade);
      expect(tokens[0]!.mintedSupply).toBe(600);
    });

    it('does not increment mintedSupply on sell trades', () => {
      const addr = 'opt1selltrade';
      saveTokens([makeToken({ address: addr, mintedSupply: 100 })]);
      const trade: TradeRecord = {
        id: 't3', type: 'sell', amount: 50, price: 0.01,
        wallet: 'opt1seller', txHash: '0x123', timestamp: Date.now(),
      };
      const tokens = addTrade(addr, trade);
      expect(tokens[0]!.mintedSupply).toBe(100);
    });

    it('does nothing for non-existent token', () => {
      saveTokens([makeToken({ address: 'opt1exists' })]);
      const trade: TradeRecord = {
        id: 't4', type: 'buy', amount: 100, price: 0.01,
        wallet: 'opt1w', txHash: '0x', timestamp: Date.now(),
      };
      const tokens = addTrade('opt1ghost', trade);
      expect(tokens[0]!.trades).toHaveLength(0);
    });
  });

  // ---- addReply ----
  describe('addReply', () => {
    it('adds reply to correct token', () => {
      const addr = 'opt1reply';
      saveTokens([makeToken({ address: addr, replies: [] })]);
      const tokens = addReply(addr, 'opt1user', 'hello');
      expect(tokens[0]!.replies).toHaveLength(1);
      expect(tokens[0]!.replies[0]!.text).toBe('hello');
      expect(tokens[0]!.replies[0]!.wallet).toBe('opt1user');
      expect(tokens[0]!.replies[0]!.id).toMatch(/^r_/);
    });

    it('does nothing for non-existent token', () => {
      saveTokens([makeToken({ address: 'opt1exists', replies: [] })]);
      const tokens = addReply('opt1ghost', 'opt1user', 'hello');
      expect(tokens[0]!.replies).toHaveLength(0);
    });

    it('appends multiple replies', () => {
      const addr = 'opt1multi';
      saveTokens([makeToken({ address: addr, replies: [] })]);
      addReply(addr, 'opt1a', 'first');
      const tokens = addReply(addr, 'opt1b', 'second');
      expect(tokens[0]!.replies).toHaveLength(2);
    });
  });

  // ---- toggleLike ----
  describe('toggleLike', () => {
    it('increments likes by 1', () => {
      const addr = 'opt1like';
      saveTokens([makeToken({ address: addr, likes: 5 })]);
      const tokens = toggleLike(addr);
      expect(tokens[0]!.likes).toBe(6);
    });

    it('does not change likes for non-existent token', () => {
      saveTokens([makeToken({ address: 'opt1exists', likes: 5 })]);
      const tokens = toggleLike('opt1ghost');
      expect(tokens[0]!.likes).toBe(5);
    });

    it('increments from 0', () => {
      const addr = 'opt1zero';
      saveTokens([makeToken({ address: addr, likes: 0 })]);
      const tokens = toggleLike(addr);
      expect(tokens[0]!.likes).toBe(1);
    });
  });
});
