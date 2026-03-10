/**
 * Shared transaction history — localStorage-backed log for swaps, mints, claims.
 */
export interface TxRecord {
  id: string;
  type: 'swap' | 'mint' | 'claim';
  ts: number;
  txHash: string;
  tokenA?: string;
  tokenB?: string;
  amountA?: string;
  amountB?: string;
  status: 'pending' | 'confirmed' | 'failed';
  wallet: string;
}

const STORAGE_KEY = 'hub_tx_history';
const MAX_RECORDS = 100;

export function getTxHistory(wallet?: string): TxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all: TxRecord[] = JSON.parse(raw);
    if (wallet) return all.filter(r => r.wallet === wallet);
    return all;
  } catch (e) { console.warn('[txHistory] Failed to parse transaction history from localStorage:', e); return []; }
}

export function addTxRecord(record: Omit<TxRecord, 'id' | 'ts'>): TxRecord {
  const full: TxRecord = { ...record, id: crypto.randomUUID(), ts: Date.now() };
  const all = getTxHistory();
  all.unshift(full);
  if (all.length > MAX_RECORDS) all.length = MAX_RECORDS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return full;
}

export function formatTimeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
