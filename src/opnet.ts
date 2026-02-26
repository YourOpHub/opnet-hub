/**
 * OP_NET RPC — browser-compatible wrapper
 * All methods use live OP_NET JSON-RPC (regtest / testnet / mainnet).
 * 
 * Network address HRPs:
 *   mainnet  → bc1   (networks.bitcoin)
 *   testnet  → opt1  (networks.opnetTestnet — Signet fork, NOT networks.testnet)
 *   regtest  → bcrt1 (networks.regtest)
 * 
 * @see https://docs.opnet.org
 */

export type Network = 'regtest' | 'testnet' | 'mainnet';

const RPC_BASE: Record<Network, string> = {
  regtest: 'https://regtest.opnet.org/api/v1/json-rpc',
  testnet: 'https://testnet.opnet.org/api/v1/json-rpc',
  mainnet: 'https://mainnet.opnet.org/api/v1/json-rpc',
};

let currentNetwork: Network = 'testnet';

export function getRpcUrl(): string {
  return RPC_BASE[currentNetwork];
}

export function setNetwork(net: Network): void {
  currentNetwork = net;
}

export function getNetwork(): Network {
  return currentNetwork;
}

interface RpcResponse {
  result?: unknown;
  error?: { code?: number; message: string };
}

async function rpc(method: string, params: unknown[] = [], timeoutMs = 8000): Promise<unknown> {
  const url = getRpcUrl();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json()) as RpcResponse;
    if (data.error) throw new Error(data.error.message || 'RPC error');
    return data.result;
  } catch (e) {
    console.warn(`[OP_NET RPC] ${method} failed:`, e);
    throw e;
  }
}

/** Parse hex number from RPC (e.g. "0x81b" -> 2075) */
function parseHexNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = v.startsWith('0x') ? parseInt(v.slice(2), 16) : parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Get current Bitcoin block height from OP_NET */
export async function getBlockHeight(): Promise<number> {
  const r = await rpc('btc_blockNumber', []);
  return parseHexNumber(r);
}

export async function getChainId(): Promise<number> {
  const r = await rpc('btc_chainId', []);
  return parseHexNumber(r);
}

/** Get balance of address in satoshis */
export async function getBalance(address: string, filterOrdinals = true): Promise<bigint> {
  const r = await rpc('btc_getBalance', [address, filterOrdinals]);
  if (typeof r !== 'string') return 0n;
  const s = r.startsWith('0x') ? r.slice(2) : r;
  try {
    return BigInt('0x' + s);
  } catch {
    return 0n;
  }
}

/** Get contract code; returns { bytecode } or null if not a contract */
export async function getCode(address: string, onlyBytecode = false): Promise<{ bytecode?: string } | null> {
  try {
    const r = await rpc('btc_getCode', [address, onlyBytecode]) as { bytecode?: string; contractAddress?: string };
    return r && (r.bytecode || r.contractAddress) ? r : null;
  } catch {
    return null;
  }
}

