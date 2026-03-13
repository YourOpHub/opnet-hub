import React, { useMemo } from 'react';
import { satsToBtc } from './types';
import { suggestedExpiryBlocks } from '../../crosschain/chains';
import { validateFractalAddr } from '../../hooks/crossChainShared';

interface CrossChainOrderFormProps {
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
  onSubmit: () => void;
}

const CrossChainOrderForm: React.FC<CrossChainOrderFormProps> = ({
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
  onSubmit,
}) => {
  const expiryOpts = suggestedExpiryBlocks(1);
  const addrError = useMemo(() => validateFractalAddr(formMakerAddr), [formMakerAddr]);

  return (
    <div className="Pg mb-16" role="form" aria-label="Create swap order">
      <div className="fw-700 fs-82 mb-12">Lock BTC &rarr; Get Fractal BTC</div>
      <div className="fs-72 c-t3 mb-12">
        Lock your OPNet BTC in escrow. A taker will send you Fractal BTC to fill the order.
      </div>

      <div className="grid-1-1 gap-10">
        {/* You Lock (BTC) */}
        <div>
          <label className="cc-label">You Lock (BTC)</label>
          <input className="cc-input" type="number" aria-label="Amount of BTC to lock" placeholder="0.001" value={formAmount}
            onChange={e => setFormAmount(e.target.value)} min="0" step="any" />
          {formAmountSats > 0n && (
            <div className="fs-66 c-t3 mt-2">
              = {Number(formAmountSats).toLocaleString()} sats
            </div>
          )}
        </div>

        {/* You Want (FB) */}
        <div>
          <label className="cc-label">You Want (FB)</label>
          <input className="cc-input" type="number" aria-label="Amount of FB you want" placeholder="0.001" value={formReceive}
            onChange={e => setFormReceive(e.target.value)} min="0" step="any" />
          {formRate && (
            <div className="fs-66 c-g mt-2 fw-600">
              Rate: 1 BTC = {formRate} FB
            </div>
          )}
        </div>

        {/* Fractal receiving address */}
        <div>
          <label className="cc-label">Your Fractal Receiving Address</label>
          <input className="cc-input" style={addrError ? { borderColor: '#ef4444' } : undefined}
            aria-label="Your Fractal receiving address"
            placeholder="bc1p... (Fractal P2TR address)"
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
            <span className="c-t2">You lock:</span>
            <b>{satsToBtc(formAmountSats, 'BTC')}</b>
          </div>
          {formReceiveSats > 0n && (
            <div className="flex-between fs-76 mb-4">
              <span className="c-t2">You get:</span>
              <b className="c-g">{satsToBtc(formReceiveSats, 'FB')}</b>
            </div>
          )}
          <div className="flex-between fs-72">
            <span className="c-t3">Taker fee ({feeBps / 100}%):</span>
            <span className="c-o">+{Number(formFeeSats).toLocaleString()} sats</span>
          </div>
          {formRate && (
            <div className="flex-between fs-68 mt-4 pt-4 bd-t-bd">
              <span className="c-t3">Exchange rate:</span>
              <span className="c-t2">1 BTC = {formRate} FB</span>
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
        {creating ? 'Creating...' : 'Lock BTC & Create Order'}
      </button>
    </div>
  );
};

export default React.memo(CrossChainOrderForm);
