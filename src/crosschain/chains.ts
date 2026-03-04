/** Extensible chain registry for cross-chain swaps */

export interface L2Chain {
  id: number;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  type: 'utxo' | 'evm';
  settlement: 'htlc' | 'relayer';
  addressRegex: RegExp;
  addressPlaceholder: string;
  explorerUrl: string;
  nativeAsset: string;
  testnetAvailable: boolean;
}

/**
 * Supported chains for cross-chain swaps.
 * Adding a new chain = just add an entry here + address validation.
 * HTLC chains work immediately (same SHA256 hashlock pattern).
 */
export const SUPPORTED_CHAINS: L2Chain[] = [
  {
    id: 1,
    name: 'Fractal Bitcoin',
    shortName: 'Fractal',
    icon: '\u{1F300}',  // spiral emoji
    color: '#8b5cf6',
    type: 'utxo',
    settlement: 'htlc',
    // Fractal uses same address formats as Bitcoin: bc1.../fb1.../tb1...
    addressRegex: /^(bc1|fb1|tb1)[a-z0-9]{25,90}$/i,
    addressPlaceholder: 'fb1q... or bc1q...',
    explorerUrl: 'https://explorer.fractalbitcoin.io',
    nativeAsset: 'FB-BTC',
    testnetAvailable: true,
  },
];

/** Lookup chain by ID */
export function getChainById(id: number): L2Chain | undefined {
  return SUPPORTED_CHAINS.find(c => c.id === id);
}

/** Validate address format for a given chain */
export function validateAddress(chainId: number, address: string): boolean {
  const chain = getChainById(chainId);
  if (!chain) return false;
  return chain.addressRegex.test(address);
}

/** Get explorer link for a transaction on target chain */
export function getChainTxUrl(chainId: number, txid: string): string {
  const chain = getChainById(chainId);
  if (!chain) return '#';
  return `${chain.explorerUrl}/tx/${txid}`;
}

/** Get explorer link for an address on target chain */
export function getChainAddressUrl(chainId: number, address: string): string {
  const chain = getChainById(chainId);
  if (!chain) return '#';
  return `${chain.explorerUrl}/address/${address}`;
}

/** Suggested expiry blocks for HTLC (OPNet side, should be >= 2x target chain timeout) */
export function suggestedExpiryBlocks(chainId: number): { min: number; default: number; max: number } {
  const chain = getChainById(chainId);
  if (!chain) return { min: 72, default: 144, max: 576 };
  // Fractal ~10min blocks like Bitcoin, OPNet ~10min blocks
  // Min 72 blocks (~12h), default 144 (~24h), max 576 (~4 days)
  return { min: 72, default: 144, max: 576 };
}
