import React, { useCallback, useRef, type SetStateAction } from 'react';
import { DEPLOYED_CONTRACTS } from '../../contracts';

export interface Recipient {
  address: string;
  amount: string;
  valid: boolean;
}

export interface KnownToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
}

export const KNOWN_TOKENS: KnownToken[] = [
  {
    symbol: DEPLOYED_CONTRACTS.MINE.symbol,
    name: DEPLOYED_CONTRACTS.MINE.name,
    address: DEPLOYED_CONTRACTS.MINE.address,
    decimals: DEPLOYED_CONTRACTS.MINE.decimals,
    icon: DEPLOYED_CONTRACTS.MINE.icon,
  },
  {
    symbol: DEPLOYED_CONTRACTS.VIBE.symbol,
    name: DEPLOYED_CONTRACTS.VIBE.name,
    address: DEPLOYED_CONTRACTS.VIBE.address,
    decimals: DEPLOYED_CONTRACTS.VIBE.decimals,
    icon: DEPLOYED_CONTRACTS.VIBE.icon,
  },
];

export function parseRecipients(raw: string): Recipient[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split(/[,\s\t]+/).filter(Boolean);
      const address = parts[0] || '';
      const amount = parts[1] || '';
      const amtNum = parseFloat(amount);
      const validAddr = (address.startsWith('opt1') && address.length > 40) ||
                        (address.startsWith('bc1') && address.length > 40) ||
                        (address.startsWith('0x') && address.length === 66);
      const validAmt = !isNaN(amtNum) && amtNum > 0;
      return { address, amount, valid: validAddr && validAmt };
    });
}

export function formatAmount(amount: string, decimals: number): bigint {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return 0n;
  const [whole, frac = ''] = amount.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(paddedFrac);
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 14,
  background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
  fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 160, resize: 'vertical' as const,
  fontFamily: 'var(--fm)', fontSize: '.74rem', lineHeight: 1.6,
};

export interface MultiSenderSetupProps {
  step: number;
  selectedToken: string;
  setSelectedToken: (v: string) => void;
  customAddress: string;
  setCustomAddress: (v: string) => void;
  tokenDecimals: number;
  setTokenDecimals: (v: number) => void;
  tokenSymbol: string;
  setTokenSymbol: (v: string) => void;
  useCustom: boolean;
  setUseCustom: (v: boolean) => void;
  rawInput: string;
  setRawInput: (v: SetStateAction<string>) => void;
  recipients: Recipient[];
  validRecipients: Recipient[];
  invalidCount: number;
  totalAmount: number;
}

