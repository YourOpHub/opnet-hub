/**
 * Launchpad data persistence — localStorage + seed data.
 * In v2 this will be backed by an API server.
 */
import type { LaunchToken, TradeRecord } from './types';
import { logger } from '../logger';

const STORE_KEY = 'hub_launchpad_tokens';
const STORE_VERSION = 5;

/* ─── Seed tokens — REAL on-chain MintableToken contracts only ─── */
function seedTokens(): LaunchToken[] {
  const now = Date.now();
  return [
    {
      address: 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
      name: 'Mine Token', symbol: 'MINE', decimals: 8,
      totalSupply: 21_000_000, publicMintSupply: 10_500_000, maxMintPerTx: 1_000_000,
      mintedSupply: 0, creator: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my',
      createdAt: now - 86400_000 * 2, description: 'The OG mining token. Earn by playing SatoshiMiner, trade on AMM.',
      image: null, website: 'opnet.org', twitter: 'opaboratory',
      status: 'bonding', txHash: '',
      trades: [], replies: [], likes: 0,
    },
    {
      address: 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
      name: 'Vibe Token', symbol: 'VIBE', decimals: 8,
      totalSupply: 100_000_000, publicMintSupply: 50_000_000, maxMintPerTx: 5_000_000,
      mintedSupply: 0, creator: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my',
      createdAt: now - 86400_000 * 2, description: 'Community token for the OPNet ecosystem. Good vibes only.',
      image: null, website: 'opnet.org', twitter: 'opaboratory',
      status: 'bonding', txHash: '',
      trades: [], replies: [], likes: 0,
    },
  ];
}

/* ─── CRUD ─── */

export function loadTokens(): LaunchToken[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { version?: number; tokens?: LaunchToken[] };
      if (data.version === STORE_VERSION) return (data.tokens ?? []) as LaunchToken[];
    }
  } catch (e) { logger.warn('[launchpad/store] Failed to parse tokens from localStorage:', e); }
  // First load or version mismatch — seed
  const tokens = seedTokens();
  saveTokens(tokens);
  return tokens;
}

export function saveTokens(tokens: LaunchToken[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify({ version: STORE_VERSION, tokens }));
}

export function addToken(token: LaunchToken): LaunchToken[] {
  const tokens = loadTokens();
  tokens.unshift(token);
  saveTokens(tokens);
  return tokens;
}

export function updateToken(address: string, patch: Partial<LaunchToken>): LaunchToken[] {
  const tokens = loadTokens();
  const idx = tokens.findIndex(t => t.address === address);
  const token = tokens[idx];
  if (idx >= 0 && token) Object.assign(token, patch);
  saveTokens(tokens);
  return tokens;
}

export function addTrade(address: string, trade: TradeRecord): LaunchToken[] {
  const tokens = loadTokens();
  const tok = tokens.find(t => t.address === address);
  if (tok) {
    tok.trades.push(trade);
    if (trade.type === 'buy') tok.mintedSupply += trade.amount;
  }
  saveTokens(tokens);
  return tokens;
}

export function addReply(address: string, wallet: string, text: string): LaunchToken[] {
  const tokens = loadTokens();
  const tok = tokens.find(t => t.address === address);
  if (tok) {
    tok.replies.push({ id: `r_${Date.now()}`, wallet, text, timestamp: Date.now() });
  }
  saveTokens(tokens);
  return tokens;
}

export function toggleLike(address: string): LaunchToken[] {
  const tokens = loadTokens();
  const tok = tokens.find(t => t.address === address);
  if (tok) tok.likes += 1;
  saveTokens(tokens);
  return tokens;
}
