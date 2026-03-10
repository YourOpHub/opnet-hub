import React, { useState, useEffect, useCallback } from 'react';
import { getContract, type CallResult, type BaseContractProperties } from 'opnet';
import { SPLITTER_DUMMY_ABI } from '../../abis';
import * as opnet from '../../opnet';
import { DEPLOYED_CONTRACTS, POOL_ADDRESS } from '../../contracts';
import { NETWORK } from '../../config';
import { buildTxParams, formatTxError, waitForNextBlock } from '../../txUtils';
import { useTokenTools } from '../../hooks/useTokenTools';
import { cardS, inputS, btnS, monoSm, copyBtnS } from './toolStyles';

const UTXOSplitter = React.memo(function UTXOSplitter() {
  const { walletAddress, senderAddr, openConnectModal, provider, trackOp, completeOp, failOp } = useTokenTools();

  const [utxos, setUtxos] = useState<Array<{ transactionId: string; outputIndex: number; value: string | number }>>([]);
  const [, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [splitCount, setSplitCount] = useState(5);
  const [splitting, setSplitting] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [selectedUtxo, setSelectedUtxo] = useState<number | null>(null); // index into utxos array

  // Fetch UTXOs on mount when wallet connected
  const fetchUTXOs = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const [u, b] = await Promise.all([
        opnet.getUTXOs(walletAddress),
        opnet.getBalance(walletAddress),
      ]);
      setUtxos(u);
      setBalance(b);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to fetch UTXOs'); }
    finally { setLoading(false); }
  }, [walletAddress]);

  useEffect(() => { void fetchUTXOs(); }, [fetchUTXOs]);

  const getUtxoValue = (u: { value: string | number }) => {
    const v = typeof u.value === 'string' ? (u.value.startsWith('0x') ? Number(BigInt(u.value)) : Number(u.value)) : u.value;
    return v;
  };

  const totalSats = utxos.reduce((s, u) => s + getUtxoValue(u), 0);

  // If a specific UTXO is selected, split only that one
  const splitSats = selectedUtxo !== null && utxos[selectedUtxo] ? getUtxoValue(utxos[selectedUtxo]) : totalSats;

  // Estimate: 250 vB overhead + 43 vB per output, at 2 sat/vB
  const estimatedFee = (250 + splitCount * 43) * 2;
  const perSplitSats = splitSats > estimatedFee ? Math.floor((splitSats - estimatedFee) / splitCount) : 0;
  const isDust = perSplitSats < 546;

  // We use a dummy contract call with extraOutputs to create a self-transfer
  // The simplest approach: call the pool's getReserves (a view call that won't change state)
  // and attach extraOutputs that split BTC to self
  const handleSplit = useCallback(async () => {
    if (!walletAddress || !senderAddr) { openConnectModal(); return; }
    if (isDust || perSplitSats <= 0 || splitCount < 2) return;

    setSplitting(true); setErr(''); setStep('Preparing UTXO split...');
    try {
      // Build a dummy view call to SimplePool getReserves
      // This is a read-only call that will succeed, we just need the tx infrastructure
      // to attach extraOutputs for the split

      // Use pool contract if available, otherwise use any known contract
      const targetContract = POOL_ADDRESS || DEPLOYED_CONTRACTS.MINE.address;
      interface IReservesContract extends BaseContractProperties {
        getReserves(): Promise<CallResult>;
      }
      const contract = getContract<IReservesContract>(targetContract, SPLITTER_DUMMY_ABI, provider, NETWORK, senderAddr);

      setStep(`Simulating split into ${splitCount} UTXOs...`);
      const sim = await contract.getReserves();
      if ((sim as CallResult).revert) throw new Error(`Simulation failed: ${(sim as CallResult).revert}`);

      // Build extraOutputs: N-1 outputs to self (the change output is the Nth)
      const tp = await buildTxParams(provider, walletAddress);
      const extraOutputs = [];
      for (let i = 0; i < splitCount - 1; i++) {
        extraOutputs.push({
          address: walletAddress,
          value: Number(perSplitSats),
        });
      }
      (tp as unknown as Record<string, unknown>).extraOutputs = extraOutputs;
      // Increase max spend to cover the selected UTXO(s)
      (tp as unknown as Record<string, unknown>).maximumAllowedSatToSpend = BigInt(splitSats);

      setStep(`Sending split tx (${splitCount} UTXOs of ~${perSplitSats.toLocaleString()} sats)...`);
      const opId = `split_${Date.now()}`;
      trackOp({ id: opId, market: 'split', orderId: `${splitCount}x`, direction: '', role: '', step: `Splitting into ${splitCount} UTXOs...` });
      try {
        await (sim as CallResult).sendTransaction(tp);
        setStep('');
        setErr('');
        setStep('Waiting for block confirmation...');
        await waitForNextBlock(provider, setStep, 90_000);
        completeOp(opId);
        setStep('');
        void fetchUTXOs();
      } catch (e2) {
        failOp(opId, formatTxError(e2));
        throw e2;
      }
    } catch (e) {
      setErr(formatTxError(e));
      setStep('');
    } finally { setSplitting(false); }
  }, [walletAddress, senderAddr, splitCount, perSplitSats, isDust, provider, openConnectModal, fetchUTXOs, completeOp, failOp, splitSats, trackOp]);

  return (
    <div style={cardS}>
      {!walletAddress ? (
        <div className="text-center" style={{ padding: '24px 16px' }}>
          <div className="fs-140 mb-8">✂️</div>
          <div className="fs-82 fw-700 mb-6">UTXO Splitter</div>
          <p className="fs-72 c-t3 mb-12" style={{ maxWidth: 400, margin: '0 auto 12px' }}>
            Split your BTC into multiple UTXOs for parallel transactions.
            Useful when you need to submit multiple OPNet operations quickly.
          </p>
          <button style={btnS} onClick={openConnectModal}>Connect Wallet</button>
        </div>
      ) : (
        <>
          {/* Current UTXO status */}
          <div className="d-grid gap-8 mb-16" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="text-center p-10 br-12" style={{ background: 'rgba(247,147,26,.06)' }}>
              <div className="fw-700 c-o" style={{ ...monoSm }}>{(totalSats / 1e8).toFixed(6)}</div>
              <div className="fs-50 c-t4">BTC Balance</div>
            </div>
            <div className="text-center p-10 br-12" style={{ background: 'rgba(14,165,233,.06)' }}>
              <div className="fw-700 c-c" style={{ ...monoSm }}>{utxos.length}</div>
              <div className="fs-50 c-t4">Current UTXOs</div>
            </div>
            <div className="text-center p-10 br-12" style={{ background: 'rgba(167,139,250,.06)' }}>
              <div className="fw-700 c-p" style={{ ...monoSm }}>{totalSats.toLocaleString()}</div>
              <div className="fs-50 c-t4">Total Sats</div>
            </div>
          </div>

          {/* Visual UTXO grid */}
          {utxos.length > 0 && (
            <div className="mb-12">
              <label className="d-block fs-68 fw-600 c-t2 mb-6">
                Your UTXOs {selectedUtxo !== null ? `(#${selectedUtxo + 1} selected)` : '(click to select)'}
              </label>
              <div className="d-flex gap-6 flex-wrap">
                {utxos.map((u, i) => {
                  const v = getUtxoValue(u);
                  const maxV = Math.max(...utxos.map(getUtxoValue));
                  const size = Math.max(36, Math.min(80, 36 + (v / maxV) * 44));
                  const isSelected = selectedUtxo === i;
                  return (
                    <div key={`${u.transactionId}:${u.outputIndex}`}
                      onClick={() => setSelectedUtxo(isSelected ? null : i)}
                      className="br-8 pointer d-flex flex-col-dir ai-center jc-center fs-52" style={{ width: size, height: size, background: isSelected ? 'rgba(247,147,26,.2)' : 'rgba(255,255,255,.04)', border: `2px solid ${isSelected ? 'var(--o)' : 'rgba(255,255,255,.08)'}`, transition: 'all .15s', color: isSelected ? 'var(--o)' : 'var(--t3)' }}>
                      <div className="fw-700 fs-56" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v}
                      </div>
                      <div className="fs-44 c-t4">sats</div>
                    </div>
                  );
                })}
              </div>
              {selectedUtxo !== null && (
                <div className="fs-58 c-t4 mt-4">
                  Splitting UTXO #{selectedUtxo + 1}: {getUtxoValue(utxos[selectedUtxo]!).toLocaleString()} sats
                </div>
              )}
              {selectedUtxo === null && utxos.length > 1 && (
                <div className="fs-58 c-t4 mt-4">
                  No UTXO selected — will split all ({totalSats.toLocaleString()} sats)
                </div>
              )}
            </div>
          )}

          {/* Split controls */}
          <div className="mb-12">
            <label className="d-block fs-70 fw-600 c-t2 mb-6">
              Split into {splitCount} UTXOs
            </label>
            <div className="d-flex gap-8 ai-center">
              <input type="range" min="2" max="20" value={splitCount}
                onChange={e => setSplitCount(parseInt(e.target.value))}
                className="flex-1" style={{ accentColor: '#F7931A' }} />
              <input type="number" min="2" max="20" value={splitCount}
                onChange={e => setSplitCount(Math.min(20, Math.max(2, parseInt(e.target.value) || 2)))}
                className="text-center" style={{ ...inputS, width: 60, padding: '6px 8px' }} />
            </div>
          </div>

          {/* Preview */}
          <div className="br-12 mb-12" style={{ padding: '12px 14px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
            <div className="fs-72 c-t2 mb-6 fw-600">Preview</div>
            <div className="d-grid gap-6 fs-72" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <span className="c-t3">Total balance:</span>
              <span className="fw-700 text-right" style={{ ...monoSm }}>{totalSats.toLocaleString()} sats</span>
              <span className="c-t3">Est. fee:</span>
              <span className="fw-700 text-right c-y" style={{ ...monoSm }}>~{estimatedFee.toLocaleString()} sats</span>
              <span className="c-t3">Per UTXO:</span>
              <span className="fw-700 text-right" style={{ ...monoSm, color: isDust ? 'var(--r)' : 'var(--g)' }}>
                ~{perSplitSats.toLocaleString()} sats
              </span>
            </div>
            {isDust && (
              <div className="mt-8 fs-68 c-r fw-600">
                Per-UTXO amount below dust limit (546 sats). Reduce split count.
              </div>
            )}
          </div>

          {/* Quick presets */}
          <div className="d-flex gap-6 mb-12 flex-wrap">
            {[2, 3, 5, 8, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setSplitCount(n)}
                className="fs-62 br-8 pointer fw-600" style={{ padding: '4px 10px', border: splitCount === n ? '1px solid rgba(247,147,26,.4)' : '1px solid rgba(255,255,255,.08)', background: splitCount === n ? 'rgba(247,147,26,.12)' : 'rgba(255,255,255,.03)', color: splitCount === n ? 'var(--o)' : 'var(--t3)' }}>
                {n}x
              </button>
            ))}
          </div>

          {step && (
            <div className="fs-72 c-o mb-8" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {step}
            </div>
          )}
          {err && (
            <div className="fs-72 c-r mb-8">
              {err}
            </div>
          )}

          <div className="d-flex gap-8">
            <button className="flex-1" style={{ ...btnS, opacity: splitting || isDust || perSplitSats <= 0 ? 0.5 : 1 }}
              disabled={splitting || isDust || perSplitSats <= 0 || loading}
              onClick={handleSplit}>
              {splitting ? 'Splitting...' : `Split into ${splitCount} UTXOs`}
            </button>
            <button style={{ ...copyBtnS, padding: '8px 12px' }}
              onClick={fetchUTXOs} disabled={loading}>
              {loading ? '...' : 'Refresh'}
            </button>
          </div>

          {/* Info */}
          <div className="mt-12 fs-60 c-t4 lh-15">
            Splitting UTXOs helps with parallel transactions. Each OPNet contract interaction
            needs its own UTXO. If you only have 1 UTXO, you must wait for each tx to confirm
            before sending the next one.
          </div>
        </>
      )}
    </div>
  );
});

export default UTXOSplitter;
