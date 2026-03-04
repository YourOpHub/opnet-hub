import { describe, it, expect } from 'vitest';
import { NETWORK, RPC_URL } from '../config';

describe('config', () => {
  it('exports NETWORK as opnetTestnet with bech32 prefix "opt"', () => {
    expect(NETWORK).toBeDefined();
    expect(NETWORK.bech32).toBe('opt');
  });

  it('exports RPC_URL pointing to testnet.opnet.org', () => {
    expect(RPC_URL).toContain('testnet.opnet.org');
    expect(RPC_URL).toContain('json-rpc');
  });

  it('NETWORK is NOT bitcoin testnet4 (bech32 "tb")', () => {
    expect(NETWORK.bech32).not.toBe('tb');
  });
});
