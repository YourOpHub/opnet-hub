/**
 * Launchpad data persistence — localStorage + seed data.
 * In v2 this will be backed by an API server.
 */
import type { LaunchToken, TradeRecord } from './types';

const STORE_KEY = 'hub_launchpad_tokens';
const STORE_VERSION = 2;

/* ─── Seed tokens (pre-populated) ─── */
function seedTokens(): LaunchToken[] {
  const now = Date.now();
  return [
    {
      address: 'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa',
      name: 'Mine Token', symbol: 'MINE', decimals: 8,
      totalSupply: 21_000_000, publicMintSupply: 10_500_000, maxMintPerTx: 1_000_000,
      mintedSupply: 3_850_000, creator: 'opt1pp76wu...svtj5my',
      createdAt: now - 86400_000 * 3, description: 'The OG mining token. Earn by playing SatoshiMiner, trade on the AMM.',
      image: null, website: 'https://opnet.org', twitter: 'opaboratory',
      status: 'bonding', txHash: '25843e9643ef623ea0d07fd196da277536b37156f90e1d0a718ebaa58d577cf0',
      trades: genTrades(18, now - 86400_000 * 3, 'MINE', 10_500_000),
      replies: [
        { id: 'r1', wallet: 'opt1pp76wu...svtj5my', text: 'LFG! First token on OPNet launchpad 🚀', timestamp: now - 86400_000 * 2 },
        { id: 'r2', wallet: 'opt1pq8x3m...jk29a1', text: 'Mining is addictive ngl', timestamp: now - 86400_000 },
      ],
      likes: 42,
    },
    {
      address: 'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802',
      name: 'Vibe Token', symbol: 'VIBE', decimals: 8,
      totalSupply: 100_000_000, publicMintSupply: 50_000_000, maxMintPerTx: 5_000_000,
      mintedSupply: 42_500_000, creator: 'opt1pp76wu...svtj5my',
      createdAt: now - 86400_000 * 3, description: 'Community token for the OPNet ecosystem. Good vibes only.',
      image: null, status: 'graduated', txHash: 'bfbe3f54be4f56069976e3511ab4a4834462c28469412e1d20cb84746622b46b',
      trades: genTrades(35, now - 86400_000 * 3, 'VIBE', 50_000_000),
      replies: [
        { id: 'r3', wallet: 'opt1pq8x3m...jk29a1', text: 'VIBE graduated! Trading on AMM now 🎉', timestamp: now - 43200_000 },
      ],
      likes: 78,
    },
    {
      address: 'opt1sq_demo_satoshi_cat', name: 'Satoshi Cat', symbol: 'SCAT', decimals: 8,
      totalSupply: 1_000_000_000, publicMintSupply: 500_000_000, maxMintPerTx: 10_000_000,
      mintedSupply: 125_000_000, creator: 'opt1pz9abc...demo1',
      createdAt: now - 7200_000, description: 'The first cat on Bitcoin L1. Meow.',
      image: null, status: 'bonding',
      trades: genTrades(8, now - 7200_000, 'SCAT', 500_000_000),
      replies: [{ id: 'r4', wallet: 'opt1pz9abc...demo1', text: 'cats > dogs. always.', timestamp: now - 3600_000 }],
      likes: 15,
    },
    {
      address: 'opt1sq_demo_bitcoin_pepe', name: 'Bitcoin Pepe', symbol: 'BPEPE', decimals: 8,
      totalSupply: 420_690_000, publicMintSupply: 210_345_000, maxMintPerTx: 5_000_000,
      mintedSupply: 84_138_000, creator: 'opt1pk7def...demo2',
      createdAt: now - 14400_000, description: 'Feels good man. The rarest pepe lives on Bitcoin.',
      image: null, status: 'bonding',
      trades: genTrades(12, now - 14400_000, 'BPEPE', 210_345_000),
      replies: [], likes: 31,
    },
    {
      address: 'opt1sq_demo_opnet_ai', name: 'OPNet AI', symbol: 'OPAI', decimals: 8,
      totalSupply: 10_000_000, publicMintSupply: 5_000_000, maxMintPerTx: 100_000,
      mintedSupply: 4_250_000, creator: 'opt1pm3ghi...demo3',
      createdAt: now - 86400_000, description: 'AI agents on Bitcoin L1. Bob approved.',
      image: null, status: 'graduated',
      trades: genTrades(25, now - 86400_000, 'OPAI', 5_000_000),
      replies: [
        { id: 'r5', wallet: 'opt1pm3ghi...demo3', text: 'We graduated! Next stop: AMM pool 🤖', timestamp: now - 43200_000 },
      ],
      likes: 56,
    },
    {
      address: 'opt1sq_demo_rune_gold', name: 'Rune Gold', symbol: 'RGOLD', decimals: 8,
      totalSupply: 21_000_000, publicMintSupply: 10_500_000, maxMintPerTx: 500_000,
      mintedSupply: 1_050_000, creator: 'opt1pn4jkl...demo4',
      createdAt: now - 1800_000, description: 'Digital gold on Bitcoin. Stack sats, stack RGOLD.',
      image: null, status: 'bonding',
      trades: genTrades(4, now - 1800_000, 'RGOLD', 10_500_000),
      replies: [], likes: 7,
    },
    {
      address: 'opt1sq_demo_gm_token', name: 'GM Token', symbol: 'GM', decimals: 8,
      totalSupply: 69_420_000, publicMintSupply: 34_710_000, maxMintPerTx: 1_000_000,
      mintedSupply: 22_561_500, creator: 'opt1pp5mno...demo5',
      createdAt: now - 172800_000, description: 'gm. gn. Built different on Bitcoin L1.',
      image: null, status: 'bonding',
      trades: genTrades(20, now - 172800_000, 'GM', 34_710_000),
      replies: [
        { id: 'r6', wallet: 'opt1pp5mno...demo5', text: 'gm frens', timestamp: now - 86400_000 },
        { id: 'r7', wallet: 'opt1pz9abc...demo1', text: 'gm! almost graduated 🫡', timestamp: now - 43200_000 },
      ],
      likes: 33,
    },
    {
      address: 'opt1sq_demo_laser_eyes', name: 'Laser Eyes', symbol: 'LASER', decimals: 8,
      totalSupply: 100_000_000, publicMintSupply: 50_000_000, maxMintPerTx: 2_000_000,
      mintedSupply: 5_000_000, creator: 'opt1pq6pqr...demo6',
      createdAt: now - 3600_000, description: '🔴 Laser eyes until $100K BTC. Then laser eyes until $1M.',
      image: null, status: 'bonding',
      trades: genTrades(6, now - 3600_000, 'LASER', 50_000_000),
      replies: [], likes: 12,
    },
  ];
}

