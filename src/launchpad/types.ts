/**
 * Launchpad types & bonding curve math.
 * Inspired by pump.fun — virtual constant-product curve for price discovery.
 */

/* ─── Types ─── */

export interface LaunchToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  publicMintSupply: number;
  maxMintPerTx: number;
  mintedSupply: number;
  creator: string;
  createdAt: number;
  description: string;
  image: string | null;
  website?: string;
  twitter?: string;
  telegram?: string;
  status: 'bonding' | 'graduated' | 'pending_confirm';
  txHash?: string;
  trades: TradeRecord[];
  replies: Reply[];
  likes: number;
}

export interface TradeRecord {
  id: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  wallet: string;
  txHash: string;
  timestamp: number;
}

export interface Reply {
  id: string;
  wallet: string;
  text: string;
  timestamp: number;
}

/* ─── Bonding Curve ─── */

/** Virtual VIBE reserve for price calc */
const VIRTUAL_BASE = 500_000;
/** Graduate when 80% of publicMintSupply is minted */
export const GRADUATION_PCT = 0.80;

/** Current virtual price (in VIBE per token) */
export function getPrice(mintedSupply: number, publicMintSupply: number): number {
  if (publicMintSupply <= 0) return 0;
  const pct = Math.min(mintedSupply / publicMintSupply, 0.99);
  // As pct → 1, remaining → 0.01*supply → price skyrockets
  const remaining = Math.max(publicMintSupply * (1 - pct * 0.95), publicMintSupply * 0.01);
  return VIRTUAL_BASE / remaining;
}

/** Price at a given % minted (for chart) */
export function getPriceAtPct(pct: number, publicMintSupply: number): number {
  return getPrice(pct * publicMintSupply, publicMintSupply);
}

/** Virtual market cap in VIBE */
export function getMarketCap(token: LaunchToken): number {
  return getPrice(token.mintedSupply, token.publicMintSupply) * token.totalSupply;
}

/** Bonding progress 0..1 */
export function getProgress(token: LaunchToken): number {
  if (token.publicMintSupply <= 0) return 1;
  return Math.min(token.mintedSupply / token.publicMintSupply, 1);
}

/** Has graduated? */
export function isGraduated(token: LaunchToken): boolean {
  return token.status === 'graduated' || getProgress(token) >= GRADUATION_PCT;
}

/** Format market cap for display */
export function fmtMcap(vibe: number): string {
  if (vibe >= 1_000_000) return (vibe / 1_000_000).toFixed(1) + 'M';
  if (vibe >= 1_000) return (vibe / 1_000).toFixed(1) + 'K';
  return vibe.toFixed(0);
}

/** Format number compactly */
export function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

/** Generate deterministic color from string */
export function hashColor(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue},75%,55%)`, `hsl(${(hue + 30) % 360},70%,45%)`];
}

/** Generate SVG logo from symbol */
export function genLogo(sym: string): string {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const [c1, c2] = hashColor(sym);
  return `data:image/svg+xml,${encodeURIComponent(`<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g)"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.25)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 13 : 17}" fill="white">${s}</text><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`)}`;
}

/** Time ago string */
export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
