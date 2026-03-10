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
import { ensureAllowance, buildTxParams, withRetry, formatTxError } from '../txUtils';
import {
  DEPLOYED_CONTRACTS, STAKING_ADDRESS, STAKING_PUBKEY, STAKING_DEPLOYED,
  getContractOpscanUrl,
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
  const { walletAddress, walletInstance, openConnectModal, publicKey, hashedMLDSAKey, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp } = useOps();

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

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

  const fmtToken = (raw: bigint, decimals = 8) => {
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
    Promise.allSettled([
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
    const fetchStats = async () => {
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
          if (decoded?.amount) setUserStaked(BigInt(String(decoded.amount)));
        }
        if (rewardRes.status === 'fulfilled' && !(rewardRes.value as CallResult).revert) {
          const decoded = (rewardRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.amount) setUserRewards(BigInt(String(decoded.amount)));
        }
        if (totalRes.status === 'fulfilled' && !(totalRes.value as CallResult).revert) {
          const decoded = (totalRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.amount) setTotalStakedOnChain(BigInt(String(decoded.amount)));
        }
        if (rateRes.status === 'fulfilled' && !(rateRes.value as CallResult).revert) {
          const decoded = (rateRes.value as CallResult).properties as Record<string, unknown>;
          if (decoded?.rate) setRewardRate(BigInt(String(decoded.rate)));
        }
      } catch (e) { logger.warn('[Staking] Failed to fetch staking stats:', e); }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [senderAddr, provider, refreshKey]);

  const doStake = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const amt = parseFloat(stakeAmount);
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount' }); return; }
    if (!senderAddr) { setResult({ type: 'error', msg: 'Wallet public key not available' }); return; }

    setStaking(true);
    setResult(null);
    try {
      const rawAmount = BitcoinUtils.expandToDecimals(amt, STAKING_TOKEN.decimals);

      // 1. Ensure allowance (check → approve → wait for block)
      await ensureAllowance(
        STAKING_TOKEN.address, STAKING_PUBKEY, rawAmount,
        provider, senderAddr!, walletAddress!, setStep, 'MINE',
      );

      // 2. Stake
      setStep('Staking MINE tokens...');
      const stakingContract = getContract<StakingContract>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr);
      const stakeSim = await withRetry(() => stakingContract.stake(rawAmount));
      if ((stakeSim as CallResult).revert) throw new Error(`Stake failed: ${(stakeSim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress!);
      const sOpId = `stake_${Date.now()}`;
      trackOp({ id: sOpId, market: 'stake', orderId: 'Stake', direction: '', role: '', step: `Staking ${amt.toLocaleString()} MINE...` });
      const receipt = await (stakeSim as CallResult).sendTransaction(txParams);
      completeOp(sOpId);

      setStep('');
      setResult({ type: 'success', msg: `Staked ${amt.toLocaleString()} MINE! TX: ${receipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: receipt.transactionId || '', tokenA: 'MINE', amountA: amt.toString(), status: 'confirmed', wallet: walletAddress });
      setTimeout(() => setRefreshKey(k => k + 1), 5000);
    } catch (e) {
      setStep('');
      setResult({ type: 'error', msg: formatTxError(e) });
    } finally {
      setStaking(false);
    }
  }, [walletAddress, walletInstance, stakeAmount, provider, senderAddr, openConnectModal]);

  const doUnstake = useCallback(async () => {
    if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Staking contract not yet deployed' }); return; }
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
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
      completeOp(uOpId);

      setStep('');
      setResult({ type: 'success', msg: `Unstaked ${amt.toLocaleString()} MINE! TX: ${receipt.transactionId}` });
      setTimeout(() => setRefreshKey(k => k + 1), 5000);
    } catch (e) {
      setStep('');
      setResult({ type: 'error', msg: e instanceof Error ? e.message : 'Unstake failed' });
    } finally {
      setUnstaking(false);
    }
  }, [walletAddress, walletInstance, unstakeAmount, provider, senderAddr, openConnectModal]);

  const doClaim = useCallback(async () => {
    if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Staking contract not yet deployed' }); return; }
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
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
      completeOp(cOpId);

      setStep('');
      setResult({ type: 'success', msg: `Rewards claimed! TX: ${receipt.transactionId}` });
      const ts = Date.now();
      setLastClaimTs(ts);
      try { localStorage.setItem(claimKey, String(ts)); } catch (e) { logger.warn('[Staking] Failed to save claim timestamp to localStorage:', e); }
      setTimeout(() => setRefreshKey(k => k + 1), 5000);
    } catch (e) {
      setStep('');
      setResult({ type: 'error', msg: e instanceof Error ? e.message : 'Claim failed' });
    } finally {
      setClaiming(false);
    }
  }, [walletAddress, walletInstance, provider, senderAddr, openConnectModal]);

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

  // Claim cooldown: 5 min between claims per wallet
  const CLAIM_COOLDOWN_MS = 5 * 60 * 1000;
  const claimKey = `hub_last_claim_${walletAddress || ''}`;
  const [lastClaimTs, setLastClaimTs] = useState<number>(() => {
    try { return Number(localStorage.getItem(claimKey) || '0'); } catch (e) { logger.warn('[Staking] Failed to read claim timestamp from localStorage:', e); return 0; }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const cooldownLeft = Math.max(0, CLAIM_COOLDOWN_MS - (now - lastClaimTs));
  const canClaim = cooldownLeft === 0 && userRewardsNum > 0.01;

  return (
    <div>
      <div className="flex-between mb-16" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 4, letterSpacing: '-.02em' }}>Staking</h2>
          <p style={{ color: '#5a6578', fontSize: '.75rem' }}>
            Stake <strong style={{ color: '#fff' }}>MINE</strong> to earn block rewards
          </p>
        </div>
        {STAKING_DEPLOYED && (
          <a href={getContractOpscanUrl(STAKING_ADDRESS)} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.12)', textDecoration: 'none', fontSize: '.58rem', color: '#10b981', fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            Live on {CURRENT_ENV.charAt(0).toUpperCase() + CURRENT_ENV.slice(1)} ↗
          </a>
        )}
      </div>

      {/* Wallet Balances */}
      {!connected ? (
        <div style={{ marginBottom: 16, padding: '28px', borderRadius: 20, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', textAlign: 'center' }}>
          <div style={{ fontSize: '.75rem', color: '#5a6578', marginBottom: 12 }}>Connect your wallet to start staking</div>
          <button onClick={openConnectModal} style={{
            padding: '12px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff',
            fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--ff)',
            boxShadow: '0 4px 16px rgba(14,165,233,.2)',
          }}>Connect Wallet</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'MINE', value: balLoading ? '...' : fmtToken(mineBalance), color: '#F7931A' },
            { label: 'VIBE', value: balLoading ? '...' : fmtToken(vibeBalance), color: '#0ea5e9' },
            { label: 'BTC', value: balLoading ? '...' : (Number(btcBalance) / 1e8).toFixed(4), color: '#F7931A' },
          ].map(b => (
            <div key={b.label} style={{ padding: '14px 12px', borderRadius: 16, background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', textAlign: 'center' }}>
              <div style={{ fontSize: '.52rem', color: '#5a6578', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{b.label}</div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: b.color, fontFamily: "'JetBrains Mono', monospace" }}>{b.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* APR & Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'APR', value: projectedAPR > 0 ? (projectedAPR > 10000 ? `${(projectedAPR / 1000).toFixed(0)}K` : projectedAPR.toFixed(0)) + '%' : '—', color: '#10b981', big: true },
          { label: 'Total Staked', value: totalStakedNum > 0 ? fmtToken(totalStakedOnChain) : '—', color: '#a78bfa' },
          { label: 'Your Staked', value: userStakedNum > 0 ? fmtToken(userStaked) : '—', color: '#F7931A' },
          { label: 'Rewards', value: userRewardsNum > 0 ? fmtToken(userRewards) : '—', color: '#10b981' },
        ].map(s => (
          <div key={s.label} style={{ padding: '16px 12px', borderRadius: 18, textAlign: 'center', background: 'rgba(10,10,18,.5)', border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(16px)' }}>
            <div style={{ fontSize: '.52rem', color: '#5a6578', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: s.big ? '1.5rem' : '1.05rem', fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Staking Interface */}
      <div style={{ padding: '24px 22px', marginBottom: 16, borderRadius: 22, background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(20px)' }}>
        <div className="flex-between mb-16">
          <span style={{ fontSize: '.95rem', fontWeight: 800, color: '#fff', letterSpacing: '-.02em' }}>Stake MINE</span>
          {connected && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '.48rem', color: '#5a6578', marginBottom: 2 }}>AVAILABLE</div>
              <div style={{ fontWeight: 700, color: '#F7931A', fontFamily: "'JetBrains Mono', monospace", fontSize: '.82rem' }}>{fmtToken(mineBalance)}</div>
            </div>
          )}
        </div>

        {/* Stake input */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '.58rem', color: '#5a6578', marginBottom: 6, fontWeight: 500 }}>Amount to Stake</div>
          <div style={{ position: 'relative' }}>
            <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)}
              placeholder="0" style={{
                width: '100%', padding: '16px 80px 16px 16px', borderRadius: 14,
                border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: '#fff',
                fontSize: '.95rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none', boxSizing: 'border-box',
                transition: 'border-color .2s',
              }} />
            {connected && mineBalance > 0n && (
              <button onClick={() => setStakeAmount((Number(mineBalance) / 1e8).toString())}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(167,139,250,.2)',
                  background: 'rgba(167,139,250,.08)', color: '#a78bfa', cursor: 'pointer',
                  fontSize: '.65rem', fontWeight: 700, fontFamily: 'var(--ff)', transition: 'all .2s',
                }}>MAX</button>
            )}
          </div>
        </div>

        {/* Stake button */}
        <button onClick={doStake} disabled={busy || !stakeAmount}
          style={{
            width: '100%', padding: '15px', borderRadius: 14, border: 'none', cursor: 'pointer',
            background: busy ? 'rgba(30,30,50,.8)' : 'linear-gradient(135deg, #a78bfa, #7c3aed)',
            color: '#fff', fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
            opacity: busy || !stakeAmount ? 0.5 : 1, transition: 'all .2s', marginBottom: 10,
            boxShadow: !busy && stakeAmount ? '0 4px 16px rgba(167,139,250,.2)' : 'none',
          }}>
          {staking ? (step || 'Staking...') : `Stake MINE`}
        </button>

        {/* Unstake section */}
        {STAKING_DEPLOYED && userStakedNum > 0 && (
          <>
            <div style={{ fontSize: '.58rem', color: '#5a6578', marginBottom: 6, fontWeight: 500 }}>Amount to Unstake</div>
            <div className="flex-center gap-8 mb-10">
              <input type="number" value={unstakeAmount} onChange={e => setUnstakeAmount(e.target.value)}
                placeholder="0" style={{
                  flex: 1, padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,.06)',
                  background: 'rgba(255,255,255,.025)', color: '#fff', fontSize: '.85rem', fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700, outline: 'none', boxSizing: 'border-box',
                }} />
              <button onClick={doUnstake} disabled={busy || !unstakeAmount}
                style={{
                  padding: '14px 22px', borderRadius: 14,
                  border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)',
                  color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: '.78rem', fontFamily: 'var(--ff)',
                  opacity: busy || !unstakeAmount ? 0.5 : 1, transition: 'all .2s',
                }}>
                {unstaking ? '⏳...' : 'Unstake'}
              </button>
            </div>
          </>
        )}

        {/* Claim button with cooldown */}
        {STAKING_DEPLOYED && userRewardsNum > 0 && (
          <div>
            <button onClick={doClaim} disabled={busy || !canClaim}
              style={{
                width: '100%', padding: '15px', borderRadius: 14, border: 'none', cursor: canClaim ? 'pointer' : 'not-allowed',
                background: !canClaim ? 'rgba(30,30,50,.8)' : busy ? 'rgba(30,30,50,.8)' : 'linear-gradient(135deg, #10b981, #059669)', color: canClaim && !busy ? '#000' : '#5a6578',
                fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
                opacity: busy || !canClaim ? 0.5 : 1, transition: 'all .2s',
                boxShadow: canClaim && !busy ? '0 4px 16px rgba(16,185,129,.2)' : 'none',
              }}>
              {claiming ? (step || 'Claiming...') : cooldownLeft > 0
                ? `Cooldown ${Math.ceil(cooldownLeft / 1000)}s`
                : `Claim ${fmtToken(userRewards)} MINE Rewards`}
            </button>
            {cooldownLeft > 0 && (
              <div className="mt-6 text-center" style={{ fontSize: '.58rem', color: '#5a6578' }}>
                Next claim available in {Math.floor(cooldownLeft / 60000)}:{String(Math.floor((cooldownLeft % 60000) / 1000)).padStart(2, '0')}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 8,
            background: result.type === 'success' ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)',
            border: `1px solid ${result.type === 'success' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
            fontSize: '.72rem', color: result.type === 'success' ? 'var(--g)' : '#ef4444',
            wordBreak: 'break-all',
          }}>
            {result.msg}
          </div>
        )}
      </div>

      {/* Contract link */}
      <div className="text-center" style={{ padding: '12px 0' }}>
        <a href={getContractOpscanUrl(STAKING_ADDRESS)} target="_blank" rel="noopener noreferrer"
          className="fs-xs no-decoration" style={{ color: '#4a5568' }}>
          View staking contract on OPScan ↗
        </a>
      </div>
    </div>
  );
};

export default Staking;
