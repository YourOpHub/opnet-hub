import React, { useCallback } from 'react';
import { logger } from '../../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { BitcoinUtils, type CallResult, type TransactionParameters, type IOP20Contract } from 'opnet';
import { getContract } from 'opnet';
import { LAUNCHPAD_ABI } from '../../abis';
import { getProvider } from '../../contractCache';
import { NETWORK } from '../../config';
import { getContractOpscanUrl, getTxUrl } from '../../contracts';
import { buildTxParams, withRetry, formatTxError } from '../../txUtils';
import type { LaunchToken, TradeRecord } from '../../launchpad/types';
import { getProgress, isGraduated, fmtNum, hashColor, genLogo, timeAgo, GRADUATION_PCT } from '../../launchpad/types';
import { addTrade } from '../../launchpad/store';
import { useOps } from '../../contexts/OpsContext';

interface MintableOP20 extends IOP20Contract { publicMint(amount: bigint): Promise<CallResult>; }

export interface LaunchpadDeployProgressProps {
  selected: LaunchToken | null;
  userBal: number;
  holderCount: number;
  opscanHolderList: Array<{ address: string; balance: string }>;
  opscanHolders: number | null;
  mintAmt: string; setMintAmt: (v: string) => void;
  minting: boolean; setMinting: (v: boolean) => void;
  mintStep: string; setMintStep: (v: string) => void;
  onTokensChange: (tokens: LaunchToken[]) => void;
  onSelectedChange: (token: LaunchToken) => void;
  syncToken: (addr: string) => Promise<void>;
  syncBalance: (addr: string) => Promise<void>;
}

