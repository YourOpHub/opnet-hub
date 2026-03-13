/**
 * crossChainShared — shared types, constants, and utility functions
 * for the CrossChain hooks family.
 *
 * Imported by: useCrossChainState, useFractalSwap, useTokenEscrow, useCrossChain
 */

import { DEPLOYED_CONTRACTS, type ContractTokenInfo } from '../contracts';
import { Address } from '@btc-vision/transaction';
import { NETWORK } from '../config';
import { bech32m } from 'bech32';

/** Token options for the bridge */
export const TOKEN_OPTIONS = (Object.entries(DEPLOYED_CONTRACTS) as [string, ContractTokenInfo][]).map(([sym, tok]) => ({
  symbol: sym,
  address: tok.address,
  pubkey: tok.pubkey,
  icon: tok.icon,
  decimals: tok.decimals,
}));

/** Direction constants for token escrow */
export const DIR_SELL_TOKEN = 1; // Maker locks tokens, wants BTC
export const DIR_BUY_TOKEN = 2;  // Maker posts intent to buy tokens with BTC

export type BridgeMode = 'fractalswap' | 'tokenbridge';

/** Token escrow order type */
export interface TokenEscrowOrder {
  id: string;
  direction: number; // 1=sell_token, 2=buy_token
  status: number;
  creator: string;
  taker: string;
  tokenHex: string; // token contract address as hex
  tokenAmount: bigint;
  btcPrice: bigint; // in sats
  hashlock: string;
  preimage: string;
  expiry: number;
  makerAddr: string;
  takerAddr: string;
  feePaid: bigint;
}

/** Resolve token hex back to known token info */
export function resolveToken(tokenHex: string): { symbol: string; icon: string; decimals: number; address: string } | null {
  for (const tok of TOKEN_OPTIONS) {
    const pubHex: string = tok.pubkey.replace('0x', '').toLowerCase();
    if (tokenHex.toLowerCase() === pubHex || tokenHex.toLowerCase().endsWith(pubHex.slice(-32))) {
      return { symbol: tok.symbol, icon: tok.icon, decimals: tok.decimals, address: tok.address };
    }
  }
  return null;
}

/** Build P2OP scriptPubKey from 64-char MLDSA hex */
export function buildP2OPScript(mldsaHex: string): Buffer {
  const bytes = new Uint8Array(34);
  bytes[0] = 0x60; // OP_16
  bytes[1] = 0x20; // PUSH_32
  for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Buffer.from(bytes);
}

/** Get P2OP bech32m address from 64-char MLDSA hex */
export function getP2OPAddress(mldsaHex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(mldsaHex.slice(i * 2, i * 2 + 2), 16);
  return Address.wrap(bytes).p2op(NETWORK);
}

/**
 * Encode a Fractal/Bitcoin bech32m address (P2TR) into a u256 bigint.
 * Stores the 32-byte witness program directly — fits exactly in u256.
 * Supports P2TR (Taproot, version 1) addresses: bc1p... (Fractal) and opt1p... (OPNet).
 */
export function encodeFractalAddr(addr: string): bigint {
  let decoded;
  try {
    decoded = bech32m.decode(addr, 90);
  } catch {
    throw new Error(`Invalid address format: "${addr}". Expected a Taproot address (bc1p... or opt1p...)`);
  }
  const version = decoded.words[0];
  const program = bech32m.fromWords(decoded.words.slice(1));
  if (version !== 1 || program.length !== 32) {
    throw new Error(`Only Taproot (P2TR) addresses supported. Got version ${version}, program length ${program.length}`);
  }
  let result = 0n;
  for (let i = 0; i < 32; i++) result = (result << 8n) | BigInt(program[i] ?? 0);
  return result;
}

/** Validate a Fractal/Bitcoin/OPNet P2TR address. Returns error message or empty string if valid. */
export function validateFractalAddr(addr: string): string {
  if (!addr) return '';
  try {
    encodeFractalAddr(addr);
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid address';
  }
}

/**
 * Decode a u256 hex (64 chars) back to a Fractal/Bitcoin P2TR bech32m address.
 * Returns empty string if the hex is all zeros.
 */
export function decodeFractalAddr(hex64: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex64.slice(i * 2, i * 2 + 2), 16);
  if (bytes.every(b => b === 0)) return '';
  // Fractal Bitcoin always uses 'bc' prefix (bc1p...) regardless of OPNet env
  const words = [1, ...bech32m.toWords(bytes)];
  return bech32m.encode('bc', words, 90);
}
