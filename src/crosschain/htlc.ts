/**
 * HTLC utilities for cross-chain atomic swaps.
 * Uses Web Crypto API (browser-native, no dependencies).
 */

/** Generate a cryptographically secure 32-byte preimage */
export function generatePreimage(): Uint8Array {
  const preimage = new Uint8Array(32);
  crypto.getRandomValues(preimage);
  return preimage;
}

/** Compute SHA256 hashlock from a preimage (async — uses Web Crypto) */
export async function computeHashlock(preimage: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', preimage as unknown as ArrayBuffer);
  return new Uint8Array(hash);
}

/** Convert Uint8Array to hex string */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convert hex string to Uint8Array */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert hex to BigInt for contract calls */
export function hexToBigInt(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex : '0x' + hex;
  return BigInt(clean);
}

/** Convert BigInt to 64-char hex (32 bytes, zero-padded) */
export function bigIntToHex(val: bigint): string {
  return val.toString(16).padStart(64, '0');
}

/** Generate preimage + hashlock pair for HTLC creation */
export async function generateHTLCPair(): Promise<{ preimage: string; hashlock: string }> {
  const preimageBytes = generatePreimage();
  const hashlockBytes = await computeHashlock(preimageBytes);
  return {
    preimage: toHex(preimageBytes),
    hashlock: toHex(hashlockBytes),
  };
}

/** Verify that a preimage matches a hashlock */
export async function verifyPreimage(preimageHex: string, hashlockHex: string): Promise<boolean> {
  const preimage = fromHex(preimageHex);
  const computed = await computeHashlock(preimage);
  return toHex(computed) === (hashlockHex.startsWith('0x') ? hashlockHex.slice(2) : hashlockHex);
}

/** Format block countdown as human-readable time estimate */
export function formatBlockCountdown(blocksRemaining: number, blockTimeMinutes = 10): string {
  if (blocksRemaining <= 0) return 'Expired';
  const totalMinutes = blocksRemaining * blockTimeMinutes;
  if (totalMinutes < 60) return `~${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return `~${hours}h ${mins > 0 ? mins + 'm' : ''}`.trim();
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `~${days}d ${remHours > 0 ? remHours + 'h' : ''}`.trim();
}

/** Truncate a hex string for display (e.g., "a1b2c3...f4e5d6") */
export function truncateHex(hex: string, chars = 6): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length <= chars * 2) return clean;
  return `${clean.slice(0, chars)}...${clean.slice(-chars)}`;
}
