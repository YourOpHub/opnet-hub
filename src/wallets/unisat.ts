/**
 * UniSat Wallet integration for Fractal Bitcoin.
 *
 * UniSat injects `window.unisat` into every page.
 * Fractal Bitcoin uses the same address format as Bitcoin (tb1... for testnet, bc1... for mainnet).
 * We use switchChain() to target the Fractal network.
 */

/* ── Types ── */

export interface UnisatBalance {
    confirmed: number;
    unconfirmed: number;
    total: number;
}

export interface UnisatChain {
    enum: string;
    name: string;
    network: string;
}

export interface UnisatProvider {
    requestAccounts(): Promise<string[]>;
    getAccounts(): Promise<string[]>;
    getPublicKey(): Promise<string>;
    getBalance(): Promise<UnisatBalance>;
    getNetwork(): Promise<string>;
    switchNetwork(network: 'livenet' | 'testnet'): Promise<void>;
    getChain(): Promise<UnisatChain>;
    switchChain(chain: string): Promise<UnisatChain>;
    sendBitcoin(
        to: string,
        sats: number,
        opts?: { feeRate?: number; memo?: string; memos?: string[] },
    ): Promise<string>;
    signPsbt(
        hex: string,
        opts?: {
            autoFinalized?: boolean;
            toSignInputs?: Array<{
                index: number;
                address?: string;
                publicKey?: string;
                sighashTypes?: number[];
            }>;
        },
    ): Promise<string>;
    signMessage(msg: string, type?: 'ecdsa' | 'bip322-simple'): Promise<string>;
    pushPsbt(hex: string): Promise<string>;
    pushTx(opts: { rawtx: string }): Promise<string>;
    on(event: 'accountsChanged' | 'networkChanged', cb: (...args: unknown[]) => void): void;
    removeListener(event: string, cb: (...args: unknown[]) => void): void;
}

/* ── Chain identifiers ── */

export const FRACTAL_CHAINS = {
    MAINNET: 'FRACTAL_BITCOIN_MAINNET',
    TESTNET: 'FRACTAL_BITCOIN_TESTNET',
} as const;

/* ── Helpers ── */

export function getUnisat(): UnisatProvider | null {
    if (typeof window === 'undefined') return null;
    // Cast to avoid conflict with OPNet SDK's Unisat type on window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).unisat;
    return u ?? null;
}

export function isUnisatInstalled(): boolean {
    return getUnisat() !== null;
}

/* ── Connection state ── */

export interface UnisatWalletState {
    connected: boolean;
    address: string;
    publicKey: string;
    balance: UnisatBalance;
    chain: UnisatChain;
}

const EMPTY_STATE: UnisatWalletState = {
    connected: false,
    address: '',
    publicKey: '',
    balance: { confirmed: 0, unconfirmed: 0, total: 0 },
    chain: { enum: '', name: '', network: '' },
};

/**
 * Connect UniSat wallet and switch to Fractal testnet.
 * Returns wallet state or throws on user rejection.
 */
export async function connectUnisat(testnet = true): Promise<UnisatWalletState> {
    const unisat = getUnisat();
    if (!unisat) {
        throw new Error(
            'UniSat Wallet not installed. Get it at https://unisat.io/download',
        );
    }

    // Request account access
    const accounts = await unisat.requestAccounts();
    if (!accounts.length) throw new Error('No accounts returned');

    // Switch to Fractal
    const targetChain = testnet
        ? FRACTAL_CHAINS.TESTNET
        : FRACTAL_CHAINS.MAINNET;

    let chain: UnisatChain;
    try {
        chain = await unisat.switchChain(targetChain);
    } catch {
        // User may have rejected — try to get current chain
        chain = await unisat.getChain();
    }

    const [publicKey, balance] = await Promise.all([
        unisat.getPublicKey(),
        unisat.getBalance(),
    ]);

    // After switchChain, re-fetch accounts (address may differ per chain)
    const freshAccounts = await unisat.getAccounts();

    return {
        connected: true,
        address: freshAccounts[0] || accounts[0],
        publicKey,
        balance,
        chain,
    };
}

export function disconnectUnisat(): UnisatWalletState {
    return { ...EMPTY_STATE };
}

/**
 * Send Fractal BTC via UniSat wallet.
 * @returns txid
 */
export async function sendFractalBTC(
    to: string,
    sats: number,
    feeRate = 1,
): Promise<string> {
    const unisat = getUnisat();
    if (!unisat) throw new Error('UniSat not connected');
    return unisat.sendBitcoin(to, sats, { feeRate });
}

/**
 * Fractal Bitcoin explorers
 */
export const FRACTAL_EXPLORER = {
    testnet: 'https://mempool-testnet.fractalbitcoin.io',
    mainnet: 'https://mempool.fractalbitcoin.io',
} as const;

export function getFractalTxUrl(txid: string, testnet = true): string {
    const base = testnet ? FRACTAL_EXPLORER.testnet : FRACTAL_EXPLORER.mainnet;
    return `${base}/tx/${txid}`;
}

export function getFractalAddressUrl(address: string, testnet = true): string {
    const base = testnet ? FRACTAL_EXPLORER.testnet : FRACTAL_EXPLORER.mainnet;
    return `${base}/address/${address}`;
}
