/**
 * Shared transaction utilities for OPNet frontend.
 * 
 * Key pattern (from Bob's docs):
 * 1. Check existing allowance — skip approval if sufficient
 * 2. If needed, send increaseAllowance(max_uint256) — one-time infinite approval
 * 3. Wait for next block (poll getBlockNumber) — NOT polling allowance
 * 4. Proceed with operation
 */
import { type JSONRpcProvider, getContract, OP_20_ABI, type IOP20Contract, type CallResult, type TransactionParameters } from 'opnet';
import { logger } from './logger';
import { Address } from '@btc-vision/transaction';
import { NETWORK, CURRENT_ENV } from './config';
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

/**
 * Transaction parameters for OPNet frontend.
 * signer/mldsaSigner are set to null — the wallet extension injects real signers
 * before the transaction is broadcast. Backend TXs override these with real keys.
 */
export type TxParams = TransactionParameters;

// Session-level cache: tracks tokens already approved this session (tokenAddr:spenderAddr)
const approvedThisSession = new Set<string>();

/**
 * Build transaction parameters from live gas data. Frontend mode: signer/mldsaSigner are null (wallet injects).
 * @param provider - JSON-RPC provider for gas parameter queries.
 * @param refundTo - Wallet address for change outputs.
 * @returns Transaction parameters ready for sendTransaction().
 */
export async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<TxParams> {
  const gas = await provider.gasParameters();
  const isMainnet = CURRENT_ENV === 'mainnet';
  const feeRate = isMainnet
    ? (gas.bitcoin.recommended.medium || gas.bitcoin.recommended.low || gas.bitcoin.conservative || 5)
    : (gas.bitcoin.recommended.low || gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 2);
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const maxPriority = isMainnet ? 100_000n : 10_000n;
  const priorityFee = priorityFeeSats < 500n ? 500n : priorityFeeSats > maxPriority ? maxPriority : priorityFeeSats;
  const maxSats = isMainnet ? 200_000n : 50_000n;
  // Frontend: signer/mldsaSigner null — wallet extension injects real signers
  return { signer: null, mldsaSigner: null, refundTo, maximumAllowedSatToSpend: maxSats, network: NETWORK, feeRate, priorityFee };
}

/**
 * Retry an async operation with delay between attempts.
 * @param fn - Async function to retry
 * @param retries - Number of retry attempts (default: 2)
 * @param delayMs - Delay between retries in ms (default: 2000)
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw new Error('Retry exhausted');
}

/**
 * Wait for the next on-chain block by polling getBlockNumber every 8s.
 * @param provider - JSON-RPC provider.
 * @param setStep - Optional callback for progress updates.
 * @param timeoutMs - Max wait time in ms (default 60s). Proceeds anyway on timeout.
 */
export async function waitForNextBlock(
  provider: JSONRpcProvider,
  setStep?: (s: string) => void,
  timeoutMs = 60_000,
): Promise<void> {
  let startBlock: bigint;
  try { startBlock = await provider.getBlockNumber(); } catch (e) { logger.warn('[txUtils] Failed to get initial block number for wait:', e); return; }
  
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 8_000));
    const elapsed = Math.round((Date.now() - start) / 1000);
    setStep?.(`Waiting for block confirmation... (${elapsed}s)`);
    try {
      const current = await provider.getBlockNumber();
      if (current > startBlock) return;
    } catch (e) { logger.warn('[txUtils] Block number poll failed, retrying:', e); }
  }
  // Timeout — proceed anyway (best-effort)
  logger.warn('[txUtils] Block wait timeout, proceeding anyway');
}

/**
 * Ensure OP20 token allowance is sufficient for a spender; approves max_uint256 if not.
 * @param tokenAddress - OP20 token contract address.
 * @param spenderPubkeyHex - Spender hex pubkey (e.g. '0xe3523...'), NOT bech32.
 * @param amount - Required allowance amount.
 * @param provider - JSON-RPC provider.
 * @param senderAddr - Sender Address or string.
 * @param walletAddress - Wallet address for refund outputs.
 * @param setStep - Callback for progress updates.
 * @param tokenLabel - Human-readable token name for UI messages.
 * @returns True if approval TX was sent, false if allowance was already sufficient.
 */
