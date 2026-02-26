/**
 * Multi-source BTC price fetcher with caching.
 * Tries CoinGecko first, then CoinCap, then Blockchain.info.
 * Caches result for 60s to avoid rate limits.
 */

interface PriceData {
  usd: number;
  usd_24h_change: number;
  usd_market_cap: number;
  source: string;
}

let cached: PriceData | null = null;
let cacheTime = 0;
const CACHE_TTL = 120_000; // 120s

async function tryCoinCap(): Promise<PriceData | null> {
  try {
    const res = await fetch('https://api.coincap.io/v2/assets/bitcoin', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.data?.priceUsd) return null;
    return {
      usd: parseFloat(d.data.priceUsd),
      usd_24h_change: parseFloat(d.data.changePercent24Hr) || 0,
      usd_market_cap: parseFloat(d.data.marketCapUsd) || 0,
      source: 'CoinCap',
    };
  } catch { return null; }
}

async function tryBlockchainInfo(): Promise<PriceData | null> {
  try {
    const res = await fetch('https://blockchain.info/ticker', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.USD?.last) return null;
    return { usd: d.USD.last, usd_24h_change: 0, usd_market_cap: 0, source: 'Blockchain.info' };
  } catch { return null; }
}

async function tryCoingecko(): Promise<PriceData | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.bitcoin?.usd) return null;
    return { usd: d.bitcoin.usd, usd_24h_change: d.bitcoin.usd_24h_change ?? 0, usd_market_cap: d.bitcoin.usd_market_cap ?? 0, source: 'CoinGecko' };
  } catch { return null; }
}

export async function fetchBtcPrice(): Promise<PriceData> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached;

  const result = (await tryCoinCap()) || (await tryBlockchainInfo()) || (await tryCoingecko());
  if (result) {
    cached = result;
    cacheTime = Date.now();
    return result;
  }

  // All sources failed — return cache if exists, else zeros
  if (cached) return cached;
  return { usd: 0, usd_24h_change: 0, usd_market_cap: 0, source: 'none' };
}
