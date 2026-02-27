import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type IOP20Contract, type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import {
  TESTNET_CONTRACTS, STAKING_ADDRESS, STAKING_PUBKEY, STAKING_DEPLOYED,
  getContractOpscanUrl,
} from '../contracts';
import * as opnetRpc from '../opnet';
import { addTxRecord } from '../txHistory';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

/** Staking ABI — matches SimpleStaking contract */
const STAKING_ABI: BitcoinInterfaceAbi = [
  { name: 'stake', inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'unstake', inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [{ name: 'success', type: ABIDataTypes.BOOL }], type: BitcoinAbiTypes.Function },
  { name: 'claim', inputs: [], outputs: [{ name: 'reward', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'stakedAmount', inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'stakedReward', inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'totalStaked', inputs: [], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'getRewardRate', inputs: [], outputs: [{ name: 'rate', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<any> {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  return {
    signer: null, mldsaSigner: null, refundTo,
    maximumAllowedSatToSpend: 100_000n, network: NETWORK, feeRate, priorityFee,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** The staking token is MINE — same token used in swap pool and minting */
const STAKING_TOKEN = TESTNET_CONTRACTS.MINE;

const Staking: React.FC = () => {
  const { walletAddress, walletInstance, openConnectModal, publicKey, hashedMLDSAKey, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

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
    opnetRpc.setNetwork('testnet');
    setBalLoading(true);
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    Promise.allSettled([
      opnetRpc.getTokenBalance(TESTNET_CONTRACTS.MINE.address, mldsa, tweaked).then(b => setMineBalance(b)),
      opnetRpc.getTokenBalance(TESTNET_CONTRACTS.VIBE.address, mldsa, tweaked).then(b => setVibeBalance(b)),
      opnetRpc.getBalance(walletAddress).then(b => setBtcBalance(b)),
    ]).finally(() => setBalLoading(false));
  }, [walletAddress, hashedMLDSAKey, publicKey, refreshKey]);

  // Fetch staking stats (when contract is deployed)
  useEffect(() => {
    if (!STAKING_DEPLOYED || !senderAddr) return;
    // TODO: query stakedAmount, stakedReward, totalStaked from contract
  }, [senderAddr, refreshKey]);

  const doStake = useCallback(async () => {
    if (!STAKING_DEPLOYED) {
      setResult({ type: 'error', msg: 'Staking contract not yet deployed. Run: OPNET_MNEMONIC="..." node deploy/deploy-staking.mjs' });
      return;
    }
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const amt = parseFloat(stakeAmount);
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount' }); return; }
    if (!senderAddr) { setResult({ type: 'error', msg: 'Wallet public key not available' }); return; }

    setStaking(true);
    setResult(null);
    try {
      const txParams = await buildTxParams(provider, walletAddress);
      const rawAmount = BitcoinUtils.expandToDecimals(amt, STAKING_TOKEN.decimals);
      const stakingAddr = Address.fromString(STAKING_PUBKEY) as any;

      // 1. Approve staking contract
      setStep('Approving MINE spend...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenContract = getContract<IOP20Contract>(STAKING_TOKEN.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const approveSim = await tokenContract.increaseAllowance(stakingAddr, rawAmount);
      if (approveSim.revert) throw new Error(`Approval failed: ${approveSim.revert}`);
      await approveSim.sendTransaction(txParams);

      setStep('Waiting for approval (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 2. Stake
      setStep('Staking MINE tokens...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stakingContract = getContract<any>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr as any);
      const stakeSim = await stakingContract.stake(rawAmount);
      if ((stakeSim as CallResult).revert) throw new Error(`Stake failed: ${(stakeSim as CallResult).revert}`);
      const receipt = await (stakeSim as CallResult).sendTransaction(txParams);

      setStep('');
      setResult({ type: 'success', msg: `Staked ${amt.toLocaleString()} MINE! TX: ${receipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: receipt.transactionId || '', tokenA: 'MINE', amountA: amt.toString(), status: 'confirmed', wallet: walletAddress });
      setTimeout(() => setRefreshKey(k => k + 1), 5000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Staking failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC first.';
      setStep('');
      setResult({ type: 'error', msg });
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
      const txParams = await buildTxParams(provider, walletAddress);
      const rawAmount = BitcoinUtils.expandToDecimals(amt, STAKING_TOKEN.decimals);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stakingContract = getContract<any>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr as any);
      setStep('Unstaking MINE tokens...');
      const sim = await stakingContract.unstake(rawAmount);
      if ((sim as CallResult).revert) throw new Error(`Unstake failed: ${(sim as CallResult).revert}`);
      const receipt = await (sim as CallResult).sendTransaction(txParams);

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
      const txParams = await buildTxParams(provider, walletAddress);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stakingContract = getContract<any>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr as any);
      setStep('Claiming rewards...');
      const sim = await stakingContract.claim();
      if ((sim as CallResult).revert) throw new Error(`Claim failed: ${(sim as CallResult).revert}`);
      const receipt = await (sim as CallResult).sendTransaction(txParams);

      setStep('');
      setResult({ type: 'success', msg: `Rewards claimed! TX: ${receipt.transactionId}` });
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
  const userStakedNum = Number(userStaked) / 1e8;
  const userRewardsNum = Number(userRewards) / 1e8;
  const totalStakedNum = Number(totalStakedOnChain) / 1e8;
  const projectedAPR = 42; // placeholder until contract is live

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 4 }}>🏦 Staking</h2>
        <p style={{ color: 'var(--t3)', fontSize: '.78rem' }}>
          Stake <strong>MINE</strong> tokens to earn rewards — same token used in Swap & Mint
        </p>
      </div>

      {!STAKING_DEPLOYED && (
        <div className="P" style={{ padding: 16, marginBottom: 16, border: '1px solid rgba(234,179,8,.2)', background: 'rgba(234,179,8,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: '1.1rem' }}>🚧</span>
            <span style={{ fontWeight: 700, color: 'var(--y)' }}>Staking Contract — Ready to Deploy</span>
          </div>
          <p style={{ fontSize: '.72rem', color: 'var(--t3)', lineHeight: 1.5, marginBottom: 8 }}>
            The <strong>SimpleStaking</strong> contract is ready. Deploy it with:
          </p>
          <code style={{ display: 'block', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: '.62rem', color: 'var(--c2)', wordBreak: 'break-all', lineHeight: 1.6 }}>
            cd deploy/OP_20 && npx asc --target staking<br />
            OPNET_MNEMONIC="..." node deploy/deploy-staking.mjs
          </code>
          <p style={{ fontSize: '.6rem', color: 'var(--t4)', marginTop: 6 }}>
            Contract: <code>deploy/OP_20/src/staking/SimpleStaking.ts</code> · Token: MINE ({STAKING_TOKEN.address.slice(0, 20)}...)
          </p>
        </div>
      )}

      {/* Wallet Balances */}
      <div className="P" style={{ padding: 16, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>💰 Your Wallet</div>
        {!connected ? (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <button onClick={openConnectModal} style={{
              padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#fff',
              fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--ff)',
            }}>Connect Wallet</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 'var(--rad)', textAlign: 'center' }}>
              <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginBottom: 4 }}>⛏️ MINE</div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#F7931A', fontFamily: 'var(--fm)' }}>
                {balLoading ? '...' : fmtToken(mineBalance)}
              </div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 'var(--rad)', textAlign: 'center' }}>
              <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginBottom: 4 }}>⚡ VIBE</div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#0ea5e9', fontFamily: 'var(--fm)' }}>
                {balLoading ? '...' : fmtToken(vibeBalance)}
              </div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 'var(--rad)', textAlign: 'center' }}>
              <div style={{ fontSize: '.58rem', color: 'var(--t4)', marginBottom: 4 }}>₿ BTC</div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {balLoading ? '...' : (Number(btcBalance) / 1e8).toFixed(4)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* APR & Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Projected APR</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--g)', fontFamily: 'var(--fm)' }}>{projectedAPR}%</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Total Staked</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--p)', fontFamily: 'var(--fm)' }}>{totalStakedNum > 0 ? fmtToken(totalStakedOnChain) : '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Your Staked</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)' }}>{userStakedNum > 0 ? fmtToken(userStaked) : '—'}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Rewards</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--g)', fontFamily: 'var(--fm)' }}>{userRewardsNum > 0 ? fmtToken(userRewards) : '—'}</div>
        </div>
      </div>

      {/* Staking Interface */}
      <div className="P" style={{ padding: 20, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 12 }}>Stake MINE Tokens</div>

        {/* Token info banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14, background: 'rgba(247,147,26,.05)', border: '1px solid rgba(247,147,26,.15)', borderRadius: 'var(--rad)' }}>
          <span style={{ fontSize: '1.3rem' }}>⛏️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--w)' }}>MINE — {STAKING_TOKEN.name}</div>
            <div style={{ fontSize: '.55rem', color: 'var(--t4)', fontFamily: 'var(--fm)', wordBreak: 'break-all' }}>{STAKING_TOKEN.address}</div>
          </div>
          {connected && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '.55rem', color: 'var(--t4)' }}>Balance</div>
              <div style={{ fontWeight: 700, color: '#F7931A', fontFamily: 'var(--fm)', fontSize: '.85rem' }}>{fmtToken(mineBalance)}</div>
            </div>
          )}
        </div>

        {/* Stake input */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 4 }}>Amount to Stake</div>
          <div style={{ position: 'relative' }}>
            <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)}
              placeholder="0" style={{
                width: '100%', padding: '14px 80px 14px 14px', borderRadius: 10,
                border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--w)',
                fontSize: '.9rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
              }} />
            {connected && mineBalance > 0n && (
              <button onClick={() => setStakeAmount((Number(mineBalance) / 1e8).toString())}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--p)',
                  background: 'rgba(168,85,247,.1)', color: 'var(--p)', cursor: 'pointer',
                  fontSize: '.7rem', fontWeight: 700, fontFamily: 'var(--ff)',
                }}>MAX</button>
            )}
          </div>
        </div>

        {/* Stake button */}
        <button onClick={doStake} disabled={busy || !stakeAmount}
          style={{
            width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: busy ? 'var(--bg4)' : 'linear-gradient(135deg, #a78bfa, #7c3aed)',
            color: '#fff', fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
            opacity: busy || !stakeAmount ? 0.5 : 1, transition: 'all .2s', marginBottom: 10,
          }}>
          {staking ? (step || 'Staking...') : `Stake MINE`}
        </button>

        {/* Unstake section */}
        {STAKING_DEPLOYED && userStakedNum > 0 && (
          <>
            <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 4 }}>Amount to Unstake</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input type="number" value={unstakeAmount} onChange={e => setUnstakeAmount(e.target.value)}
                placeholder="0" style={{
                  flex: 1, padding: '12px', borderRadius: 10, border: '1px solid var(--bd)',
                  background: 'var(--bg3)', color: 'var(--w)', fontSize: '.85rem', fontFamily: 'var(--fm)',
                  outline: 'none', boxSizing: 'border-box',
                }} />
              <button onClick={doUnstake} disabled={busy || !unstakeAmount}
                style={{
                  padding: '12px 20px', borderRadius: 10,
                  border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)',
                  color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: '.8rem', fontFamily: 'var(--ff)',
                  opacity: busy || !unstakeAmount ? 0.5 : 1,
                }}>
                {unstaking ? '⏳...' : 'Unstake'}
              </button>
            </div>
          </>
        )}

        {/* Claim button */}
        {STAKING_DEPLOYED && userRewardsNum > 0 && (
          <button onClick={doClaim} disabled={busy}
            style={{
              width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--g), #16a34a)', color: '#000',
              fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
              opacity: busy ? 0.5 : 1, transition: 'all .2s',
            }}>
            {claiming ? (step || 'Claiming...') : `Claim ${fmtToken(userRewards)} MINE Rewards`}
          </button>
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

      {/* Token Verification */}
      <div className="P" style={{ padding: 16, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>🔗 Token Verification</div>
        <p style={{ fontSize: '.68rem', color: 'var(--t3)', lineHeight: 1.5, marginBottom: 10 }}>
          All features use the <strong>same MINE token contract</strong>. Verify:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Mint (publicMint)', addr: TESTNET_CONTRACTS.MINE.address },
            { label: 'Swap Pool (MINE/VIBE)', addr: TESTNET_CONTRACTS.MINE.address },
            { label: 'Staking', addr: STAKING_TOKEN.address },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8 }}>
              <span style={{ fontSize: '.7rem', color: 'var(--g)' }}>✓</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '.68rem', fontWeight: 600, color: 'var(--w)' }}>{item.label}</div>
                <div style={{ fontSize: '.5rem', fontFamily: 'var(--fm)', color: 'var(--t4)', wordBreak: 'break-all' }}>{item.addr}</div>
              </div>
              <a href={getContractOpscanUrl(item.addr)} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '.5rem', color: 'var(--c2)', textDecoration: 'none' }}>OPScan ↗</a>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="P" style={{ padding: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>How Staking Works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { step: '1', title: 'Approve & Stake', desc: 'Approve the staking contract to spend your MINE, then stake' },
            { step: '2', title: 'Earn Rewards', desc: 'Rewards accumulate every block, proportional to your stake' },
            { step: '3', title: 'Claim or Unstake', desc: 'Claim MINE rewards anytime, or unstake to withdraw' },
          ].map(s => (
            <div key={s.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                minWidth: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--p), #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '.75rem', color: '#fff',
              }}>{s.step}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 2 }}>{s.title}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--t3)' }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Staking;