export async function ensureAllowance(
  tokenAddress: string,
  spenderPubkeyHex: string,   // MUST be hex pubkey like '0xe3523...' — NOT bech32
  amount: bigint,
  provider: JSONRpcProvider,
  senderAddr: Address | string,
  walletAddress: string,
  setStep: (s: string) => void,
  tokenLabel = 'token',
): Promise<boolean> {
  const cacheKey = `${tokenAddress}:${spenderPubkeyHex}`;

  // Session cache: if we already approved this token for this spender, skip
  if (approvedThisSession.has(cacheKey)) {
    setStep('');
    return false;
  }

  const senderAddress = senderAddr instanceof Address ? senderAddr : Address.fromString(senderAddr);
  const tokenContract = getContract<IOP20Contract>(tokenAddress, OP_20_ABI, provider, NETWORK, senderAddress);
  // SDK requires Address objects for ADDRESS-type parameters — NOT bech32 strings
  const spenderAddr = Address.fromString(spenderPubkeyHex);

  // Check existing allowance
  setStep(`Checking ${tokenLabel} allowance...`);
  try {
    const allowanceRes = await tokenContract.allowance(senderAddress, spenderAddr);
    const callRes = allowanceRes as CallResult;
    if (!callRes.revert) {
      const props = callRes.properties as Record<string, unknown>;
      const cur = props?.remaining ? BigInt(String(props.remaining)) : 0n;
      if (cur >= amount) {
        approvedThisSession.add(cacheKey);
        setStep('');
        return false; // Already approved
      }
    } else {
      logger.warn('[txUtils] Allowance check reverted:', callRes.revert);
    }
  } catch (e) {
    logger.warn('[txUtils] Allowance check failed, proceeding with approval:', e);
  }

  // Send increaseAllowance(max_uint256)
  setStep(`Approving ${tokenLabel}...`);
  const approveSim = await withRetry(() => tokenContract.increaseAllowance(spenderAddr, MAX_UINT256));
  const approveResult = approveSim as CallResult;
  if (approveResult.revert) throw new Error(`${tokenLabel} approval failed: ${approveResult.revert}`);
  const tp = await buildTxParams(provider, walletAddress);
  await approveResult.sendTransaction(tp);

  // Mark as approved in session cache
  approvedThisSession.add(cacheKey);

  // Wait for next block
  await waitForNextBlock(provider, setStep);

  return true; // Approval was sent
}

/**
 * Estimate minimum BTC (sats) required for a transaction using live gas parameters.
 * @param provider - JSON-RPC provider.
 * @param opType - 'interaction' or 'deploy' (deploy needs ~4x more sats).
 * @returns Object with minSats, feeRate, and a human-readable label.
 */
export async function getMinBtcRequired(
  provider: JSONRpcProvider,
  opType: 'interaction' | 'deploy' = 'interaction',
): Promise<{ minSats: bigint; feeRate: number; label: string }> {
  try {
    const gas = await provider.gasParameters();
    const feeRate = gas.bitcoin.recommended.low || gas.bitcoin.recommended.medium || 2;
    const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1_000_000n;
    const priorityFee = gas.baseGas / gasPerSat;
    // Typical tx size: ~250 vB for interaction, ~1000 vB for deploy
    const txSize = opType === 'deploy' ? 1000 : 250;
    const btcFee = BigInt(Math.ceil(txSize * feeRate));
    const gasFee = opType === 'deploy' ? 100_000n : priorityFee < 500n ? 500n : priorityFee;
    const minSats = btcFee + gasFee + 546n; // 546 = dust limit
    const label = opType === 'deploy'
      ? `~${(Number(minSats) / 100_000).toFixed(1)}K sats (~${(Number(minSats) / 100_000_000).toFixed(5)} BTC)`
      : `~${Number(minSats).toLocaleString()} sats (~${(Number(minSats) / 100_000_000).toFixed(6)} BTC)`;
    return { minSats, feeRate, label };
  } catch (e) {
    logger.warn('[txUtils] Failed to fetch gas parameters for min BTC estimate:', e);
    // Fallback estimates
    const minSats = opType === 'deploy' ? 110_000n : 5_000n;
    return { minSats, feeRate: 2, label: opType === 'deploy' ? '~110K sats' : '~5K sats' };
  }
}

/**
 * Format user-friendly error messages for common OPNet transaction failures.
 * @param e - Caught error (Error instance or unknown).
 * @returns Human-readable error string.
 */
export function formatTxError(e: unknown): string {
  let msg = e instanceof Error ? e.message : 'Transaction failed';
  const lower = msg.toLowerCase();
  if (lower.includes('no utxo')) return 'No BTC UTXOs.' + (CURRENT_ENV !== 'mainnet' ? ' Get testnet BTC from the faucet.' : ' Fund your wallet first.');
  if (lower.includes('insufficient allowance') || lower.includes('allowance')) return 'Allowance not yet confirmed. Please wait ~30s and try again (approval already sent).';
  if (lower.includes('timeout') || lower.includes('fetch')) return 'Network timeout — try again in a few seconds.';
  if (lower.includes('cannot accept own order') || lower.includes('own order')) return 'Cannot fill your own order. Use a different wallet.';
  if (lower.includes('invalid epoch') || lower.includes('feature data length')) return 'Transaction encoding error. Try refreshing the page and attempt again.';
  if (lower.includes('signer is not allowed')) return 'Wallet rejected signer params. Refresh and retry.';
  if (lower.includes('502') || lower.includes('bad gateway')) return 'RPC server temporarily unavailable (502). Try again in a moment.';
  if (lower.includes('cors')) return 'CORS error — RPC temporarily blocked. Try again.';
  if (lower.includes('revert')) msg += CURRENT_ENV !== 'mainnet' ? ' (Try again — testnet can be flaky)' : ' (Transaction reverted)';
  return msg;
}
