import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { getContract, OP_20_ABI, type IOP20Contract, type CallResult } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { TESTNET_CONTRACTS } from '../contracts';
import { NETWORK } from '../config';
import { getProvider } from '../contractCache';
import { buildTxParams, withRetry, formatTxError } from '../txUtils';

/* ═══════════════════════════════════════════════════════════════
   MultiSender — Batch OP-20 token transfers (4-step wizard)
   ═══════════════════════════════════════════════════════════════ */

interface Recipient {
  address: string;
  amount: string;
  valid: boolean;
}

interface SendResult {
  address: string;
  amount: string;
  status: 'pending' | 'sending' | 'success' | 'error';
  error?: string;
}

type WizardStep = 1 | 2 | 3 | 4;

const KNOWN_TOKENS = [
  {
    symbol: TESTNET_CONTRACTS.MINE.symbol,
    name: TESTNET_CONTRACTS.MINE.name,
    address: TESTNET_CONTRACTS.MINE.address,
    decimals: TESTNET_CONTRACTS.MINE.decimals,
    icon: TESTNET_CONTRACTS.MINE.icon,
  },
  {
    symbol: TESTNET_CONTRACTS.VIBE.symbol,
    name: TESTNET_CONTRACTS.VIBE.name,
    address: TESTNET_CONTRACTS.VIBE.address,
    decimals: TESTNET_CONTRACTS.VIBE.decimals,
    icon: TESTNET_CONTRACTS.VIBE.icon,
  },
];

/* ── Styles ── */

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 14,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 160, resize: 'vertical' as const,
  fontFamily: 'var(--fm)', fontSize: '.74rem', lineHeight: 1.6,
};

const stepBadge = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: '50%', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: '.72rem', fontFamily: 'var(--fm)',
  background: done ? 'var(--g)' : active ? 'var(--o)' : 'var(--bg3)',
  color: done || active ? '#000' : 'var(--t3)',
  border: `2px solid ${done ? 'var(--g)' : active ? 'var(--o)' : 'var(--bd)'}`,
  transition: 'all .3s',
});

const stepConnector = (done: boolean): React.CSSProperties => ({
  flex: 1, height: 2,
  background: done ? 'var(--g)' : 'var(--bd)',
  transition: 'background .3s',
});

/* ── Helpers ── */

function parseRecipients(raw: string): Recipient[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Support comma, space, or tab as delimiter
      const parts = line.split(/[,\s\t]+/).filter(Boolean);
      const address = parts[0] || '';
      const amount = parts[1] || '';
      const amtNum = parseFloat(amount);
      const valid = address.length > 10 && !isNaN(amtNum) && amtNum > 0;
      return { address, amount, valid };
    });
}

function formatAmount(amount: string, decimals: number): bigint {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return 0n;
  // Handle decimal amounts properly
  const [whole, frac = ''] = amount.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(paddedFrac);
}

/* ═══════════════════════════════════════════════════════════════ */

