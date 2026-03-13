import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract, BitcoinUtils,
  type CallResult, type BaseContractProperties,
} from 'opnet';
import { STAKING_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK, CURRENT_ENV } from '../config';
import { ensureAllowance, buildTxParams, withRetry, formatTxError, waitForTxConfirmation, emitBalanceRefresh } from '../txUtils';
import {
  DEPLOYED_CONTRACTS, STAKING_ADDRESS, STAKING_PUBKEY, STAKING_DEPLOYED,
  getContractOpscanUrl, getTxUrl,
} from '../contracts';
import * as opnetRpc from '../opnet';
import { useOps } from '../contexts/OpsContext';
import { addTxRecord } from '../txHistory';


/** Typed interface for SimpleStaking contract methods */
interface StakingContract extends BaseContractProperties {
  stake(amount: bigint): Promise<CallResult>;
  unstake(amount: bigint): Promise<CallResult>;
  claim(): Promise<CallResult>;
  stakedAmount(address: unknown): Promise<CallResult>;
  stakedReward(address: unknown): Promise<CallResult>;
  totalStaked(): Promise<CallResult>;
  getRewardRate(): Promise<CallResult>;
}

/** The staking token is MINE — same token used in swap pool and minting */
const STAKING_TOKEN = DEPLOYED_CONTRACTS.MINE;