/** Generate fake trade history */
function genTrades(count: number, startTs: number, sym: string, pubSupply: number): TradeRecord[] {
  const trades: TradeRecord[] = [];
  const span = Date.now() - startTs;
  for (let i = 0; i < count; i++) {
    const ts = startTs + Math.floor((span / count) * i + Math.random() * (span / count));
    const isBuy = Math.random() > 0.2;
    const amt = Math.floor(Math.random() * pubSupply * 0.05) + 1000;
    const pctMinted = (i / count) * 0.8;
    const remaining = Math.max(pubSupply * (1 - pctMinted * 0.95), pubSupply * 0.01);
    const price = 500_000 / remaining;
    trades.push({
      id: `t_${sym}_${i}`,
      type: isBuy ? 'buy' : 'sell',
      amount: amt,
      price,
      wallet: `opt1p${Math.random().toString(36).slice(2, 8)}...${Math.random().toString(36).slice(2, 6)}`,
      txHash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
      timestamp: ts,
    });
  }
  return trades;
}

/* ─── CRUD ─── */

export function loadTokens(): LaunchToken[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.version === STORE_VERSION) return data.tokens as LaunchToken[];
    }
  } catch { /* corrupted */ }
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
  if (idx >= 0) Object.assign(tokens[idx], patch);
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