const MultiSender: React.FC = () => {
  const { walletAddress, openConnectModal, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1: Token selection
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [customAddress, setCustomAddress] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(8);
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  // Step 2: Recipients
  const [rawInput, setRawInput] = useState('');

  // Step 4: Sending
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sendComplete, setSendComplete] = useState(false);

  const connected = !!walletAddress;

  // Resolved token address
  const tokenAddr = useCustom ? customAddress.trim() : selectedToken;

  // Parsed recipients
  const recipients = useMemo(() => parseRecipients(rawInput), [rawInput]);
  const validRecipients = useMemo(() => recipients.filter(r => r.valid), [recipients]);
  const invalidCount = recipients.length - validRecipients.length;
  const totalAmount = useMemo(
    () => validRecipients.reduce((sum, r) => sum + parseFloat(r.amount), 0),
    [validRecipients],
  );

  // Step 1 handlers
  const selectKnownToken = useCallback((t: typeof KNOWN_TOKENS[0]) => {
    setSelectedToken(t.address);
    setTokenDecimals(t.decimals);
    setTokenSymbol(t.symbol);
    setUseCustom(false);
  }, []);

  const handleCustomToggle = useCallback(() => {
    setUseCustom(true);
    setSelectedToken('');
    setTokenSymbol('Custom');
  }, []);

  // Step 2 handlers
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) setRawInput(prev => prev ? prev + '\n' + text.trim() : text.trim());
    };
    reader.readAsText(file);
    // Reset file input so the same file can be re-uploaded
    e.target.value = '';
  }, []);

  const addSampleData = useCallback(() => {
    setRawInput(
      'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,100\n' +
      'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa,250\n' +
      'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802,500',
    );
  }, []);

  // Step 4: Execute batch transfers
  const executeBatchSend = useCallback(async () => {
    if (!walletAddress || !tokenAddr || validRecipients.length === 0) return;

    setSending(true);
    setSendComplete(false);
    setCurrentIndex(0);

    const initialResults: SendResult[] = validRecipients.map(r => ({
      address: r.address,
      amount: r.amount,
      status: 'pending' as const,
    }));
    setResults(initialResults);

    for (let i = 0; i < validRecipients.length; i++) {
      setCurrentIndex(i);
      setResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'sending' } : r,
      ));

      try {
        const rawSender = senderAddr || walletAddress;
        const senderAddress = typeof rawSender === 'string'
          ? Address.fromString(rawSender)
          : rawSender;
        const contract = getContract<IOP20Contract>(
          tokenAddr, OP_20_ABI, provider, NETWORK, senderAddress as Address,
        );
        const recipientAddr = Address.fromString(validRecipients[i].address);
        const amount = formatAmount(validRecipients[i].amount, tokenDecimals);

        const sim = await withRetry(async () => {
          const s = await contract.transfer(recipientAddr, amount);
          if ((s as CallResult).revert) throw new Error((s as CallResult).revert as string);
          return s;
        });

        const txParams = await buildTxParams(provider, walletAddress);
        await (sim as CallResult).sendTransaction(txParams);

        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'success' } : r,
        ));
      } catch (e) {
        const errMsg = formatTxError(e);
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'error', error: errMsg } : r,
        ));
      }
    }

    setSending(false);
    setSendComplete(true);
  }, [walletAddress, tokenAddr, validRecipients, tokenDecimals, provider]);

  // Navigation helpers
  const canGoNext = (): boolean => {
    if (step === 1) return tokenAddr.length > 10;
    if (step === 2) return validRecipients.length > 0;
    if (step === 3) return connected;
    return false;
  };

  const goNext = () => {
    if (!canGoNext()) return;
    if (step < 4) setStep((step + 1) as WizardStep);
  };

  const goBack = () => {
    if (step > 1) setStep((step - 1) as WizardStep);
  };

  const resetWizard = () => {
    setStep(1);
    setSelectedToken('');
    setCustomAddress('');
    setTokenSymbol('');
    setUseCustom(false);
    setRawInput('');
    setResults([]);
    setSending(false);
    setSendComplete(false);
    setCurrentIndex(0);
  };

  // Progress for step 4
  const completedCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'error').length;
  const progressPct = results.length > 0 ? (completedCount + failedCount) / results.length * 100 : 0;

  /* ── Estimated gas (rough) ── */
  const estimatedGasSats = validRecipients.length * 5000; // ~5K sats per transfer
  const estimatedGasBtc = (estimatedGasSats / 1e8).toFixed(6);

  /* ── Render ── */
  return (
    <div>
      {/* Header */}
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>
          Multi-Sender
        </div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 520, margin: '0 auto' }}>
          Batch transfer OP-20 tokens to multiple recipients in one session.
          Select a token, paste your recipient list, review, and send.
        </div>
      </div>

      {/* Step indicator */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 18,
        padding: '0 12px', maxWidth: 480, margin: '0 auto 18px',
      }}>
        {[1, 2, 3, 4].map((s, i) => (
          <React.Fragment key={s}>
            <div
              style={{ ...stepBadge(step === s, step > s), cursor: step > s ? 'pointer' : 'default' }}
              onClick={() => { if (step > s) setStep(s as WizardStep); }}
              title={['Select Token', 'Recipients', 'Review', 'Send'][i]}
            >
              {step > s ? '\u2713' : s}
            </div>
            {i < 3 && <div style={stepConnector(step > s)} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: '.68rem', color: 'var(--t3)', marginBottom: 14 }}>
        {['Select Token', 'Add Recipients', 'Review & Confirm', 'Send Transfers'][step - 1]}
      </div>

      {/* ═══ STEP 1: Select Token ═══ */}
      {step === 1 && (
        <div className="P" style={{ padding: 20 }}>
          <div className="Lb">Choose Token</div>

          {/* Known tokens */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {KNOWN_TOKENS.map(t => (
              <button
                key={t.symbol}
                onClick={() => selectKnownToken(t)}
                style={{
                  flex: 1, padding: '14px 10px', borderRadius: 14, cursor: 'pointer',
                  background: selectedToken === t.address && !useCustom
                    ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
                  border: `1px solid ${selectedToken === t.address && !useCustom
                    ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`,
                  color: selectedToken === t.address && !useCustom ? 'var(--o)' : 'var(--t2)',
                  fontFamily: 'var(--ff)', transition: '.2s',
                }}
              >
                <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>{t.icon}</div>
                <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{t.symbol}</div>
                <div style={{ fontSize: '.6rem', color: 'var(--t3)', marginTop: 2 }}>{t.name}</div>
                <div style={{ fontSize: '.54rem', color: 'var(--t4)', marginTop: 2 }}>
                  {t.decimals} decimals
                </div>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
            <span style={{ fontSize: '.66rem', color: 'var(--t4)' }}>or enter custom address</span>
            <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
          </div>

          {/* Custom token */}
          <div
            onClick={handleCustomToggle}
            style={{
              padding: '12px', borderRadius: 14, cursor: 'pointer',
              background: useCustom ? 'rgba(14,165,233,.06)' : 'var(--bg3)',
              border: `1px solid ${useCustom ? 'rgba(14,165,233,.2)' : 'var(--bd)'}`,
              transition: '.2s', marginBottom: useCustom ? 10 : 0,
            }}
          >
            <div style={{ fontSize: '.74rem', fontWeight: 600, color: useCustom ? 'var(--c2)' : 'var(--t2)' }}>
              Custom Contract Address
            </div>
            <div style={{ fontSize: '.6rem', color: 'var(--t4)', marginTop: 2 }}>
              Paste any OP-20 token contract address
            </div>
          </div>

          {useCustom && (
            <div>
              <input
                style={inputStyle}
                value={customAddress}
                onChange={e => setCustomAddress(e.target.value)}
                placeholder="opt1sq... or 0x... contract address"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '.62rem', color: 'var(--t3)', display: 'block', marginBottom: 4 }}>
                    Decimals
                  </label>
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    value={tokenDecimals}
                    onChange={e => setTokenDecimals(Number(e.target.value))}
                  >
                    {[0, 2, 4, 6, 8, 18].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: '.62rem', color: 'var(--t3)', display: 'block', marginBottom: 4 }}>
                    Symbol (optional)
                  </label>
                  <input
                    style={inputStyle}
                    value={tokenSymbol}
                    onChange={e => setTokenSymbol(e.target.value.toUpperCase().slice(0, 8))}
                    placeholder="e.g. TKN"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ STEP 2: Recipients ═══ */}
      {step === 2 && (
        <div className="P" style={{ padding: 20 }}>
          <div className="Lb">Recipient List</div>
          <div style={{ fontSize: '.7rem', color: 'var(--t3)', marginBottom: 10 }}>
            Enter one recipient per line: <code style={{
              fontFamily: 'var(--fm)', background: 'var(--bg3)', padding: '2px 6px',
              borderRadius: 6, fontSize: '.66rem',
            }}>address,amount</code>
          </div>

          <textarea
            style={textareaStyle}
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            placeholder={
              'opt1pp76wuy...svtj5my,100\nopt1sqry48k...pntpa,250\nopt1sqrctjf...f802,500'
            }
            spellCheck={false}
          />

          {/* Action row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              className="btn-s"
              onClick={() => fileRef.current?.click()}
              style={{ padding: '6px 14px', fontSize: '.7rem' }}
            >
              Upload CSV
            </button>
            <button
              className="btn-s"
              onClick={addSampleData}
              style={{ padding: '6px 14px', fontSize: '.7rem' }}
            >
              Sample Data
            </button>
            <button
              className="btn-s"
              onClick={() => setRawInput('')}
              style={{ padding: '6px 14px', fontSize: '.7rem', marginLeft: 'auto' }}
            >
              Clear
            </button>
          </div>

          {/* Parse summary */}
          {recipients.length > 0 && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 12,
              background: invalidCount > 0 ? 'rgba(234,179,8,.06)' : 'rgba(34,197,94,.06)',
              border: `1px solid ${invalidCount > 0 ? 'rgba(234,179,8,.15)' : 'rgba(34,197,94,.15)'}`,
            }}>
              <div style={{ fontSize: '.72rem', fontWeight: 600, color: invalidCount > 0 ? '#eab308' : 'var(--g)' }}>
                {validRecipients.length} valid recipient{validRecipients.length !== 1 ? 's' : ''}
                {invalidCount > 0 && (
                  <span style={{ color: 'var(--r)', marginLeft: 8 }}>
                    {invalidCount} invalid (will be skipped)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '.64rem', color: 'var(--t3)', marginTop: 2 }}>
                Total: {totalAmount.toLocaleString()} {tokenSymbol || 'tokens'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ STEP 3: Review ═══ */}
      {step === 3 && (
        <div className="P" style={{ padding: 20 }}>
          <div className="Lb">Review Transfers</div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{
              padding: '10px', borderRadius: 12, textAlign: 'center',
              background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)',
            }}>
              <div style={{ fontSize: '.64rem', color: 'var(--t3)' }}>Token</div>
              <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--o)', marginTop: 2 }}>
                {tokenSymbol || 'Custom'}
              </div>
            </div>
            <div style={{
              padding: '10px', borderRadius: 12, textAlign: 'center',
              background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.12)',
            }}>
              <div style={{ fontSize: '.64rem', color: 'var(--t3)' }}>Recipients</div>
              <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--c2)', marginTop: 2 }}>
                {validRecipients.length}
              </div>
            </div>
            <div style={{
              padding: '10px', borderRadius: 12, textAlign: 'center',
              background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.12)',
            }}>
              <div style={{ fontSize: '.64rem', color: 'var(--t3)' }}>Total Amount</div>
              <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--g)', marginTop: 2 }}>
                {totalAmount.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Recipient table */}
          <div style={{
            maxHeight: 280, overflowY: 'auto', borderRadius: 12,
            border: '1px solid var(--bd)', marginBottom: 14,
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--t3)', fontWeight: 600, fontSize: '.66rem' }}>#</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--t3)', fontWeight: 600, fontSize: '.66rem' }}>Recipient</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--t3)', fontWeight: 600, fontSize: '.66rem' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {validRecipients.map((r, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}
                  >
                    <td style={{ padding: '7px 10px', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>{i + 1}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--t2)', fontFamily: 'var(--fm)', fontSize: '.68rem' }}>
                      {r.address.length > 30
                        ? r.address.slice(0, 14) + '...' + r.address.slice(-10)
                        : r.address}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--w)', fontFamily: 'var(--fm)', fontWeight: 600 }}>
                      {parseFloat(r.amount).toLocaleString()} {tokenSymbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Gas estimate */}
          <div style={{
            padding: '10px 14px', borderRadius: 12,
            background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: '.72rem',
          }}>
            <span style={{ color: 'var(--t3)' }}>Estimated gas ({validRecipients.length} txns):</span>
            <span style={{ fontWeight: 700, color: 'var(--o)', fontFamily: 'var(--fm)' }}>
              ~{estimatedGasSats.toLocaleString()} sats (~{estimatedGasBtc} BTC)
            </span>
          </div>

          {/* Wallet check */}
          {!connected && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 12,
              background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)',
              fontSize: '.72rem', color: '#ef4444', textAlign: 'center',
            }}>
              Connect your wallet to proceed.
              <button
                className="btn-p"
                onClick={openConnectModal}
                style={{ marginLeft: 10, padding: '4px 12px', fontSize: '.68rem' }}
              >
                Connect
              </button>
            </div>
          )}

          {connected && (
            <div style={{
              marginTop: 10, padding: '6px 10px', borderRadius: 8,
              background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)',
              fontSize: '.68rem', color: 'var(--g)',
            }}>
              Wallet: {walletAddress.slice(0, 16)}...{walletAddress.slice(-8)}
            </div>
          )}
        </div>
      )}

      {/* ═══ STEP 4: Send ═══ */}
      {step === 4 && (
        <div className="P" style={{ padding: 20 }}>
          <div className="Lb">Sending Transfers</div>

          {/* Progress bar */}
          <div style={{
            width: '100%', height: 8, borderRadius: 4, background: 'var(--bg3)',
            marginBottom: 14, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: failedCount > 0 ? 'linear-gradient(90deg, var(--g), var(--r))' : 'var(--g)',
              width: `${progressPct}%`, transition: 'width .4s ease',
            }} />
          </div>

          {/* Status summary */}
          <div style={{
            display: 'flex', gap: 12, marginBottom: 14, justifyContent: 'center',
            fontSize: '.74rem', fontWeight: 600,
          }}>
            <span style={{ color: 'var(--g)' }}>{completedCount} sent</span>
            <span style={{ color: 'var(--r)' }}>{failedCount} failed</span>
            <span style={{ color: 'var(--t3)' }}>
              {results.length - completedCount - failedCount} remaining
            </span>
          </div>

          {/* Results list */}
          <div style={{
            maxHeight: 340, overflowY: 'auto', borderRadius: 12,
            border: '1px solid var(--bd)',
          }}>
            {results.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.04)',
                  background: r.status === 'sending' ? 'rgba(247,147,26,.04)' : 'transparent',
                }}
              >
                {/* Status icon */}
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  fontSize: '.7rem',
                  background:
                    r.status === 'success' ? 'rgba(34,197,94,.15)' :
                    r.status === 'error' ? 'rgba(239,68,68,.15)' :
                    r.status === 'sending' ? 'rgba(247,147,26,.15)' :
                    'var(--bg3)',
                }}>
                  {r.status === 'success' && <span style={{ color: 'var(--g)' }}>{'\u2713'}</span>}
                  {r.status === 'error' && <span style={{ color: 'var(--r)' }}>{'\u2717'}</span>}
                  {r.status === 'sending' && (
                    <span style={{ color: 'var(--o)', animation: 'spin 1s linear infinite' }}>
                      {'\u25E6'}
                    </span>
                  )}
                  {r.status === 'pending' && <span style={{ color: 'var(--t4)' }}>{'\u2022'}</span>}
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.7rem', color: 'var(--t2)', fontFamily: 'var(--fm)' }}>
                    {r.address.length > 30
                      ? r.address.slice(0, 14) + '...' + r.address.slice(-10)
                      : r.address}
                  </div>
                  {r.error && (
                    <div style={{ fontSize: '.6rem', color: 'var(--r)', marginTop: 2 }}>
                      {r.error}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div style={{
                  fontSize: '.72rem', fontFamily: 'var(--fm)', fontWeight: 600,
                  color: r.status === 'success' ? 'var(--g)' : 'var(--t2)',
                  flexShrink: 0,
                }}>
                  {parseFloat(r.amount).toLocaleString()} {tokenSymbol}
                </div>
              </div>
            ))}
          </div>

          {/* Complete message */}
          {sendComplete && (
            <div style={{
              marginTop: 14, padding: '14px', borderRadius: 12, textAlign: 'center',
              background: failedCount === 0 ? 'rgba(34,197,94,.08)' : 'rgba(234,179,8,.08)',
              border: `1px solid ${failedCount === 0 ? 'rgba(34,197,94,.2)' : 'rgba(234,179,8,.2)'}`,
            }}>
              <div style={{
                fontWeight: 700, fontSize: '.88rem',
                color: failedCount === 0 ? 'var(--g)' : '#eab308',
              }}>
                {failedCount === 0
                  ? 'All transfers completed!'
                  : `Completed with ${failedCount} error${failedCount > 1 ? 's' : ''}`}
              </div>
              <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 4 }}>
                {completedCount} of {results.length} transfers successful
              </div>
            </div>
          )}

          {/* Start / Reset buttons */}
          {!sending && !sendComplete && (
            <button
              className="btn-p"
              onClick={executeBatchSend}
              style={{ width: '100%', marginTop: 14, padding: '12px', fontSize: '.82rem', fontWeight: 700 }}
            >
              Send {validRecipients.length} Transfer{validRecipients.length !== 1 ? 's' : ''}
            </button>
          )}
          {sendComplete && (
            <button
              className="btn-s"
              onClick={resetWizard}
              style={{ width: '100%', marginTop: 10, padding: '10px', fontSize: '.78rem' }}
            >
              New Batch
            </button>
          )}
        </div>
      )}

      {/* ── Navigation Buttons ── */}
      {step < 4 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'space-between' }}>
          <button
            className="btn-s"
            onClick={goBack}
            disabled={step === 1}
            style={{
              padding: '10px 20px', fontSize: '.78rem',
              opacity: step === 1 ? 0.4 : 1,
              cursor: step === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Back
          </button>
          <button
            className="btn-p"
            onClick={goNext}
            disabled={!canGoNext()}
            style={{
              padding: '10px 24px', fontSize: '.78rem', fontWeight: 700,
              opacity: canGoNext() ? 1 : 0.4,
              cursor: canGoNext() ? 'pointer' : 'not-allowed',
            }}
          >
            {step === 3 ? 'Proceed to Send' : 'Next'}
          </button>
        </div>
      )}
      {step === 4 && !sendComplete && !sending && (
        <div style={{ marginTop: 10 }}>
          <button
            className="btn-s"
            onClick={goBack}
            style={{ padding: '8px 16px', fontSize: '.74rem' }}
          >
            Back to Review
          </button>
        </div>
      )}

      {/* ── Info footer ── */}
      <div style={{
        marginTop: 18, padding: '10px 14px', borderRadius: 12,
        background: 'rgba(14,165,233,.04)', border: '1px solid rgba(14,165,233,.08)',
        fontSize: '.62rem', color: 'var(--t4)', textAlign: 'center',
      }}>
        Transfers are executed sequentially. Each transfer requires a wallet signature.
        Ensure you have enough BTC for gas fees (~5K sats per transfer).
      </div>
    </div>
  );
};

export default MultiSender;