const Staking: React.FC = () => {
  const { walletAddress, openConnectModal, publicKey, hashedMLDSAKey, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, updateOpStep, completeOp, failOp } = useOps();

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string; txHash?: string } | null>(null);

  // Wallet balances
  const [mineBalance, setMineBalance] = useState<bigint>(0n);
  const [vibeBalance, setVibeBalance] = useState<bigint>(0n);
  const [btcBalance, setBtcBalance] = useState<bigint>(0n);
  const [balLoading, setBalLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Staking stats (live when contract deployed, mock otherwise)
  const [userStaked, setUserStaked] = useState<bigint>(0n);
  const [userRewards, setUserRewards] = useState<bigint>(0n);
  const [totalStakedOnChain, setTotalStakedOnChain] = useState<bigint>(0n);

  const fmtToken = (raw: bigint, decimals = 8): string => {
    const num = Number(raw) / Math.pow(10, decimals);
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // Fetch wallet balances
  useEffect(() => {
    if (!walletAddress || !hashedMLDSAKey) { setMineBalance(0n); setVibeBalance(0n); setBtcBalance(0n); return; }
    const prevNet = opnetRpc.getNetwork();
    opnetRpc.setNetwork(CURRENT_ENV);
    setBalLoading(true);
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    void Promise.allSettled([
      opnetRpc.getTokenBalance(DEPLOYED_CONTRACTS.MINE.address, mldsa, tweaked).then(b => setMineBalance(b)),
      opnetRpc.getTokenBalance(DEPLOYED_CONTRACTS.VIBE.address, mldsa, tweaked).then(b => setVibeBalance(b)),
      opnetRpc.getBalance(walletAddress).then(b => setBtcBalance(b)),
    ]).finally(() => setBalLoading(false));
    return () => { opnetRpc.setNetwork(prevNet); };
  }, [walletAddress, hashedMLDSAKey, publicKey, refreshKey]);

  // Fetch live staking stats from contract
  useEffect(() => {
    if (!STAKING_DEPLOYED || !senderAddr) return;
    let cancelled = false;
    const fetchStats = async (): Promise<void> => {
      try {
        const stakingContract = getContract<StakingContract>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr);
        const [stakedRes, rewardRes, totalRes, rateRes] = await Promise.allSettled([
          stakingContract.stakedAmount(senderAddr),
          stakingContract.stakedReward(senderAddr),
          stakingContract.totalStaked(),
          stakingContract.getRewardRate(),
        ]);
        if (cancelled) return;
        if (stakedRes.status === 'fulfilled' && !(stakedRes.value as CallResult).revert) {
          const decoded = (stakedRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.amount != null) setUserStaked(BigInt(String(decoded.amount)));
        }
        if (rewardRes.status === 'fulfilled' && !(rewardRes.value as CallResult).revert) {
          const decoded = (rewardRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.amount != null) setUserRewards(BigInt(String(decoded.amount)));
        }
        if (totalRes.status === 'fulfilled' && !(totalRes.value as CallResult).revert) {
          const decoded = (totalRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.amount != null) setTotalStakedOnChain(BigInt(String(decoded.amount)));
        }
        if (rateRes.status === 'fulfilled' && !(rateRes.value as CallResult).revert) {
          const decoded = (rateRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.rate != null) setRewardRate(BigInt(String(decoded.rate)));
        }
      } catch (e) { logger.warn('[Staking] Failed to fetch staking stats:', e); }
    };
    void fetchStats();
    const iv = setInterval(() => void fetchStats(), 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [senderAddr, provider, refreshKey]);

  // Claim cooldown: 5 min between claims per wallet
  const CLAIM_COOLDOWN_MS = 5 * 60 * 1000;
  const claimKey = `hub_last_claim_${walletAddress || ''}`;
  const [lastClaimTs, setLastClaimTs] = useState<number>(() => {
    try { return Number(localStorage.getItem(claimKey) || '0'); } catch (e) { logger.warn('[Staking] Failed to read claim timestamp from localStorage:', e); return 0; }
  });

  const doStake = useCallback(async () => {
    if (!walletAddress) { openConnectModal(); return; }
    const amt = parseFloat(stakeAmount);
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount' }); return; }
    if (!senderAddr) { setResult({ type: 'error', msg: 'Wallet public key not available' }); return; }

    setStaking(true);
    setResult(null);
    const sOpId = `stake_${Date.now()}`;
    try {
      const rawAmount = BitcoinUtils.expandToDecimals(amt, STAKING_TOKEN.decimals);

      // 1. Track in bell + ensure allowance
      trackOp({ id: sOpId, market: 'stake', orderId: 'Stake', direction: '', role: '', step: `Checking MINE approval...`, amounts: { amount: amt.toString(), token: 'MINE' } });
      const approveRes = await ensureAllowance(
        STAKING_TOKEN.address, STAKING_PUBKEY, rawAmount,
        provider, senderAddr, walletAddress, (s: string) => { setStep(s); updateOpStep(sOpId, s); }, 'MINE',
      );
      if (approveRes.txId) updateOpStep(sOpId, 'MINE approved, confirming...', { approve: approveRes.txId });

      // 2. Stake
      updateOpStep(sOpId, `Staking ${amt.toLocaleString()} MINE...`);
      setStep('Staking MINE tokens...');
      const stakingContract = getContract<StakingContract>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr);
      const stakeSim = await withRetry(() => stakingContract.stake(rawAmount));
      if ((stakeSim as CallResult).revert) throw new Error(`Stake failed: ${(stakeSim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress);
      const receipt = await (stakeSim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      updateOpStep(sOpId, 'Stake TX sent! Confirming...', { stake: txHash });
      setStep('');
      setResult({ type: 'success', msg: `Stake TX sent! Confirming...`, txHash });
      addTxRecord({ type: 'mint', txHash, tokenA: 'MINE', amountA: amt.toString(), status: 'pending', wallet: walletAddress });
      void waitForTxConfirmation(txHash).then(() => { completeOp(sOpId); emitBalanceRefresh(); setTimeout(() => setRefreshKey(k => k + 1), 1000); }).catch(() => { completeOp(sOpId); });
    } catch (e) {
      failOp(sOpId, formatTxError(e));
      setStep('');
      setResult({ type: 'error', msg: formatTxError(e) });
    } finally {
      setStaking(false);
    }
  }, [walletAddress, stakeAmount, provider, senderAddr, openConnectModal, trackOp, updateOpStep, completeOp, failOp]);

  const doUnstake = useCallback(async () => {
    if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Staking contract not yet deployed' }); return; }
    if (!walletAddress) { openConnectModal(); return; }
    const amt = parseFloat(unstakeAmount);
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter amount to unstake' }); return; }
    if (!senderAddr) { setResult({ type: 'error', msg: 'Wallet not available' }); return; }

    setUnstaking(true);
    setResult(null);
    try {
      const rawAmount = BitcoinUtils.expandToDecimals(amt, STAKING_TOKEN.decimals);
      const stakingContract = getContract<StakingContract>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr);
      setStep('Unstaking MINE tokens...');
      const sim = await withRetry(() => stakingContract.unstake(rawAmount));
      if ((sim as CallResult).revert) throw new Error(`Unstake failed: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress);
      const uOpId = `unstake_${Date.now()}`;
      trackOp({ id: uOpId, market: 'stake', orderId: 'Unstake', direction: '', role: '', step: `Unstaking ${amt.toLocaleString()} MINE...` });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      updateOpStep(uOpId, 'Unstake TX sent! Confirming...', { unstake: txHash });
      setStep('');
      setResult({ type: 'success', msg: `Unstake TX sent! Confirming...`, txHash });
      void waitForTxConfirmation(txHash).then(() => { completeOp(uOpId); emitBalanceRefresh(); setTimeout(() => setRefreshKey(k => k + 1), 1000); }).catch(() => { completeOp(uOpId); });
    } catch (e) {
      setStep('');
      setResult({ type: 'error', msg: e instanceof Error ? e.message : 'Unstake failed' });
    } finally {
      setUnstaking(false);
    }
  }, [walletAddress, unstakeAmount, provider, senderAddr, openConnectModal, trackOp, updateOpStep, completeOp]);

  const doClaim = useCallback(async () => {
    if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Staking contract not yet deployed' }); return; }
    if (!walletAddress) { openConnectModal(); return; }
    if (!senderAddr) return;

    setClaiming(true);
    setResult(null);
    try {
      const stakingContract = getContract<StakingContract>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr);
      setStep('Claiming rewards...');
      const sim = await withRetry(() => stakingContract.claim());
      if ((sim as CallResult).revert) throw new Error(`Claim failed: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress);
      const cOpId = `claim_${Date.now()}`;
      trackOp({ id: cOpId, market: 'stake', orderId: 'Claim', direction: '', role: '', step: 'Claiming staking rewards...' });
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      updateOpStep(cOpId, 'Claim TX sent! Confirming...', { claim: txHash });
      setStep('');
      setResult({ type: 'success', msg: 'Claim TX sent! Confirming...', txHash });
      const ts = Date.now();
      setLastClaimTs(ts);
      try { localStorage.setItem(claimKey, String(ts)); } catch (e) { logger.warn('[Staking] Failed to save claim timestamp to localStorage:', e); }
      void waitForTxConfirmation(txHash).then(() => { completeOp(cOpId); emitBalanceRefresh(); setTimeout(() => setRefreshKey(k => k + 1), 1000); }).catch(() => { completeOp(cOpId); });
    } catch (e) {
      setStep('');
      setResult({ type: 'error', msg: e instanceof Error ? e.message : 'Claim failed' });
    } finally {
      setClaiming(false);
    }
  }, [walletAddress, provider, senderAddr, openConnectModal, claimKey, trackOp, updateOpStep, completeOp]);

  const connected = !!walletAddress;
  const busy = staking || unstaking || claiming;
  const [rewardRate, setRewardRate] = useState<bigint>(0n);

  const userStakedNum = Number(userStaked) / 1e8;
  const userRewardsNum = Number(userRewards) / 1e8;
  const totalStakedNum = Number(totalStakedOnChain) / 1e8;
  // APR = (rewardRate * blocksPerYear / totalStaked) * 100
  // Bitcoin: ~144 blocks/day → ~52,560/year
  const BLOCKS_PER_YEAR = 52_560;
  const rateNum = Number(rewardRate) / 1e8;
  const rawAPR = totalStakedNum > 0 && rateNum > 0
    ? (rateNum * BLOCKS_PER_YEAR / totalStakedNum) * 100
    : 0;
  // Cap display — testnet rate is intentionally high for testing
  const projectedAPR = Math.min(rawAPR, 999);

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const cooldownLeft = Math.max(0, CLAIM_COOLDOWN_MS - (now - lastClaimTs));
  const canClaim = cooldownLeft === 0 && userRewardsNum > 0.01;

  return (
    <div>
      <div className="flex-between mb-20">
        <div>
          <h2 className="fs-110 fw-800 mb-4 ls-neg02">Staking</h2>
          <p className="fs-75 c-muted">
            Stake <strong className="c-white">MINE</strong> to earn block rewards
          </p>
        </div>
        {STAKING_DEPLOYED && (
          <a href={getContractOpscanUrl(STAKING_ADDRESS)} target="_blank" rel="noopener noreferrer"
            className="d-flex ai-center gap-6 br-10 no-decoration fs-58 fw-600 p-6-12 bg-ok c-g">
            <span className="br-50 d-inline-block w-5 h-5" style={{ background: '#10b981' }} />
            Live on {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)} ↗
          </a>
        )}
      </div>

      {/* Wallet Balances */}
      {!connected ? (
        <div className="mb-16 br-20 text-center p-28 bg-card">
          <img src="/icons/empty-the-vault.png" alt="" style={{ width: 100, opacity: 0.75, marginBottom: 14 }} />
          <div className="fs-75 mb-12 c-muted">Connect your wallet to start staking</div>
          <button onClick={openConnectModal} className="br-12 pointer fw-700 fs-82 ff-ui btn-blue" style={{ padding: '12px 28px', boxShadow: '0 4px 16px rgba(14,165,233,.2)' }}>Connect Wallet</button>
        </div>
      ) : (
        <div className="d-grid gap-10 mb-16 grid-auto-fit-100">
          {[
            { label: 'MINE', value: balLoading ? '...' : fmtToken(mineBalance), color: '#F7931A' },
            { label: 'VIBE', value: balLoading ? '...' : fmtToken(vibeBalance), color: '#0ea5e9' },
            { label: 'BTC', value: balLoading ? '...' : (Number(btcBalance) / 1e8).toFixed(4), color: '#F7931A' },
          ].map(b => (
            <div key={b.label} className="text-center stat-card-inner">
              <div className="fs-52 mb-6 fw-600 text-upper ls-06 c-muted">{b.label}</div>
              <div className="fw-700 fs-95" style={{ color: b.color, fontFamily: "'JetBrains Mono', monospace" }}>{b.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* APR & Stats */}
      <div className="d-grid gap-10 mb-16 grid-auto-fit-110">
        {[
          { label: 'APR', value: projectedAPR > 0 ? (projectedAPR > 10000 ? `${(projectedAPR / 1000).toFixed(0)}K` : projectedAPR.toFixed(0)) + '%' : '—', color: '#10b981', big: true },
          { label: 'Total Staked', value: totalStakedNum > 0 ? fmtToken(totalStakedOnChain) : '—', color: '#a78bfa' },
          { label: 'Your Staked', value: userStakedNum > 0 ? fmtToken(userStaked) : '—', color: '#F7931A' },
          { label: 'Rewards', value: userRewardsNum > 0 ? fmtToken(userRewards) : '—', color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="text-center stat-card-inner-lg">
            <div className="fs-52 text-upper ls-06 mb-6 fw-600 c-muted">{s.label}</div>
            <div className="fw-800" style={{ fontSize: s.big ? '1.5rem' : '1.05rem', color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Staking Interface */}
      <div className="mb-16 staking-panel" role="form" aria-label="Staking interface">
        <div className="flex-between mb-16">
          <span className="fs-95 fw-800 c-white ls-neg02">Stake MINE</span>
          {connected && (
            <div className="text-right">
              <div className="fs-48 mb-2 c-muted">AVAILABLE</div>
              <div className="fw-700 fs-82" style={{ color: '#F7931A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtToken(mineBalance)}</div>
            </div>
          )}
        </div>

        {/* Stake input */}
        <div className="mb-10">
          <div className="fs-58 mb-6 fw-500 c-muted">Amount to Stake</div>
          <div className="pos-relative">
            <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)}
              placeholder="0" aria-label="Amount of MINE to stake" className="w-full fs-95 fw-700 outline-none" style={{ padding: '16px 80px 16px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: '#fff', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box', transition: 'border-color .2s' }} />
            {connected && mineBalance > 0n && (
              <button onClick={() => setStakeAmount((Number(mineBalance) / 1e8).toString())}
                aria-label="Use maximum MINE balance"
                className="pos-absolute br-8 pointer fs-65 fw-700 ff-ui" style={{ right: 10, top: '50%', transform: 'translateY(-50%)', padding: '6px 14px', border: '1px solid rgba(167,139,250,.2)', background: 'rgba(167,139,250,.08)', color: '#a78bfa', transition: 'all .2s' }}>MAX</button>
            )}
          </div>
        </div>

        {/* Stake button */}
        <button onClick={doStake} disabled={busy || !stakeAmount}
          className="w-full pointer fw-700 fs-85 ff-ui mb-10" style={{ padding: '15px', borderRadius: 14, border: 'none', background: busy ? 'rgba(30,30,50,.8)' : 'linear-gradient(135deg, #a78bfa, #7c3aed)', color: '#fff', opacity: busy || !stakeAmount ? 0.5 : 1, transition: 'all .2s', boxShadow: !busy && stakeAmount ? '0 4px 16px rgba(167,139,250,.2)' : 'none' }}>
          {staking ? (step || 'Staking...') : `Stake MINE`}
        </button>

        {/* Unstake section */}
        {STAKING_DEPLOYED && userStakedNum > 0 && (
          <>
            <div className="flex-between mb-6">
              <span className="fs-58 fw-500 c-muted">Amount to Unstake</span>
              <span className="fs-58 c-muted">Staked: <strong className="c-o text-mono">{fmtToken(userStaked)}</strong></span>
            </div>
            <div className="flex-center gap-8 mb-10">
              <div className="flex-1 pos-relative">
                <input type="number" value={unstakeAmount} onChange={e => setUnstakeAmount(e.target.value)}
                  placeholder="0" aria-label="Amount of MINE to unstake" className="w-full fs-85 fw-700 outline-none" style={{ padding: '14px 80px 14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: '#fff', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box' }} />
                <button onClick={() => setUnstakeAmount((Number(userStaked) / 1e8).toString())}
                  aria-label="Use maximum staked amount"
                  className="pos-absolute br-8 pointer fs-65 fw-700 ff-ui" style={{ right: 10, top: '50%', transform: 'translateY(-50%)', padding: '6px 14px', border: '1px solid rgba(239,68,68,.2)', background: 'rgba(239,68,68,.08)', color: '#ef4444', transition: 'all .2s' }}>MAX</button>
              </div>
              <button onClick={doUnstake} disabled={busy || !unstakeAmount}
                className="c-red pointer fw-700 fs-78 ff-ui" style={{ padding: '14px 22px', borderRadius: 14, border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)', opacity: busy || !unstakeAmount ? 0.5 : 1, transition: 'all .2s' }}>
                {unstaking ? (step || 'Unstaking...') : 'Unstake'}
              </button>
            </div>
          </>
        )}

        {/* Claim button with cooldown */}
        {STAKING_DEPLOYED && userRewardsNum > 0 && (
          <div>
            <button onClick={doClaim} disabled={busy || !canClaim}
              className="w-full fw-700 fs-85 ff-ui" style={{ padding: '15px', borderRadius: 14, border: 'none', cursor: canClaim ? 'pointer' : 'not-allowed', background: !canClaim ? 'rgba(30,30,50,.8)' : busy ? 'rgba(30,30,50,.8)' : 'linear-gradient(135deg, #10b981, #059669)', color: canClaim && !busy ? '#000' : '#5a6578', opacity: busy || !canClaim ? 0.5 : 1, transition: 'all .2s', boxShadow: canClaim && !busy ? '0 4px 16px rgba(16,185,129,.2)' : 'none' }}>
              {claiming ? (step || 'Claiming...') : cooldownLeft > 0
                ? `Cooldown ${Math.ceil(cooldownLeft / 1000)}s`
                : `Claim ${fmtToken(userRewards)} MINE Rewards`}
            </button>
            {cooldownLeft > 0 && (
              <div className="mt-6 text-center fs-58 c-muted" aria-live="polite">
                Next claim available in {Math.floor(cooldownLeft / 60000)}:{String(Math.floor((cooldownLeft % 60000) / 1000)).padStart(2, '0')}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-12 p-12 br-8 fs-72 word-break" role="alert" aria-live="assertive" style={{ background: result.type === 'success' ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)', border: `1px solid ${result.type === 'success' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`, color: result.type === 'success' ? 'var(--g)' : '#ef4444' }}>
            {result.msg}
            {result.txHash && (
              <a href={getTxUrl(result.txHash)} target="_blank" rel="noopener noreferrer"
                className="ml-6 c-c2 no-decoration fw-600">View TX ↗</a>
            )}
          </div>
        )}
      </div>

      {/* Contract link */}
      <div className="text-center p-12-0">
        <a href={getContractOpscanUrl(STAKING_ADDRESS)} target="_blank" rel="noopener noreferrer"
          className="fs-xs no-decoration" style={{ color: '#4a5568' }}>
          View staking contract on OPScan ↗
        </a>
      </div>
    </div>
  );
};

export default Staking;
