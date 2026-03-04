/**
 * Centralized network config for OPNet Hub.
 *
 * OPNet testnet is a Signet fork — uses `networks.opnetTestnet` (bech32: "opt").
 * DO NOT use `networks.testnet` — that's Bitcoin Testnet4, NOT OPNet.
 */
import { networks } from '@btc-vision/bitcoin';

export const NETWORK = networks.opnetTestnet;
export const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';
