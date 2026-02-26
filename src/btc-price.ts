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

async function tryBinance(): Promise<PriceData | null> {
  try {
    const [tickerRes, statsRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) }),
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) }),
    ]);
    if (!tickerRes.ok) return null;
    const ticker = await tickerRes.json();
    const price = parseFloat(ticker?.price);
    if (!price) return null;
    let change = 0;
    if (statsRes.ok) { const s = await statsRes.json(); change = parseFloat(s?.priceChangePercent) || 0; }
    return { usd: price, usd_24h_change: change, usd_market_cap: 0, source: 'Binance' };
  } catch { return null; }
}

async function tryKraken(): Promise<PriceData | null> {
  try {
    const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    const pair = d?.result?.XXBTZUSD ?? d?.result?.XBTUSD;
    if (!pair?.c?.[0]) return null;
    const price = parseFloat(pair.c[0]);
    const open = parseFloat(pair.o) || price;
    const change = open > 0 ? ((price - open) / open) * 100 : 0;
    return { usd: price, usd_24h_change: change, usd_market_cap: 0, source: 'Kraken' };
  } catch { return null; }
}

export async function fetchBtcPrice(): Promise<PriceData> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached;

  const result = (await tryBinance()) || (await tryKraken());
  if (result) {
    cached = result;
    cacheTime = Date.now();
    return result;
  }

  if (cached) return cached;
  return { usd: 0, usd_24h_change: 0, usd_market_cap: 0, source: 'none' };
}
