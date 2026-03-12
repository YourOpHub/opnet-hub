import React, { useMemo } from 'react';
import { SwapDirection } from '../../crosschain/types';
import { satsToBtc } from './types';
import { suggestedExpiryBlocks } from '../../crosschain/chains';
import { validateFractalAddr } from '../../hooks/crossChainShared';

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
  const addrError = useMemo(() => validateFractalAddr(formMakerAddr), [formMakerAddr]);

  return (
    <div className="Pg mb-16" role="form" aria-label="Create swap order">
      <div className="fw-700 fs-82 mb-12">Create Swap Order</div>

      {/* Direction toggle */}
      <div className="d-flex gap-8 mb-12">
        <button
          className={`${formDirection === SwapDirection.BTC_TO_FB ? 'btn-p' : 'btn-s'} flex-1 fs-76 p-10-0`}
          onClick={() => { setFormDirection(SwapDirection.BTC_TO_FB); setFormMakerAddr(''); setMakerAddrManual(false); }}
        >
          I have BTC, want FB
        </button>
        <button
          className={`${formDirection === SwapDirection.FB_TO_BTC ? 'btn-p' : 'btn-s'} flex-1 fs-76 p-10-0`}
          onClick={() => { setFormDirection(SwapDirection.FB_TO_BTC); setFormMakerAddr(''); setMakerAddrManual(false); }}
        >
          I have FB, want BTC
        </button>
      </div>

      <div className="grid-1-1 gap-10">
        {/* You Pay */}
        <div>
          <label className="cc-label">You Pay ({sendUnit})</label>
          <input className="cc-input" type="number" aria-label={`Amount you pay in ${sendUnit}`} placeholder="0.001" value={formAmount}
            onChange={e => setFormAmount(e.target.value)} min="0" step="any" />
          {formAmountSats > 0n && (
            <div className="fs-66 c-t3 mt-2">
              = {Number(formAmountSats).toLocaleString()} sats
            </div>
          )}
        </div>

        {/* You Get */}
        <div>
          <label className="cc-label">You Get ({receiveUnit})</label>
          <input className="cc-input" type="number" aria-label={`Amount you get in ${receiveUnit}`} placeholder="0.001" value={formReceive}
            onChange={e => setFormReceive(e.target.value)} min="0" step="any" />
          {formRate && (
            <div className="fs-66 c-g mt-2 fw-600">
              Rate: 1 {sendUnit} = {formRate} {receiveUnit}
            </div>
          )}
        </div>

        {/* Receiving address on other chain */}
        <div>
          <label className="cc-label">
            Your {formDirection === SwapDirection.BTC_TO_FB ? 'Fractal' : 'Bitcoin'} Receiving Address
          </label>
          <input className="cc-input" style={addrError ? { borderColor: '#ef4444' } : undefined}
            aria-label={`Your ${formDirection === SwapDirection.BTC_TO_FB ? 'Fractal' : 'Bitcoin'} receiving address`}
            placeholder={`bc1p... (${formDirection === SwapDirection.BTC_TO_FB ? 'Fractal' : 'Bitcoin'} P2TR address)`}
            value={formMakerAddr}
            onChange={e => { setFormMakerAddr(e.target.value); setMakerAddrManual(true); }} />
          {addrError && (
            <div className="fs-62 c-r mt-2">{addrError}</div>
          )}
        </div>

        {/* Expiry */}
        <div>
          <label className="cc-label">Order Expiry</label>
          <select className="cc-input" value={formExpiry} onChange={e => setFormExpiry(e.target.value)}>
            <option value={String(expiryOpts.min)}>~12h ({expiryOpts.min} blocks)</option>
            <option value={String(expiryOpts.default)}>~24h ({expiryOpts.default} blocks) - Recommended</option>
            <option value="288">~48h (288 blocks)</option>
            <option value={String(expiryOpts.max)}>~4 days ({expiryOpts.max} blocks)</option>
          </select>
        </div>
      </div>

      {/* Summary box */}
      {formAmountSats > 0n && (
        <div className="mt-12 p-10-14 br-10 bg-purple-06">
          <div className="flex-between fs-76 mb-4">
            <span className="c-t2">You pay:</span>
            <b>{satsToBtc(formAmountSats, sendUnit as 'BTC' | 'FB')}</b>
          </div>
          {formReceiveSats > 0n && (
            <div className="flex-between fs-76 mb-4">
              <span className="c-t2">You get:</span>
              <b className="c-g">{satsToBtc(formReceiveSats, receiveUnit as 'BTC' | 'FB')}</b>
            </div>
          )}
          <div className="flex-between fs-72">
            <span className="c-t3">Taker fee ({feeBps / 100}%):</span>
            <span className="c-o">+{Number(formFeeSats).toLocaleString()} sats</span>
          </div>
          {formRate && (
            <div className="flex-between fs-68 mt-4 pt-4 bd-t-bd">
              <span className="c-t3">Exchange rate:</span>
              <span className="c-t2">1 {sendUnit} = {formRate} {receiveUnit}</span>
            </div>
          )}
        </div>
      )}

      {createStep && (
        <div className="cc-step-status" aria-live="polite">
          {createStep}
        </div>
      )}

      <button className="btn-p w-full mt-12 p-10-0"
        disabled={creating || !formAmount || !formReceive || !formMakerAddr || !!addrError || !contractReady || formAmountSats <= 0n}
        onClick={onSubmit}
      >
        {creating ? 'Creating...' : 'Create Swap Order'}
      </button>
    </div>
  );
};

export default React.memo(CrossChainOrderForm);