const LaunchpadDeployProgress: React.FC<LaunchpadDeployProgressProps> = ({
  selected, userBal, holderCount, opscanHolderList, opscanHolders,
  mintAmt, setMintAmt, minting, setMinting, mintStep, setMintStep,
  onTokensChange, onSelectedChange, syncToken, syncBalance,
}) => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const { trackOp, completeOp } = useOps();

  const handleMint = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (!selected) return;
    const amount = parseFloat(mintAmt);
    if (!amount || amount <= 0) return;
    if (!selected.address.startsWith('opt1sq')) { setMintStep('Invalid contract address'); setTimeout(() => setMintStep(''), 3000); return; }
    setMinting(true); setMintStep('Preparing...');
    try {
      const provider = getProvider();
      const rawAmount = BitcoinUtils.expandToDecimals(amount, selected.decimals);
      const contract = getContract<MintableOP20>(selected.address, LAUNCHPAD_ABI, provider, NETWORK, senderAddr);
      setMintStep('Simulating publicMint...');
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      const callRes = sim as CallResult;
      if (callRes.revert) throw new Error(`Reverted: ${callRes.revert}`);
      if (callRes.sendTransaction == null) throw new Error('Simulation failed — contract may not support publicMint');
      setMintStep('Sign in your wallet...');
      const txParams = await buildTxParams(provider, walletAddress);
      const lpOpId = `mint_${selected.symbol}_${Date.now()}`;
      trackOp({ id: lpOpId, market: 'mint', orderId: selected.symbol, direction: '', role: '', step: `Minting ${amount.toLocaleString()} ${selected.symbol}...` });
      const receipt = await callRes.sendTransaction(txParams as TransactionParameters);
      completeOp(lpOpId);
      const txHash = receipt?.transactionId || '';
      setMintStep(`TX: ${txHash ? txHash.slice(0, 20) + '...' : 'broadcast'}`);
      const trade: TradeRecord = { id: `t_${Date.now()}`, type: 'buy', amount, price: 0, wallet: `${walletAddress.slice(0, 10)}...${walletAddress.slice(-4)}`, txHash, timestamp: Date.now() };
      const updated = addTrade(selected.address, trade);
      onTokensChange(updated);
      const refreshed = updated.find(t => t.address === selected.address);
      if (refreshed) onSelectedChange(refreshed);
      setMintStep('TX broadcast! Waiting for confirmation...'); setMintAmt('');
      const startBal = userBal;
      const pollMint = async (): Promise<void> => {
        for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 15000)); await syncToken(selected.address); await syncBalance(selected.address); if (userBal !== startBal) break; }
        setMintStep('Confirmed!'); setTimeout(() => setMintStep(''), 4000);
      };
      pollMint().catch((e) => { logger.warn('[LaunchpadDeployProgress] Mint poll error:', e); setMintStep(''); });
    } catch (e) { logger.error('[LP Mint]', e); setMintStep(formatTxError(e)); setTimeout(() => setMintStep(''), 6000); } finally { setMinting(false); }
  }, [walletAddress, senderAddr, selected, mintAmt, openConnectModal, syncToken, syncBalance, trackOp, completeOp, userBal, setMinting, setMintStep, setMintAmt, onTokensChange, onSelectedChange]);

  if (!selected) return (<div className="lp-main"><div className="flex-center-full c-t4 fs-82 h-full">Select a contract from the sidebar</div></div>);

  const isReal = selected.address.startsWith('opt1sq');
  const progress = getProgress(selected);
  const grad = isGraduated(selected);
  const [selColor] = hashColor(selected.symbol);
  const holderBorderStyle = { padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)' };

  return (
    <div className="lp-main">
      <div className="m-auto p-16-20 max-w-720">
        {/* Header */}
        <div className="flex-center gap-14 mb-16">
          <img src={selected.image || genLogo(selected.symbol)} alt={`${selected.symbol} token logo`} className="br-50 w-52 h-52" style={{ border: `2px solid ${selColor}44` }} />
          <div className="flex-1">
            <div className="flex-center gap-8 flex-wrap">
              <span className="fw-800 c-w fs-110">{selected.name}</span>
              <span className="text-mono fw-700 fs-90" style={{ color: selColor }}>${selected.symbol}</span>
              {grad && <span className="c-g fw-700 fs-xs br-6 p-2-8 tag-grad">GRADUATED</span>}
              {isReal && <span className="c-o fw-600 br-6 fs-56 p-2-8" style={{ background: 'rgba(247,147,26,.1)' }}>ON-CHAIN</span>}
            </div>
            <div className="fs-xs c-t4 text-mono mt-2 word-break">{selected.address}</div>
            <div className="flex-center gap-10 mt-4">
              {selected.twitter && <a href={`https://x.com/${selected.twitter}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x1D54F; Twitter</a>}
              {selected.website && <a href={`https://${selected.website}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x1F310; Website</a>}
              {selected.telegram && <a href={`https://t.me/${selected.telegram}`} target="_blank" rel="noopener noreferrer" className="fs-xs c-c2 no-decoration">&#x2708; Telegram</a>}
            </div>
          </div>
        </div>
        {selected.description && <div className="fs-72 c-t3 mb-14 lh-15">{selected.description}</div>}

        {/* Supply Info */}
        <div className="P p-14 mb-12">
          <div className="Lb mb-8">Supply</div>
          <div className="mb-10">
            <div className="flex-between mb-4 fs-58 c-t4">
              <span>Minted: {fmtNum(selected.mintedSupply)} / {fmtNum(selected.publicMintSupply)}</span>
              <span className="fw-700" style={{ color: grad ? 'var(--g)' : selColor }}>{(progress * 100).toFixed(1)}%</span>
            </div>
            <div className="br-4 ov-hidden progress-bar-md">
              <div className="br-4" style={{ height: '100%', background: grad ? 'var(--g)' : `linear-gradient(90deg, ${selColor}, var(--o))`, width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .5s' }} />
            </div>
          </div>
          <div className="d-grid fs-66 grid-1-1" style={{ gap: '6px 16px' }}>
            {[['Total Supply', fmtNum(selected.totalSupply)], ['Public Mint', fmtNum(selected.publicMintSupply)], ['Max / TX', fmtNum(selected.maxMintPerTx)], ['Decimals', String(selected.decimals)], ['Holders', String(holderCount)], ['Creator', selected.creator.slice(0, 16) + '...'], ['Created', timeAgo(selected.createdAt)]].map(([k, v]) => (
              <div key={k} className="flex-between"><span className="c-t4">{k}</span><span className="c-t2 text-mono fs-xs">{v}</span></div>
            ))}
          </div>
          {walletAddress && userBal > 0 && <div className="mt-8 br-8 fs-66 p-6-10 tag-onchain">Your balance: <strong className="c-g text-mono">{fmtNum(userBal)} {selected.symbol}</strong></div>}
        </div>

        {/* Holders */}
        {opscanHolderList.length > 0 ? (
          <div className="P p-14 mb-12">
            <div className="Lb mb-8">Top Holders ({opscanHolders ?? opscanHolderList.length})<span className="fs-50 c-t4 fw-400 ml-6">via OPScan</span></div>
            <div className="max-h-200-overflow" role="list" aria-label="Top token holders">
              {opscanHolderList.map((h, i) => (
                <div key={i} className="flex-between fs-66" style={holderBorderStyle}>
                  <div className="flex-center gap-8"><span className="c-t4 text-mono min-w-20">#{i + 1}</span><span className="c-t2 text-mono">{h.address}</span></div>
                  <span className="text-mono fw-600 c-w fs-xs">{(() => { try { return fmtNum(Number(BigInt(h.balance)) / Math.pow(10, selected.decimals)); } catch (e) { logger.warn('[Launchpad] holder balance fmt:', e); return h.balance; } })()}</span>
                </div>))}
            </div>
          </div>
        ) : selected.trades.length > 0 && (() => {
          const bals: Record<string, number> = {};
          for (const tr of selected.trades) bals[tr.wallet] = (bals[tr.wallet] || 0) + tr.amount;
          const sorted = Object.entries(bals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
          if (sorted.length === 0) return null;
          return (
            <div className="P p-14 mb-12">
              <div className="Lb mb-8">Top Holders ({sorted.length})</div>
              <div className="max-h-200-overflow">
                {sorted.map(([wallet, amount], i) => (
                  <div key={wallet} className="flex-between fs-66" style={holderBorderStyle}>
                    <div className="flex-center gap-8"><span className="c-t4 text-mono min-w-20">#{i + 1}</span><span className="c-t2 text-mono">{wallet.length > 20 ? wallet.slice(0, 12) + '...' + wallet.slice(-6) : wallet}</span></div>
                    <div className="flex-center gap-6"><span className="text-mono fw-600 c-w">{fmtNum(amount)}</span><span className="c-t4 fs-56">{selected.symbol}</span></div>
                  </div>))}
              </div>
            </div>);
        })()}

        {/* Mint Panel */}
        {selected.status === 'pending_confirm' ? (
          <div className="P p-14 mb-12 text-center">
            <div className="fs-120 mb-6" style={{ animation: 'spin 2s linear infinite' }}>&#x23F3;</div>
            <div className="fw-700 c-y fs-82 mb-4">Awaiting Confirmation</div>
            <div className="fs-72 c-t3">Contract is being deployed. Wait ~5 blocks for on-chain confirmation before minting.</div>
          </div>
        ) : !grad ? (
          <div className="P p-14 mb-12">
            <div className="Lb mb-8">Public Mint</div>
            <div className="mb-6">
              <div className="flex-between mb-4 fs-62 c-t3"><span>Amount</span><span className="fw-700 c-w text-mono">{mintAmt ? fmtNum(Number(mintAmt)) : '0'} / {fmtNum(selected.maxMintPerTx)}</span></div>
              <input type="range" aria-label="Mint amount" min={0} max={selected.maxMintPerTx} step={Math.max(1, Math.floor(selected.maxMintPerTx / 100))} value={Number(mintAmt) || 0} onChange={e => setMintAmt(e.target.value === '0' ? '' : e.target.value)} className="w-full mb-4" style={{ accentColor: selColor }} />
              <div className="d-flex gap-4">
                {[25, 50, 75, 100].map(pct => (<button key={pct} onClick={() => setMintAmt(String(Math.floor(selected.maxMintPerTx * pct / 100)))} className="flex-1 br-8 c-t3 fs-56 pointer text-mono" style={{ padding: '4px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--bd)' }}>{pct}%</button>))}
              </div>
            </div>
            <button onClick={handleMint} disabled={minting || !mintAmt} className="lbtn w-full" style={{ opacity: minting ? 0.6 : 1 }}>{minting ? mintStep || 'Minting...' : walletAddress ? `Mint ${selected.symbol}` : 'Connect Wallet'}</button>
            {!minting && mintStep && <div className="mt-6 fs-62 text-center" role="alert" style={{ color: mintStep.includes('Minted') ? 'var(--g)' : '#ef4444' }}>{mintStep}</div>}
            <div className="mt-8 c-t4 text-center fs-54">On-chain publicMint &middot; Costs ~1K sats BTC gas</div>
          </div>
        ) : (
          <div className="P p-14 mb-12 text-center">
            <div className="mb-6 fs-160">&#x1F393;</div>
            <div className="fw-700 c-g fs-82 mb-4">Graduated!</div>
            <div className="fs-72 c-t3">Public mint complete. Trade on <strong>Swap</strong> page via MotoSwap AMM.</div>
          </div>
        )}

        {/* Links & Trade */}
        <div className="P p-14 mb-12">
          <div className="Lb mb-8">Links & Trade</div>
          <div className="flex-center gap-6 flex-wrap mb-8">
            {isReal && <a href={getContractOpscanUrl(selected.address)} target="_blank" rel="noopener noreferrer" className="br-8 c-c fs-62 no-decoration fw-600 p-4-10 bg-info-b">OPScan</a>}
            {isReal && selected.txHash && <a href={getTxUrl(selected.txHash)} target="_blank" rel="noopener noreferrer" className="br-8 c-o fs-62 no-decoration fw-600 p-4-10 bg-info-o-08">Deploy TX</a>}
          </div>
          <div className="fs-sm c-t3 lh-15">Trade on <strong>Swap</strong> page via MotoSwap AMM pools.</div>
        </div>

        {/* Recent Activity */}
        <div className="P p-14">
          <div className="Lb mb-8">Recent Activity</div>
          <div className="max-h-200-overflow" role="list" aria-label="Recent activity">
            {selected.trades.slice().reverse().slice(0, 15).map(tr => (
              <div key={tr.id} className="flex-between fs-62" style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                <div className="flex-center gap-6"><span className="c-g fw-700">MINT</span><span className="c-t2 text-mono">{fmtNum(tr.amount)} {selected.symbol}</span></div>
                <div className="flex-center gap-8 c-t4"><span>{tr.wallet.slice(0, 8)}...</span><span>{timeAgo(tr.timestamp)}</span></div>
              </div>))}
            {selected.trades.length === 0 && <div className="c-t4 fs-sm text-center p-16">No mints yet. Be the first!</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LaunchpadDeployProgress);