const MultiSenderSetup: React.FC<MultiSenderSetupProps> = ({
  step, selectedToken, setSelectedToken, customAddress, setCustomAddress,
  tokenDecimals, setTokenDecimals, tokenSymbol, setTokenSymbol,
  useCustom, setUseCustom, rawInput, setRawInput,
  recipients, validRecipients, invalidCount, totalAmount,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const selectKnownToken = useCallback((t: KnownToken) => {
    setSelectedToken(t.address);
    setTokenDecimals(t.decimals);
    setTokenSymbol(t.symbol);
    setUseCustom(false);
  }, [setSelectedToken, setTokenDecimals, setTokenSymbol, setUseCustom]);

  const handleCustomToggle = useCallback(() => {
    setUseCustom(true);
    setSelectedToken('');
    setTokenSymbol('Custom');
  }, [setUseCustom, setSelectedToken, setTokenSymbol]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) setRawInput(prev => prev ? prev + '\n' + text.trim() : text.trim());
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [setRawInput]);

  const addSampleData = useCallback(() => {
    setRawInput(
      'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,100\n' +
      'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa,250\n' +
      'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802,500',
    );
  }, [setRawInput]);

  if (step !== 1 && step !== 2) return null;

  return (
    <>
      {/* Step 1: Select Token */}
      {step === 1 && (
        <div className="P p-20">
          <div className="Lb">Choose Token</div>
          <div className="flex-center gap-8 mb-16" role="radiogroup" aria-label="Select token">
            {KNOWN_TOKENS.map(t => (
              <button
                key={t.symbol}
                role="radio"
                aria-checked={selectedToken === t.address && !useCustom}
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
                <div className="fs-120 mb-4">{t.icon}</div>
                <div className="fw-700 fs-82">{t.symbol}</div>
                <div className="fs-60 c-t3 mt-2">{t.name}</div>
                <div className="fs-2xs c-t4 mt-2">{t.decimals} decimals</div>
              </button>
            ))}
          </div>

          <div className="flex-center gap-10 mb-14">
            <div className="sep-line" />
            <span className="fs-66 c-t4">or enter custom address</span>
            <div className="sep-line" />
          </div>

          <div
            onClick={handleCustomToggle}
            style={{
              padding: '12px', borderRadius: 14, cursor: 'pointer',
              background: useCustom ? 'rgba(14,165,233,.06)' : 'var(--bg3)',
              border: `1px solid ${useCustom ? 'rgba(14,165,233,.2)' : 'var(--bd)'}`,
              transition: '.2s', marginBottom: useCustom ? 10 : 0,
            }}
          >
            <div className="fs-74 fw-600" style={{ color: useCustom ? 'var(--c2)' : 'var(--t2)' }}>
              Custom Contract Address
            </div>
            <div className="fs-60 c-t4 mt-2">
              Paste any OP-20 token contract address
            </div>
          </div>

          {useCustom && (
            <div>
              <input
                style={inputStyle}
                aria-label="Custom contract address"
                value={customAddress}
                onChange={e => setCustomAddress(e.target.value)}
                placeholder="opt1sq... or 0x... contract address"
              />
              <div className="flex-center gap-8 mt-8">
                <div style={{ flex: 1 }}>
                  <label className="fs-62 c-t3 d-block mb-4">Decimals</label>
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }}
                    aria-label="Token decimals"
                    value={tokenDecimals}
                    onChange={e => setTokenDecimals(Number(e.target.value))}
                  >
                    {[0, 2, 4, 6, 8, 18].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label className="fs-62 c-t3 d-block mb-4">Symbol (optional)</label>
                  <input
                    style={inputStyle}
                    aria-label="Token symbol"
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

      {/* Step 2: Recipients */}
      {step === 2 && (
        <div className="P p-20">
          <div className="Lb">Recipient List</div>
          <div className="fs-70 c-t3 mb-10">
            Enter one recipient per line: <code style={{
              fontFamily: 'var(--fm)', background: 'var(--bg3)', padding: '2px 6px',
              borderRadius: 6, fontSize: '.66rem',
            }}>address,amount</code>
          </div>

          <textarea
            style={textareaStyle}
            aria-label="Recipient list, one per line: address,amount"
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            placeholder={
              'opt1pp76wuy...svtj5my,100\nopt1sqry48k...pntpa,250\nopt1sqrctjf...f802,500'
            }
            spellCheck={false}
          />

          <div className="flex-center flex-wrap gap-8 mt-10">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              aria-label="Upload CSV file with recipients"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button className="btn-s fs-70 p-6-14" onClick={() => fileRef.current?.click()}>
              Upload CSV
            </button>
            <button className="btn-s fs-70 p-6-14" onClick={addSampleData}>
              Sample Data
            </button>
            <button className="btn-s fs-70 ml-auto p-6-14" onClick={() => setRawInput('')}>
              Clear
            </button>
          </div>

          {recipients.length > 0 && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 12,
              background: invalidCount > 0 ? 'rgba(234,179,8,.06)' : 'rgba(34,197,94,.06)',
              border: `1px solid ${invalidCount > 0 ? 'rgba(234,179,8,.15)' : 'rgba(34,197,94,.15)'}`,
            }}>
              <div className="fs-72 fw-600" style={{ color: invalidCount > 0 ? '#eab308' : 'var(--g)' }}>
                {validRecipients.length} valid recipient{validRecipients.length !== 1 ? 's' : ''}
                {invalidCount > 0 && (
                  <span className="c-r" style={{ marginLeft: 8 }}>
                    {invalidCount} invalid (will be skipped)
                  </span>
                )}
              </div>
              <div className="fs-64 c-t3 mt-2">
                Total: {totalAmount.toLocaleString()} {tokenSymbol || 'tokens'}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default React.memo(MultiSenderSetup);
