/**
 * Shared transaction utilities for OPNet frontend.
 * 
 * Key pattern (from Bob's docs):
 * 1. Check existing allowance — skip approval if sufficient
 * 2. If needed, send increaseAllowance(max_uint256) — one-time infinite approval
 * 3. Wait for next block (poll getBlockNumber) — NOT polling allowance
 * 4. Proceed with operation
 */
import { JSONRpcProvider, getContract, OP_20_ABI, BitcoinUtils, type IOP20Contract, type CallResult } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const NETWORK = networks.testnet;
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<any> {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { signer: null, mldsaSigner: null, refundTo, maximumAllowedSatToSpend: 250_000n, network: NETWORK, feeRate, priorityFee } as any;
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw new Error('Retry exhausted');
}

/**
 * Wait for the next block on-chain (Bob's recommended pattern).
 * Polls getBlockNumber every 10s until it advances past startBlock.
 * Returns immediately if block advances. After timeout, returns anyway (best-effort).
 */
export async function waitForNextBlock(
  provider: JSONRpcProvider,
  setStep?: (s: string) => void,
  timeoutMs = 90_000,
): Promise<void> {
  let startBlock: bigint;
  try { startBlock = await provider.getBlockNumber(); } catch { return; }
  
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 8_000));
    const elapsed = Math.round((Date.now() - start) / 1000);
    setStep?.(`Waiting for block confirmation... (${elapsed}s)`);
    try {
      const current = await provider.getBlockNumber();
      if (current > startBlock) return;
    } catch { /* retry */ }
  }
  // Timeout — proceed anyway (best-effort)
  console.warn('[txUtils] Block wait timeout, proceeding anyway');
}

/**
 * Ensure token has sufficient allowance for spender.
 * If not, sends increaseAllowance(max_uint256) and waits for next block.
 * Returns true if approval was needed (and sent), false if already sufficient.
 */
export async function ensureAllowance(
  tokenAddress: string,
  spenderPubkey: string,
  amount: bigint,
  provider: JSONRpcProvider,
  senderAddr: string,
  walletAddress: string,
  setStep: (s: string) => void,
  tokenLabel = 'token',
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenContract = getContract<IOP20Contract>(tokenAddress, OP_20_ABI, provider, NETWORK, senderAddr as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spenderAddr = Address.fromString(spenderPubkey) as any;

  // Check existing allowance
  setStep(`Checking ${tokenLabel} allowance...`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowanceRes = await tokenContract.allowance(senderAddr as any, spenderAddr);
    if (!(allowanceRes as CallResult).revert) {
      const props = (allowanceRes as CallResult).properties as Record<string, unknown>;
      const cur = props?.remaining ? BigInt(String(props.remaining)) : 0n;
      if (cur >= amount) {
        setStep('');
        return false; // Already approved
      }
    }
  } catch { /* proceed with approval */ }

  // Send increaseAllowance(max_uint256)
  setStep(`Approving ${tokenLabel}...`);
  const approveSim = await withRetry(() => tokenContract.increaseAllowance(spenderAddr, MAX_UINT256));
  if ((approveSim as CallResult).revert) throw new Error(`${tokenLabel} approval failed: ${(approveSim as CallResult).revert}`);
  const tp = await buildTxParams(provider, walletAddress);
  await (approveSim as CallResult).sendTransaction(tp);

  // Wait for next block (Bob's recommended pattern)
  await waitForNextBlock(provider, setStep);

  return true; // Approval was sent
}

/**
 * Format user-friendly error messages for common OPNet issues.
 */
export function formatTxError(e: unknown): string {
  let msg = e instanceof Error ? e.message : 'Transaction failed';
  const lower = msg.toLowerCase();
  if (lower.includes('no utxo')) return 'No BTC UTXOs. Get testnet BTC first.';
  if (lower.includes('insufficient allowance') || lower.includes('allowance')) return 'Allowance not yet confirmed. Please wait ~30s and try again (approval already sent).';
  if (lower.includes('timeout') || lower.includes('fetch')) return 'Network timeout — try again in a few seconds.';
  if (lower.includes('revert')) msg += ' (Try again — testnet can be flaky)';
  return msg;
}
