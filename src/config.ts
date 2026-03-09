/**
 * Centralized network config for OPNet Hub.
 *
 * OPNet testnet is a Signet fork — uses `networks.opnetTestnet` (bech32: "opt").
 * DO NOT use `networks.testnet` — that's Bitcoin Testnet4, NOT OPNet.
 *
 * Set VITE_NETWORK env var to switch: 'testnet' (default) | 'mainnet' | 'regtest'
 */
import { networks } from '@btc-vision/bitcoin';

export type OPNetEnv = 'testnet' | 'mainnet' | 'regtest';

const ENV_NETWORK = (import.meta.env.VITE_NETWORK || 'testnet') as OPNetEnv;

const NETWORK_MAP = {
  testnet: networks.opnetTestnet,
  mainnet: networks.bitcoin,
  regtest: networks.regtest,
} as const;

const RPC_MAP: Record<OPNetEnv, string> = {
  testnet: 'https://testnet.opnet.org/api/v1/json-rpc',
  mainnet: 'https://mainnet.opnet.org/api/v1/json-rpc',
  regtest: 'https://regtest.opnet.org/api/v1/json-rpc',
};

const OPSCAN_NETWORK_MAP: Record<OPNetEnv, string> = {
  testnet: 'op_testnet',
  mainnet: 'op_mainnet',
  regtest: 'op_regtest',
};

export const CURRENT_ENV: OPNetEnv = ENV_NETWORK;
export const NETWORK = NETWORK_MAP[ENV_NETWORK];
export const RPC_URL = import.meta.env.VITE_RPC_URL || RPC_MAP[ENV_NETWORK];
export const OPSCAN_NETWORK = OPSCAN_NETWORK_MAP[ENV_NETWORK];
