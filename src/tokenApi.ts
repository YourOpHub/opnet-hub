/**
 * Token Indexer API — frontend helpers for querying the backend token indexer.
 * Falls back to hardcoded DEPLOYED_CONTRACTS when API is unavailable.
 */

import { logger } from './logger';

const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface IndexedToken {
    address: string;
    pubkey: string;
    symbol: string;
    name: string;
    decimals: number;
    total_supply: string;
    deploy_block: number;
    mintable?: number;     // -1=unknown, 0=no, 1=yes
    holder_count?: number; // approximate unique addresses
}

export interface HolderBalance {
    token: string;
    pubkey: string;
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
}

/** Paginated token response from /api/tokens?count=true */
export interface TokenPage {
    tokens: IndexedToken[];
    total: number;
    lastBlock: number;
    offset: number;
    limit: number;
}

/** Fetch tokens page from the indexer (paginated, with total count + block info) */
export async function fetchTokensPage(limit = 500, offset = 0): Promise<TokenPage> {
    try {
        const res = await fetch(`${API_BASE}/api/tokens?limit=${limit}&offset=${offset}&count=true`, {
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { tokens: [], total: 0, lastBlock: 0, offset, limit };
        return await res.json() as TokenPage;
    } catch (e) {
        logger.warn('[tokenApi] Failed to fetch tokens page:', e);
        return { tokens: [], total: 0, lastBlock: 0, offset, limit };
    }
}

/** Fetch all known OP-20 tokens from the indexer (loads all pages automatically) */
export async function fetchAllTokens(): Promise<IndexedToken[]> {
    const PAGE = 5000;
    const first = await fetchTokensPage(PAGE, 0);
    const all = [...first.tokens];
    // Auto-load remaining pages
    while (all.length < first.total) {
        const next = await fetchTokensPage(PAGE, all.length);
        if (next.tokens.length === 0) break;
        all.push(...next.tokens);
    }
    return all;
}

/** Fetch all token balances for a holder (by MLDSA pubkey hex + optional tweaked pubkey) */
export async function fetchHolderBalances(pubkey: string, tweakedPubkey?: string): Promise<HolderBalance[]> {
    try {
        const clean = encodeURIComponent(pubkey.replace('0x', ''));
        const tweaked = tweakedPubkey ? `?tweaked=${encodeURIComponent(tweakedPubkey.replace('0x', ''))}` : '';
        const res = await fetch(`${API_BASE}/api/holder/${clean}/tokens${tweaked}`, {
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return [];
        return await res.json() as HolderBalance[];
    } catch (e) {
        logger.warn('[tokenApi] Failed to fetch holder balances:', e);
        return [];
    }
}

export interface MotoswapPool {
    pool_pubkey: string;
    token0_pubkey: string;
    token1_pubkey: string;
    token0_symbol: string;
    token1_symbol: string;
    token0_decimals: number;
    token1_decimals: number;
    reserve0: string;
    reserve1: string;
    last_updated: string;
}

/** Fetch all discovered Motoswap liquidity pools */
export async function fetchMotoswapPools(): Promise<MotoswapPool[]> {
    try {
        const res = await fetch(`${API_BASE}/api/pools`, {
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        return await res.json() as MotoswapPool[];
    } catch (e) {
        logger.warn('[tokenApi] Failed to fetch Motoswap pools:', e);
        return [];
    }
}

/** Format raw balance to human-readable (safe for large BigInts) */
export function formatTokenBalance(rawBalance: string, decimals: number): string {
    const raw = BigInt(rawBalance);
    if (raw === 0n) return '0';
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    // Build decimal string from BigInt parts to avoid Number precision loss
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4);
    const n = Number(whole) + Number(fracStr) / Math.pow(10, fracStr.length);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
