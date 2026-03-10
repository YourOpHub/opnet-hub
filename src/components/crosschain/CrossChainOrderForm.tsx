import React from 'react';
import { SwapDirection } from '../../crosschain/types';
import { iStyle, labelStyle, satsToBtc } from './types';
import { suggestedExpiryBlocks } from '../../crosschain/chains';

interface CrossChainOrderFormProps {
  formDirection: SwapDirection;
  setFormDirection: (d: SwapDirection) => void;
  formAmount: string;
  setFormAmount: (v: string) => void;
  formReceive: string;
  setFormReceive: (v: string) => void;
  formMakerAddr: string;
  setFormMakerAddr: (v: string) => void;
  setMakerAddrManual: (v: boolean) => void;
  formExpiry: string;
  setFormExpiry: (v: string) => void;
  creating: boolean;
  createStep: string;
  contractReady: boolean;
  feeBps: number;
  formAmountSats: bigint;
  formReceiveSats: bigint;
  formFeeSats: bigint;
  formRate: string;
  sendUnit: string;
  receiveUnit: string;
  onSubmit: () => void;
}

const CrossChainOrderForm: React.FC<CrossChainOrderFormProps> = ({
  formDirection,
  setFormDirection,
  formAmount,
  setFormAmount,
  formReceive,
  setFormReceive,
  formMakerAddr,
  setFormMakerAddr,
  setMakerAddrManual,
  formExpiry,
  setFormExpiry,
  creating,
  createStep,
  contractReady,
  feeBps,
  formAmountSats,
  formReceiveSats,
  formFeeSats,
  formRate,
  sendUnit,
  receiveUnit,
  onSubmit,
}) => {
  const expiryOpts = suggestedExpiryBlocks(1);

  return (
    <div className="Pg" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: 12 }}>Create Swap Order</div>

      {/* Direction toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className={formDirection === SwapDirection.BTC_TO_FB ? 'btn-p' : 'btn-s'}
          style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
          onClick={() => { setFormDirection(SwapDirection.BTC_TO_FB); setFormMakerAddr(''); setMakerAddrManual(false); }}
        >
          I have BTC, want FB
        </button>
        <button
          className={formDirection === SwapDirection.FB_TO_BTC ? 'btn-p' : 'btn-s'}
          style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
          onClick={() => { setFormDirection(SwapDirection.FB_TO_BTC); setFormMakerAddr(''); setMakerAddrManual(false); }}
        >
          I have FB, want BTC
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* You Pay */}
        <div>
          <label style={labelStyle}>You Pay ({sendUnit})</label>
          <input style={iStyle} type="number" placeholder="0.001" value={formAmount}
            onChange={e => setFormAmount(e.target.value)} min="0" step="any" />
          {formAmountSats > 0n && (
            <div style={{ fontSize: '.66rem', color: 'var(--t3)', marginTop: 2 }}>
              = {Number(formAmountSats).toLocaleString()} sats
            </div>
          )}
        </div>

        {/* You Get */}
        <div>
          <label style={labelStyle}>You Get ({receiveUnit})</label>
          <input style={iStyle} type="number" placeholder="0.001" value={formReceive}
            onChange={e => setFormReceive(e.target.value)} min="0" step="any" />
          {formRate && (
            <div style={{ fontSize: '.66rem', color: 'var(--g)', marginTop: 2, fontWeight: 600 }}>
              Rate: 1 {sendUnit} = {formRate} {receiveUnit}
            </div>
          )}
        </div>

        {/* Receiving address on other chain */}
        <div>
          <label style={labelStyle}>
            Your {formDirection === SwapDirection.BTC_TO_FB ? 'Fractal' : 'Bitcoin'} Receiving Address
          </label>
          <input style={iStyle}
            placeholder={formDirection === SwapDirection.BTC_TO_FB ? 'bc1p... (Fractal address)' : 'bc1p... (Bitcoin address)'}
            value={formMakerAddr}
            onChange={e => { setFormMakerAddr(e.target.value); setMakerAddrManual(true); }} />
        </div>

        {/* Expiry */}
        <div>
          <label style={labelStyle}>Order Expiry</label>
          <select style={iStyle as React.CSSProperties} value={formExpiry} onChange={e => setFormExpiry(e.target.value)}>
            <option value={String(expiryOpts.min)}>~12h ({expiryOpts.min} blocks)</option>
            <option value={String(expiryOpts.default)}>~24h ({expiryOpts.default} blocks) - Recommended</option>
            <option value="288">~48h (288 blocks)</option>
            <option value={String(expiryOpts.max)}>~4 days ({expiryOpts.max} blocks)</option>
          </select>
        </div>
      </div>

      {/* Summary box */}
      {formAmountSats > 0n && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.15)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', marginBottom: 4 }}>
            <span style={{ color: 'var(--t2)' }}>You pay:</span>
            <b>{satsToBtc(formAmountSats, sendUnit as 'BTC' | 'FB')}</b>
          </div>
          {formReceiveSats > 0n && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', marginBottom: 4 }}>
              <span style={{ color: 'var(--t2)' }}>You get:</span>
              <b style={{ color: 'var(--g)' }}>{satsToBtc(formReceiveSats, receiveUnit as 'BTC' | 'FB')}</b>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.72rem' }}>
            <span style={{ color: 'var(--t3)' }}>Taker fee ({feeBps / 100}%):</span>
            <span style={{ color: 'var(--o)' }}>+{Number(formFeeSats).toLocaleString()} sats</span>
          </div>
          {formRate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--bd)' }}>
              <span style={{ color: 'var(--t3)' }}>Exchange rate:</span>
              <span style={{ color: 'var(--t2)' }}>1 {sendUnit} = {formRate} {receiveUnit}</span>
            </div>
          )}
        </div>
      )}

      {createStep && (
        <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
          {createStep}
        </div>
      )}

      <button className="btn-p" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
        disabled={creating || !formAmount || !formReceive || !formMakerAddr || !contractReady || formAmountSats <= 0n}
        onClick={onSubmit}
      >
        {creating ? 'Creating...' : 'Create Swap Order'}
      </button>
    </div>
  );
};

export default React.memo(CrossChainOrderForm);
