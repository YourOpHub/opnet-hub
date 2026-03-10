/**
 * contractCache.test.ts -- Tests for src/contractCache.ts
 *
 * Covers: getProvider (singleton), getCachedOP20, getCachedMintable,
 *         getCachedContract, MINTABLE_ABI export.
 *
 * All OPNet SDK functions are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Track calls externally
const mockGetContract = vi.fn();
const mockProviderCtor = vi.fn();
const mockFromString = vi.fn((addr: string) => ({ toString: () => addr, _addr: addr }));

vi.mock('opnet', () => {
  let contractCounter = 0;
  return {
    JSONRpcProvider: class MockJSONRpcProvider {
      url: string;
      _id: string;
      constructor(config: Record<string, unknown>) {
        mockProviderCtor(config);
        this.url = config.url as string;
        this._id = 'provider-singleton';
      }
    },
    getContract: (...args: unknown[]) => {
      mockGetContract(...args);
      contractCounter++;
      return {
        _id: `contract-${contractCounter}`,
        setSender: vi.fn(),
        balanceOf: vi.fn(),
      };
    },
    OP_20_ABI: [{ name: 'balanceOf' }],
    ABIDataTypes: { UINT256: 'UINT256' },
    BitcoinAbiTypes: { Function: 'Function' },
  };
});

vi.mock('@btc-vision/transaction', () => ({
  Address: {
    fromString: (addr: string) => mockFromString(addr),
  },
}));

vi.mock('../config', () => ({
  NETWORK: { bech32: 'opt' },
  RPC_URL: 'https://testnet.opnet.org/api/v1/json-rpc',
}));

describe('contractCache', () => {
  let mod: typeof import('../contractCache');

  beforeEach(async () => {
    vi.resetModules();
    mockGetContract.mockClear();
    mockProviderCtor.mockClear();
    mockFromString.mockClear();
    mod = await import('../contractCache');
  });

  describe('getProvider', () => {
    it('returns a JSONRpcProvider instance', () => {
      const provider = mod.getProvider();
      expect(provider).toBeDefined();
      expect(mockProviderCtor).toHaveBeenCalledTimes(1);
    });

    it('returns the same instance on subsequent calls (singleton)', () => {
      const p1 = mod.getProvider();
      const p2 = mod.getProvider();
      expect(p1).toBe(p2);
      expect(mockProviderCtor).toHaveBeenCalledTimes(1);
    });

    it('passes correct config to JSONRpcProvider', () => {
      mod.getProvider();
      expect(mockProviderCtor).toHaveBeenCalledWith({
        url: 'https://testnet.opnet.org/api/v1/json-rpc',
        network: { bech32: 'opt' },
      });
    });
  });

  describe('MINTABLE_ABI', () => {
    it('exports MINTABLE_ABI with publicMint function', () => {
      expect(mod.MINTABLE_ABI).toBeDefined();
      expect(Array.isArray(mod.MINTABLE_ABI)).toBe(true);
      expect(mod.MINTABLE_ABI.length).toBe(1);
      expect(mod.MINTABLE_ABI[0]!.name).toBe('publicMint');
    });
  });

  describe('getCachedOP20', () => {
    it('creates a new contract on first call', () => {
      const contract = mod.getCachedOP20('opt1abc');
      expect(contract).toBeDefined();
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('returns cached contract on second call with same address', () => {
      const c1 = mod.getCachedOP20('opt1abc');
      const c2 = mod.getCachedOP20('opt1abc');
      expect(c1).toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('creates different contracts for different addresses', () => {
      const c1 = mod.getCachedOP20('opt1abc');
      const c2 = mod.getCachedOP20('opt1def');
      expect(c1).not.toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(2);
    });

    it('calls setSender when sender provided on cached contract', () => {
      const c1 = mod.getCachedOP20('opt1xyz');
      const c2 = mod.getCachedOP20('opt1xyz', 'opt1sender');
      expect(c1).toBe(c2);
      expect((c2 as { setSender: ReturnType<typeof vi.fn> }).setSender).toHaveBeenCalled();
    });

    it('passes sender to getContract on first call when sender provided', () => {
      mod.getCachedOP20('opt1new', 'opt1sender');
      expect(mockGetContract).toHaveBeenCalledTimes(1);
      expect(mockFromString).toHaveBeenCalledWith('opt1sender');
    });

    it('does not call setSender on first call without sender', () => {
      const c1 = mod.getCachedOP20('opt1nosender');
      expect((c1 as { setSender: ReturnType<typeof vi.fn> }).setSender).not.toHaveBeenCalled();
    });
  });

  describe('getCachedMintable', () => {
    it('creates a contract with MINTABLE_ABI', () => {
      const contract = mod.getCachedMintable('opt1mint');
      expect(contract).toBeDefined();
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('caches mintable contracts by address', () => {
      const c1 = mod.getCachedMintable('opt1mint');
      const c2 = mod.getCachedMintable('opt1mint');
      expect(c1).toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('calls setSender on cached mintable contract', () => {
      mod.getCachedMintable('opt1mint2');
      const c2 = mod.getCachedMintable('opt1mint2', 'opt1sender');
      expect((c2 as { setSender: ReturnType<typeof vi.fn> }).setSender).toHaveBeenCalled();
    });

    it('does not interfere with OP20 cache', () => {
      mod.getCachedOP20('opt1same');
      mod.getCachedMintable('opt1same');
      // Two different caches, so two getContract calls
      expect(mockGetContract).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCachedContract', () => {
    it('creates a contract with custom ABI', () => {
      const abi = [{ name: 'swap' }, { name: 'getReserves' }] as unknown as import('opnet').BitcoinInterfaceAbi;
      const contract = mod.getCachedContract('opt1pool', abi);
      expect(contract).toBeDefined();
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('uses address + ABI fingerprint as cache key', () => {
      const abi1 = [{ name: 'swap' }] as unknown as import('opnet').BitcoinInterfaceAbi;
      const abi2 = [{ name: 'stake' }] as unknown as import('opnet').BitcoinInterfaceAbi;

      const c1 = mod.getCachedContract('opt1pool', abi1);
      const c2 = mod.getCachedContract('opt1pool', abi2);
      expect(c1).not.toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(2);
    });

    it('same address + same ABI returns cached', () => {
      const abi = [{ name: 'swap' }] as unknown as import('opnet').BitcoinInterfaceAbi;
      const c1 = mod.getCachedContract('opt1pool', abi);
      const c2 = mod.getCachedContract('opt1pool', abi);
      expect(c1).toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(1);
    });

    it('calls setSender on cached generic contract', () => {
      const abi = [{ name: 'swap' }] as unknown as import('opnet').BitcoinInterfaceAbi;
      mod.getCachedContract('opt1gen', abi);
      const c2 = mod.getCachedContract('opt1gen', abi, 'opt1sender');
      expect((c2 as { setSender: ReturnType<typeof vi.fn> }).setSender).toHaveBeenCalled();
    });

    it('different addresses with same ABI are cached separately', () => {
      const abi = [{ name: 'swap' }] as unknown as import('opnet').BitcoinInterfaceAbi;
      const c1 = mod.getCachedContract('opt1a', abi);
      const c2 = mod.getCachedContract('opt1b', abi);
      expect(c1).not.toBe(c2);
      expect(mockGetContract).toHaveBeenCalledTimes(2);
    });
  });

  describe('re-exports', () => {
    it('re-exports NETWORK from config', () => {
      expect(mod.NETWORK).toEqual({ bech32: 'opt' });
    });

    it('re-exports RPC_URL from config', () => {
      expect(mod.RPC_URL).toBe('https://testnet.opnet.org/api/v1/json-rpc');
    });
  });
});
