import React, { useState, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, OP_20_ABI, type IOP20Contract, type CallResult } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { NETWORK } from '../config';
import { getProvider } from '../contractCache';
import { buildTxParams, withRetry, formatTxError } from '../txUtils';
import { useOps } from '../contexts/OpsContext';
import MultiSenderSetup, { parseRecipients, formatAmount } from './multisender/MultiSenderSetup';
import MultiSenderReview from './multisender/MultiSenderReview';
import MultiSenderProgress, { type SendResult } from './multisender/MultiSenderProgress';

type WizardStep = 1 | 2 | 3 | 4;

const stepBadge = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: '.72rem', fontFamily: 'var(--fm)',
  background: done ? 'var(--g)' : active ? 'var(--o)' : 'var(--bg3)',
  color: done || active ? '#000' : 'var(--t3)',
  border: `2px solid ${done ? 'var(--g)' : active ? 'var(--o)' : 'var(--bd)'}`, transition: 'all .3s',
});
const stepConnector = (done: boolean): React.CSSProperties => ({ flex: 1, height: 2, background: done ? 'var(--g)' : 'var(--bd)', transition: 'background .3s' });

const MultiSender: React.FC = () => {
  const { walletAddress, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const { trackOp, completeOp } = useOps();
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedToken, setSelectedToken] = useState('');
  const [customAddress, setCustomAddress] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(8);
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [sendComplete, setSendComplete] = useState(false);

  const connected = !!walletAddress;
  const tokenAddr = useCustom ? customAddress.trim() : selectedToken;
  const recipients = useMemo(() => parseRecipients(rawInput), [rawInput]);
  const validRecipients = useMemo(() => recipients.filter(r => r.valid), [recipients]);
  const invalidCount = recipients.length - validRecipients.length;
  const totalAmount = useMemo(() => validRecipients.reduce((sum, r) => sum + parseFloat(r.amount), 0), [validRecipients]);
  const estimatedGasSats = validRecipients.length * 5000;
  const estimatedGasBtc = (estimatedGasSats / 1e8).toFixed(6);
  const completedCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'error').length;
  const progressPct = results.length > 0 ? (completedCount + failedCount) / results.length * 100 : 0;

  const executeBatchSend = useCallback(async () => {
    if (!walletAddress || !tokenAddr || validRecipients.length === 0) return;
    setSending(true); setSendComplete(false);
    setResults(validRecipients.map(r => ({ address: r.address, amount: r.amount, status: 'pending' as const })));
    for (let i = 0; i < validRecipients.length; i++) {
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'sending' } : r));
      try {
        const rawSender = senderAddr || walletAddress;
        const senderAddress = typeof rawSender === 'string' ? Address.fromString(rawSender) : rawSender;
        const contract = getContract<IOP20Contract>(tokenAddr, OP_20_ABI, provider, NETWORK, senderAddress as Address);
        const recipient = validRecipients[i];
        if (!recipient) continue;
        const recipientAddr = Address.fromString(recipient.address);
        const amount = formatAmount(recipient.amount, tokenDecimals);
        const sim = await withRetry(async () => { const s = await contract.transfer(recipientAddr, amount); if ((s as CallResult).revert) throw new Error((s as CallResult).revert as string); return s; });
        const txParams = await buildTxParams(provider, walletAddress);
        const tOpId = `transfer_${i}_${Date.now()}`;
        trackOp({ id: tOpId, market: 'transfer', orderId: `#${i + 1}/${validRecipients.length}`, direction: '', role: '', step: `Sending ${recipient.amount} to ${recipient.address.slice(0, 12)}...` });
        await (sim as CallResult).sendTransaction(txParams);
        completeOp(tOpId);
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r));
      } catch (e) {
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: formatTxError(e) } : r));
      }
    }
    setSending(false); setSendComplete(true);
  }, [walletAddress, tokenAddr, validRecipients, tokenDecimals, provider, completeOp, senderAddr, trackOp]);

  const canGoNext = (): boolean => { if (step === 1) return tokenAddr.length > 10; if (step === 2) return validRecipients.length > 0; if (step === 3) return connected; return false; };
  const goNext = (): void => { if (canGoNext() && step < 4) setStep((step + 1) as WizardStep); };
  const goBack = (): void => { if (step > 1) setStep((step - 1) as WizardStep); };
  const resetWizard = (): void => { setStep(1); setSelectedToken(''); setCustomAddress(''); setTokenSymbol(''); setUseCustom(false); setRawInput(''); setResults([]); setSending(false); setSendComplete(false); };

  return (
    <div>
      <div className="Pg ms-header">
        <div className="ms-title">Multi-Sender</div>
        <div className="ms-desc">Batch transfer OP-20 tokens to multiple recipients in one session. Select a token, paste your recipient list, review, and send.</div>
      </div>
      <div className="flex-center" style={{ gap: 0, padding: '0 12px', maxWidth: 480, margin: '0 auto 18px' }}>
        {[1, 2, 3, 4].map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ ...stepBadge(step === s, step > s), cursor: step > s ? 'pointer' : 'default' }} onClick={() => { if (step > s) setStep(s as WizardStep); }} title={['Select Token', 'Recipients', 'Review', 'Send'][i]}>{step > s ? '\u2713' : s}</div>
            {i < 3 && <div style={stepConnector(step > s)} />}
          </React.Fragment>
        ))}
      </div>
      <div className="ms-step-label">{['Select Token', 'Add Recipients', 'Review & Confirm', 'Send Transfers'][step - 1]}</div>

      <MultiSenderSetup step={step} selectedToken={selectedToken} setSelectedToken={setSelectedToken} customAddress={customAddress} setCustomAddress={setCustomAddress} tokenDecimals={tokenDecimals} setTokenDecimals={setTokenDecimals} tokenSymbol={tokenSymbol} setTokenSymbol={setTokenSymbol} useCustom={useCustom} setUseCustom={setUseCustom} rawInput={rawInput} setRawInput={setRawInput} recipients={recipients} validRecipients={validRecipients} invalidCount={invalidCount} totalAmount={totalAmount} />
      {step === 3 && <MultiSenderReview tokenSymbol={tokenSymbol} validRecipients={validRecipients} totalAmount={totalAmount} estimatedGasSats={estimatedGasSats} estimatedGasBtc={estimatedGasBtc} />}
      {step === 4 && <MultiSenderProgress results={results} sending={sending} sendComplete={sendComplete} tokenSymbol={tokenSymbol} completedCount={completedCount} failedCount={failedCount} progressPct={progressPct} validRecipientsCount={validRecipients.length} onStartSend={executeBatchSend} onReset={resetWizard} />}

      {step < 4 && (
        <div className="flex-between mt-14 gap-10">
          <button className="btn-s" onClick={goBack} disabled={step === 1} style={{ padding: '10px 20px', fontSize: '.78rem', opacity: step === 1 ? 0.4 : 1, cursor: step === 1 ? 'not-allowed' : 'pointer' }}>Back</button>
          <button className="btn-p" onClick={goNext} disabled={!canGoNext()} style={{ padding: '10px 24px', fontSize: '.78rem', fontWeight: 700, opacity: canGoNext() ? 1 : 0.4, cursor: canGoNext() ? 'pointer' : 'not-allowed' }}>{step === 3 ? 'Proceed to Send' : 'Next'}</button>
        </div>
      )}
      {step === 4 && !sendComplete && !sending && <div className="mt-10"><button className="btn-s fs-74" onClick={goBack} style={{ padding: '8px 16px' }}>Back to Review</button></div>}
      <div className="ms-info-footer">Transfers are executed sequentially. Each transfer requires a wallet signature. Ensure you have enough BTC for gas fees (~5K sats per transfer).</div>
    </div>
  );
};

export default React.memo(MultiSender);
