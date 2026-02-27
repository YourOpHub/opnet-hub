import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type IOP20Contract, type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import { TESTNET_CONTRACTS, POOL_PUBKEY } from '../contracts';
import { addTxRecord } from '../txHistory';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

/** Staking ABI — matches OPNet STAKING_ABI pattern */
const STAKING_ABI: BitcoinInterfaceAbi = [
  { name: 'stake', inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [], type: BitcoinAbiTypes.Function },
  { name: 'unstake', inputs: [], outputs: [], type: BitcoinAbiTypes.Function },
  { name: 'claim', inputs: [], outputs: [], type: BitcoinAbiTypes.Function },
  { name: 'stakedAmount', inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'stakedReward', inputs: [{ name: 'address', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'totalStaked', inputs: [], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
  { name: 'rewardPool', inputs: [], outputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
];

// Staking contract address — will be set when deployed
const STAKING_ADDRESS = '';
const STAKING_DEPLOYED = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildTxParams(provider: JSONRpcProvider, refundTo: string): Promise<any> {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  return {
    signer: null,
    mldsaSigner: null,
    refundTo,
    maximumAllowedSatToSpend: 100_000n,
    network: NETWORK,
    feeRate,
    priorityFee,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const Staking: React.FC = () => {
  const { walletAddress, walletInstance, openConnectModal, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const [selectedToken, setSelectedToken] = useState<'MINE' | 'VIBE'>('MINE');
  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Mock stats for UI (will be live when contract deployed)
  const [userStaked, setUserStaked] = useState(0);
  const [userRewards, setUserRewards] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [apr, setApr] = useState(0);

  // Simulated APR display
  useEffect(() => {
    if (!STAKING_DEPLOYED) {
      // Show realistic projected values
      setApr(42);
      setTotalStaked(0);
      setUserStaked(0);
      setUserRewards(0);
    }
  }, []);

  const tok = TESTNET_CONTRACTS[selectedToken];

  const doStake = useCallback(async () => {
    if (!STAKING_DEPLOYED) {
      setResult({ type: 'error', msg: 'Staking contract not yet deployed. Coming soon!' });
      return;
    }
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const amt = parseFloat(stakeAmount);
    if (!amt || amt <= 0) { setResult({ type: 'error', msg: 'Enter a valid amount' }); return; }

    setStaking(true);
    setResult(null);
    try {
      const txParams = await buildTxParams(provider, walletAddress);
      const rawAmount = BitcoinUtils.expandToDecimals(amt, tok.decimals);

      // 1. Approve staking contract
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenContract = getContract<IOP20Contract>(tok.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const stakingAddr = Address.fromString(STAKING_ADDRESS) as any;
      const approveSim = await tokenContract.increaseAllowance(stakingAddr, rawAmount);
      if (approveSim.revert) throw new Error(`Approval failed: ${approveSim.revert}`);
      await approveSim.sendTransaction(txParams);

      // Wait for approval
      await new Promise(r => setTimeout(r, 30000));

      // 2. Stake
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stakingContract = getContract<any>(STAKING_ADDRESS, STAKING_ABI, provider, NETWORK, senderAddr as any);
      const stakeSim = await stakingContract.stake(rawAmount);
      if ((stakeSim as CallResult).revert) throw new Error(`Stake failed: ${(stakeSim as CallResult).revert}`);
      const receipt = await (stakeSim as CallResult).sendTransaction(txParams);

      setResult({ type: 'success', msg: `Staked ${amt} ${selectedToken}! TX: ${receipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: receipt.transactionId || '', tokenA: selectedToken, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress });
    } catch (e) {
      setResult({ type: 'error', msg: e instanceof Error ? e.message : 'Staking failed' });
    } finally {
      setStaking(false);
    }
  }, [walletAddress, walletInstance, stakeAmount, selectedToken, provider, senderAddr, tok, openConnectModal]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 4 }}>🏦 Staking</h2>
        <p style={{ color: 'var(--t3)', fontSize: '.78rem' }}>Stake your tokens to earn rewards</p>
      </div>

      {!STAKING_DEPLOYED && (
        <div className="P" style={{ padding: 16, marginBottom: 16, border: '1px solid rgba(234,179,8,.2)', background: 'rgba(234,179,8,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: '1.1rem' }}>🚧</span>
            <span style={{ fontWeight: 700, color: 'var(--y)' }}>Staking Contract — Coming Soon</span>
          </div>
          <p style={{ fontSize: '.75rem', color: 'var(--t3)', lineHeight: 1.5 }}>
            The staking contract is being prepared for deployment. The UI below shows the interface
            that will be available once the contract is live on OPNet testnet. You'll be able to
            stake MINE or VIBE tokens and earn rewards.
          </p>
        </div>
      )}

      {/* APR & Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Projected APR</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--g)', fontFamily: 'var(--fm)' }}>{apr}%</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Total Staked</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--p)', fontFamily: 'var(--fm)' }}>{totalStaked.toLocaleString()}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Your Staked</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--o)', fontFamily: 'var(--fm)' }}>{userStaked.toLocaleString()}</div>
        </div>
        <div className="P" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Rewards</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--g)', fontFamily: 'var(--fm)' }}>{userRewards.toLocaleString()}</div>
        </div>
      </div>

      {/* Staking Interface */}
      <div className="P" style={{ padding: 20, marginBottom: 16 }}>
        <div className="Lb" style={{ marginBottom: 12 }}>Stake Tokens</div>

        {/* Token selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['MINE', 'VIBE'] as const).map(sym => (
            <button key={sym} onClick={() => setSelectedToken(sym)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                border: selectedToken === sym ? '2px solid var(--p)' : '1px solid var(--bd)',
                background: selectedToken === sym ? 'rgba(168,85,247,.08)' : 'var(--bg3)',
                color: selectedToken === sym ? 'var(--p)' : 'var(--t2)',
                fontWeight: 700, fontSize: '.82rem', cursor: 'pointer', fontFamily: 'var(--ff)',
                transition: 'all .2s',
              }}>
              {TESTNET_CONTRACTS[sym].icon} ${sym}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <input
            type="number"
            value={stakeAmount}
            onChange={e => setStakeAmount(e.target.value)}
            placeholder="Amount to stake"
            style={{
              width: '100%', padding: '14px 80px 14px 14px', borderRadius: 10,
              border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--w)',
              fontSize: '.9rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => setStakeAmount('1000')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              padding: '6px 14px', borderRadius: 6, border: '1px solid var(--p)',
              background: 'rgba(168,85,247,.1)', color: 'var(--p)', cursor: 'pointer',
              fontSize: '.7rem', fontWeight: 700, fontFamily: 'var(--ff)',
            }}>
            MAX
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doStake} disabled={staking || !stakeAmount}
            style={{
              flex: 2, padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', color: '#fff',
              fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--ff)',
              opacity: staking || !stakeAmount ? 0.5 : 1,
              transition: 'all .2s',
            }}>
            {staking ? '⏳ Staking...' : `Stake ${selectedToken}`}
          </button>
          <button onClick={() => { if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Not yet available' }); return; } }}
            disabled={unstaking || userStaked === 0}
            style={{
              flex: 1, padding: '14px', borderRadius: 10,
              border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)',
              color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: '.8rem', fontFamily: 'var(--ff)',
              opacity: unstaking || userStaked === 0 ? 0.5 : 1,
            }}>
            {unstaking ? '⏳...' : 'Unstake'}
          </button>
          <button onClick={() => { if (!STAKING_DEPLOYED) { setResult({ type: 'error', msg: 'Not yet available' }); return; } }}
            disabled={claiming || userRewards === 0}
            style={{
              flex: 1, padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--g), #16a34a)', color: '#000',
              fontWeight: 700, fontSize: '.8rem', fontFamily: 'var(--ff)',
              opacity: claiming || userRewards === 0 ? 0.5 : 1,
            }}>
            {claiming ? '⏳...' : 'Claim'}
          </button>
        </div>

        {/* Result */}
        {result && (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 8,
            background: result.type === 'success' ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)',
            border: `1px solid ${result.type === 'success' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
            fontSize: '.75rem', color: result.type === 'success' ? 'var(--g)' : '#ef4444',
          }}>
            {result.msg}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="P" style={{ padding: 16 }}>
        <div className="Lb" style={{ marginBottom: 10 }}>How Staking Works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { step: '1', title: 'Choose Token', desc: 'Select MINE or VIBE to stake' },
            { step: '2', title: 'Approve & Stake', desc: 'Approve the staking contract, then stake your tokens' },
            { step: '3', title: 'Earn Rewards', desc: 'Rewards accumulate every epoch (~5 blocks)' },
            { step: '4', title: 'Claim or Unstake', desc: 'Claim rewards anytime, or unstake to withdraw' },
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
