/**
 * OP_NET RPC Wrapper — browser-compatible
 *
 * The `opnet` npm package (JSONRpcProvider) is designed for Node.js
 * and uses undici for HTTP. For the browser frontend, we use fetch
 * directly against the OP_NET JSON-RPC API.
 *
 * API Docs: https://docs.opnet.org/getting-started/quick-start-guide/browser-vs-nodejs-usage
 */

export const RPC_URL = 'https://regtest.opnet.org/api/v1/json-rpc';

interface RpcResponse {
    result?: any;
    error?: { message: string };
}

async function rpc(method: string, params: any[] = []): Promise<any> {
    try {
        const res = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        });
        const data: RpcResponse = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
    } catch (e) {
        console.warn(`[OP_NET RPC] ${method} failed:`, e);
        return null;
    }
}

/** Get current block height from OP_NET node */
export async function getBlockHeight(): Promise<number> {
    const r = await rpc('btc_blockNumber');
    return typeof r === 'number' ? r : 0;
}

/** Get chain info */
export async function getChainId(): Promise<number> {
    const r = await rpc('btc_chainId');
    return typeof r === 'number' ? r : 0;
}

/** Format satoshis to human-readable string */
export function formatSats(sats: number | bigint): string {
    const n = typeof sats === 'bigint' ? Number(sats) : sats;
    if (n >= 1e8) return (n / 1e8).toFixed(4) + ' BTC';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M sats';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K sats';
    return Math.floor(n) + ' sats';
}
