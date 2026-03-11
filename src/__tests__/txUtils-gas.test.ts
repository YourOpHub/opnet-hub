/**
 * txUtils-gas.test.ts -- Tests for buildTxParams, getMinBtcRequired, waitForNextBlock
 * in src/txUtils.ts
 *
 * Mocks the SDK provider to test gas parameter logic.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('opnet', () => ({
  getContract: vi.fn(),
  OP_20_ABI: {},
}));

vi.mock('@btc-vision/transaction', () => ({
  Address: {
    fromString: vi.fn((s: string) => s),
  },
}));

import { buildTxParams, getMinBtcRequired, waitForNextBlock } from '../txUtils';

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    gasParameters: vi.fn().mockResolvedValue({
      bitcoin: {
        recommended: {
          low: 2,
          medium: 5,
          high: 10,
        },
        conservative: 3,
      },
      gasPerSat: 1000000n,
      baseGas: 500000000n,
    }),
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    ...overrides,
  } as any;
}

describe('buildTxParams', () => {
  it('returns transaction parameters with correct shape', async () => {
    const provider = makeProvider();
    const params = await buildTxParams(provider, 'opt1refund');
    // Frontend: signer/mldsaSigner must be ABSENT — wallet extension injects them
    expect(params).not.toHaveProperty('signer');
    expect(params).not.toHaveProperty('mldsaSigner');
    expect(params).toHaveProperty('refundTo', 'opt1refund');
    expect(typeof params.feeRate).toBe('number');
    expect(typeof params.priorityFee).toBe('bigint');
    expect(typeof params.maximumAllowedSatToSpend).toBe('bigint');
    expect(params.network).toBeDefined();
  });

  it('uses low fee rate for testnet', async () => {
    const provider = makeProvider();
    const params = await buildTxParams(provider, 'opt1refund');
    // Testnet prefers low (2) over medium (5)
    expect(params.feeRate).toBe(2);
  });

  it('uses maximumAllowedSatToSpend of 50_000 for testnet', async () => {
    const provider = makeProvider();
    const params = await buildTxParams(provider, 'opt1refund');
    expect(params.maximumAllowedSatToSpend).toBe(50_000n);
  });

  it('clamps priorityFee to minimum 500n', async () => {
    // baseGas/gasPerSat = 500000000n / 1000000n = 500n, which IS 500, so no clamping needed
    const provider = makeProvider({
      gasParameters: vi.fn().mockResolvedValue({
        bitcoin: { recommended: { low: 2, medium: 5, high: 10 }, conservative: 3 },
        gasPerSat: 10000000000n, // very high: baseGas/gasPerSat = very low
        baseGas: 100n,
      }),
    });
    const params = await buildTxParams(provider, 'opt1refund');
    // 100n / 10000000000n = 0n, clamped to 500n
    expect(params.priorityFee).toBeGreaterThanOrEqual(500n);
  });

  it('handles gasPerSat of 0 (uses 1n)', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockResolvedValue({
        bitcoin: { recommended: { low: 1 }, conservative: 1 },
        gasPerSat: 0n,
        baseGas: 1000n,
      }),
    });
    const params = await buildTxParams(provider, 'opt1refund');
    // gasPerSat = 0 => use 1n, priorityFee = 1000n / 1n = 1000n
    expect(params.priorityFee).toBe(1000n);
  });

  it('clamps priorityFee to max 10_000n on testnet', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockResolvedValue({
        bitcoin: { recommended: { low: 2 }, conservative: 2 },
        gasPerSat: 1n,
        baseGas: 100_000n,
      }),
    });
    const params = await buildTxParams(provider, 'opt1refund');
    // 100_000n / 1n = 100_000n, clamped to 10_000n on testnet
    expect(params.priorityFee).toBe(10_000n);
  });
});

describe('getMinBtcRequired', () => {
  it('returns min sats for interaction', async () => {
    const provider = makeProvider();
    const result = await getMinBtcRequired(provider, 'interaction');
    expect(result.minSats).toBeGreaterThan(0n);
    expect(typeof result.feeRate).toBe('number');
    expect(typeof result.label).toBe('string');
    expect(result.label).toContain('sats');
  });

  it('returns higher min sats for deploy', async () => {
    const provider = makeProvider();
    const interact = await getMinBtcRequired(provider, 'interaction');
    const deploy = await getMinBtcRequired(provider, 'deploy');
    expect(deploy.minSats).toBeGreaterThan(interact.minSats);
  });

  it('deploy label contains K sats', async () => {
    const provider = makeProvider();
    const result = await getMinBtcRequired(provider, 'deploy');
    expect(result.label).toContain('K sats');
  });

  it('returns fallback on error', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockRejectedValue(new Error('RPC error')),
    });
    const result = await getMinBtcRequired(provider, 'interaction');
    expect(result.minSats).toBe(5_000n);
    expect(result.feeRate).toBe(2);
    expect(result.label).toContain('5K sats');
  });

  it('returns deploy fallback on error', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockRejectedValue(new Error('RPC error')),
    });
    const result = await getMinBtcRequired(provider, 'deploy');
    expect(result.minSats).toBe(110_000n);
    expect(result.label).toContain('110K sats');
  });

  it('defaults to interaction when no opType specified', async () => {
    const provider = makeProvider();
    const result = await getMinBtcRequired(provider);
    expect(result.minSats).toBeLessThan(100_000n);
  });

  it('handles gasPerSat of 0', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockResolvedValue({
        bitcoin: { recommended: { low: 2, medium: 5 }, conservative: 3 },
        gasPerSat: 0n,
        baseGas: 500000000n,
      }),
    });
    const result = await getMinBtcRequired(provider, 'interaction');
    // gasPerSat=0 => use 1_000_000n, priorityFee = 500000000n/1000000n = 500
    expect(result.minSats).toBeGreaterThan(0n);
  });

  it('clamps priorityFee to minimum 500n for interaction', async () => {
    const provider = makeProvider({
      gasParameters: vi.fn().mockResolvedValue({
        bitcoin: { recommended: { low: 1 }, conservative: 1 },
        gasPerSat: 10000000000n,
        baseGas: 100n,
      }),
    });
    const result = await getMinBtcRequired(provider, 'interaction');
    // priorityFee = 100/10000000000 = 0, clamped to 500
    // minSats = 250*1 + 500 + 546 = 1296
    expect(result.minSats).toBeGreaterThanOrEqual(1296n);
  });
});

describe('waitForNextBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('returns immediately if getBlockNumber fails initially', async () => {
    const provider = makeProvider({
      getBlockNumber: vi.fn().mockRejectedValue(new Error('RPC error')),
    });
    // Should return without waiting
    await waitForNextBlock(provider, undefined, 100);
  });

  it('calls setStep callback during waiting', async () => {
    let blockNumber = 100n;
    const provider = makeProvider({
      getBlockNumber: vi.fn().mockImplementation(() => Promise.resolve(blockNumber)),
    });
    const setStep = vi.fn();

    const waitPromise = waitForNextBlock(provider, setStep, 20_000);

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(8_000);
    // Now advance block
    blockNumber = 101n;
    await vi.advanceTimersByTimeAsync(8_000);

    await waitPromise;
    expect(setStep).toHaveBeenCalled();
  });
});