/** Storage slot index to pointer (32-byte big-endian, base64) */
function slotToPointer(slot: number): string {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setUint32(28, slot, false);
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Get storage at contract address and slot (OP-20: 0=name, 1=symbol, 2=decimals, 3=totalSupply) */
export async function getStorageAt(address: string, slot: number, proofs = false): Promise<unknown> {
  const pointer = slotToPointer(slot);
  const r = await rpc('btc_getStorageAt', [address, pointer, proofs]);
  return r;
}

/** Gas parameters for the next block */
export interface GasParams {
  blockNumber: string;
  baseGas: string;
  gasPerSat: string;
  bitcoin: { conservative: string; recommended?: { low: string; medium: string; high: string } };
}

export async function getGasParameters(): Promise<GasParams | null> {
  try {
    const r = await rpc('btc_gas', []) as GasParams;
    return r || null;
  } catch {
    return null;
  }
}

/** Latest epoch (5-block checkpoint) */
export async function getLatestEpoch(): Promise<{ number?: number; hash?: string } | null> {
  try {
    const r = await rpc('btc_latestEpoch', []) as { number?: number; hash?: string };
    return r || null;
  } catch {
    return null;
  }
}

/** Mempool stats */
export async function getMempoolInfo(): Promise<{ count?: number; opnetCount?: number; sizeBytes?: number } | null> {
  try {
    const r = await rpc('btc_getMempoolInfo', []) as { count?: number; opnetCount?: number; sizeBytes?: number };
    return r || null;
  } catch {
    return null;
  }
}

/** Decode base64 string to hex */
function base64ToHex(b64: string): string {
  const bin = atob(b64);
  return Array.from(bin, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/** Simulate contract call (read-only).
 *  btc_call params: [to, calldataHex, fromMLDSAHex?, fromTweakedHex?, blockHeight?, ...] */
export async function callContract(
  to: string,
  selectorHex: string,
  calldataBodyHex = '',
  fromMLDSAHex?: string,
  fromTweakedHex?: string,
): Promise<string | null> {
  const data = (selectorHex + calldataBodyHex).replace(/^0x/, '');
  try {
    const params: (string | undefined)[] = [to, data, fromMLDSAHex, fromTweakedHex];
    const r = await rpc('btc_call', params) as Record<string, unknown>;
    if (!r) return null;
    if (r.error) return null;
    if (typeof r.revert === 'string' && r.revert.length > 4) return null;
    const raw = typeof r.result === 'string' ? r.result : (typeof r.returnData === 'string' ? r.returnData : null);
    if (!raw || raw === 'AA==') return null;
    if (raw.startsWith('0x')) return raw;
    try { return '0x' + base64ToHex(raw); } catch { return raw; }
  } catch {
    return null;
  }
}

/** Get OP-20 token balance for an owner (returns 0n on any failure).
 *  ownerMLDSAHex: 32-byte ML-DSA key hash hex of the token holder */
export async function getTokenBalance(
  tokenAddress: string,
  ownerMLDSAHex: string,
  ownerTweakedHex?: string,
): Promise<bigint> {
  try {
    const BALANCE_OF_SELECTOR = '5b46f8f6';
    const result = await callContract(tokenAddress, BALANCE_OF_SELECTOR, ownerMLDSAHex, ownerMLDSAHex, ownerTweakedHex);
    if (!result) return 0n;
    const hex = result.startsWith('0x') ? result.slice(2) : result;
    if (!hex || hex.length < 2) return 0n;
    return BigInt('0x' + hex);
  } catch {
    return 0n;
  }
}

/** Get OP-20 totalSupply (returns 0n on failure) */
export async function getTokenTotalSupply(tokenAddress: string): Promise<bigint> {
  try {
    const TOTAL_SUPPLY_SELECTOR = '18160ddd';
    const result = await callContract(tokenAddress, TOTAL_SUPPLY_SELECTOR);
    if (!result) return 0n;
    const hex = result.startsWith('0x') ? result.slice(2) : result;
    if (!hex || hex.length < 2) return 0n;
    return BigInt('0x' + hex);
  } catch {
    return 0n;
  }
}

/** OP-20 storage slots (ERC-20 style) */
export const OP20_SLOTS = { NAME: 0, SYMBOL: 1, DECIMALS: 2, TOTAL_SUPPLY: 3, BALANCES: 4 } as const;

/** Decode storage value from RPC (value can be hex string or nested .value) */
function decodeStorageVal(val: unknown): string | number {
  if (val == null) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val.startsWith('0x')) {
      const n = BigInt(val);
      if (n < 256n) return Number(n); // decimals
      return val; // keep hex for big numbers, caller will use as totalSupply
    }
    return val;
  }
  const o = val as Record<string, unknown>;
  if (o.value !== undefined) return decodeStorageVal(o.value);
  if (typeof o.valueHex === 'string') {
    const hex = o.valueHex;
    if (hex.startsWith('0x')) return Number(BigInt(hex));
  }
  return String(val);
}

/** Fetch OP-20 token info (name, symbol, decimals, totalSupply) from chain via storage reads */
export async function getOP20Info(contractAddress: string): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
} | null> {
  try {
    const [nameR, symbolR, decimalsR, totalSupplyR] = await Promise.all([
      getStorageAt(contractAddress, OP20_SLOTS.NAME, false),
      getStorageAt(contractAddress, OP20_SLOTS.SYMBOL, false),
      getStorageAt(contractAddress, OP20_SLOTS.DECIMALS, false),
      getStorageAt(contractAddress, OP20_SLOTS.TOTAL_SUPPLY, false),
    ]);
    const name = decodeStorageVal(nameR) as string;
    const symbol = decodeStorageVal(symbolR) as string;
    const decimals = Number(decodeStorageVal(decimalsR)) || 0;
    const totalSupply = String(decodeStorageVal(totalSupplyR));
    return { name: name || 'Unknown', symbol: symbol || '?', decimals, totalSupply: totalSupply || '0' };
  } catch {
    return null;
  }
}

/** Format satoshis to human-readable string */
export function formatSats(sats: number | bigint): string {
  const n = typeof sats === 'bigint' ? Number(sats) : sats;
  if (n >= 1e8) return (n / 1e8).toFixed(4) + ' BTC';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M sats';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K sats';
  return Math.floor(n) + ' sats';
}
