import React, { useState } from 'react';
import { type FractalSwapOrder, OrderStatus, SwapDirection } from '../../crosschain/types';
import { formatBlockCountdown } from '../../crosschain/htlc';
import { STATUS_COLORS, iStyle, btnSmall, fmtBtc, fmtRate, satsToBtc } from './types';

/** Grid column definitions */
export const MY_COLS = '30px 64px 90px 90px 68px 60px auto';
export const AV_COLS = '90px 90px 68px auto';

/* ─────────────────────────────────────────────────────────
   TakeOrderButton — inline take button with address + fill amount input
   v8: supports partial fills via fillBtcAmount
   ───────────────────────────────────────────────────────── */
export const TakeOrderButton: React.FC<{
  orderId: string; feeBps: number; remaining: bigint;
  defaultAddr?: string; label?: string; addrHint?: string;
  onTake: (id: string, takerAddr: string, fillBtcAmount: bigint) => void; disabled: boolean;
}> = ({ orderId, feeBps, remaining, onTake, disabled, defaultAddr, label, addrHint }) => {
  const [show, setShow] = useState(false);
  const [addr, setAddr] = useState(defaultAddr || '');
  const [fillStr, setFillStr] = useState('');
  const addrRef = React.useRef(addr);
  addrRef.current = addr;

  React.useEffect(() => {
    if (defaultAddr && !addrRef.current) setAddr(defaultAddr);
  }, [defaultAddr]);

  // Parse fill amount — empty means full take (0n)
  const fillSats = fillStr ? BigInt(Math.round(parseFloat(fillStr) * 1e8)) : 0n;
  const effectiveFill = fillSats > 0n ? fillSats : remaining;
  const feeSats = (effectiveFill * BigInt(feeBps)) / 10000n;
  const isPartial = fillSats > 0n && fillSats < remaining;
  const fillValid = fillSats === 0n || (fillSats >= 1000n && fillSats <= remaining);

  if (!show) {
    return (
      <div className="d-flex flex-col-dir ai-end" style={{ gap: 1 }}>
        <button className="ob-btn green"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); setShow(true); }}>
          {label || 'Take'}
        </button>
        <span className="fs-2xs c-t3">+{Number(feeSats).toLocaleString()} sat fee</span>
      </div>
    );
  }
  return (
    <div className="d-flex gap-4 ai-center flex-wrap" onClick={e => e.stopPropagation()}>
      {/* Fill amount input — only show if order is partially fillable */}
      <div className="d-flex flex-col-dir" style={{ gap: 2 }}>
        <input style={{ ...iStyle, width: 120, fontSize: '.66rem', padding: '4px 8px' }}
          aria-label="Fill amount in BTC"
          placeholder={`Fill (max ${satsToBtc(remaining)})`}
          value={fillStr} onChange={e => setFillStr(e.target.value)} />
        <span className="fs-2xs c-t3">
          {isPartial ? `Partial: ${satsToBtc(effectiveFill)} BTC` : `Full: ${satsToBtc(remaining)} BTC`}
          {' '}(+{Number(feeSats).toLocaleString()} fee)
        </span>
      </div>
      <input style={{ ...iStyle, width: 180, fontSize: '.66rem', padding: '4px 8px' }}
        aria-label={addrHint || 'Fractal address for swap'}
        placeholder={addrHint || 'Your Fractal address (bc1p...)'}
        value={addr} onChange={e => setAddr(e.target.value)} />
      <button className="ob-btn green"
        disabled={disabled || addr.length < 10 || !fillValid}
        onClick={() => onTake(orderId, addr, fillSats)}>
        {isPartial ? 'Partial Fill' : 'Fill All'}
      </button>
      <button className="ob-btn" aria-label="Cancel take order" onClick={() => { setShow(false); setFillStr(''); }}>X</button>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────
   PreimageInput — inline preimage entry for confirm swap
   ───────────────────────────────────────────────────────── */
export const PreimageInput: React.FC<{
  orderId: string; onConfirm: (id: string, preimage: string) => void; disabled: boolean;
}> = ({ orderId, onConfirm, disabled }) => {
  const [show, setShow] = useState(false);
  const [val, setVal] = useState('');

  if (!show) {
    return (
      <button className="btn-p fs-72 p-6-14"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setShow(true); }}>
        Confirm with Preimage
      </button>
    );
  }
  return (
    <div className="d-flex gap-6 ai-center" onClick={e => e.stopPropagation()}>
      <input style={{ ...iStyle, width: 200, fontSize: '.68rem' }} aria-label="Preimage hex for swap confirmation" placeholder="Enter preimage hex..."
        value={val} onChange={e => setVal(e.target.value)} />
      <button className="btn-p fs-68 p-6-10"
        disabled={disabled || val.length < 64}
        onClick={() => onConfirm(orderId, val)}>
        Confirm
      </button>
      <button style={btnSmall} aria-label="Cancel preimage entry" onClick={() => setShow(false)}>X</button>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────
   FillProgressBar — shows partial fill progress for parent orders
   ───────────────────────────────────────────────────────── */
const FillProgressBar: React.FC<{ filledBtc: bigint; btcAmount: bigint }> = ({ filledBtc, btcAmount }) => {
  if (filledBtc <= 0n || btcAmount <= 0n) return null;
  const pct = Number((filledBtc * 100n) / btcAmount);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.58rem' }}>
      <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', borderRadius: 2 }} />
      </div>
      <span className="c-t3">{pct}%</span>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────
   MyOrderRow — a single row in the "Your Orders" table
   ───────────────────────────────────────────────────────── */
interface MyOrderRowProps {
  order: FractalSwapOrder;
  currentBlock: number;
  actioning: string | null;
  actionStep: string;
  isMyOrder: boolean;
  isTaker: boolean;
  unisatConnected: boolean;
  unisatConnecting: boolean;
  onCancel: (id: string) => void;
  onSendAndClaim: (id: string) => void;
  onComplete?: (id: string) => void;
  onRefund: (id: string) => void;
  onConnectUnisat: () => void;
}

const MyOrderRowBase: React.FC<MyOrderRowProps> = ({
  order,
  currentBlock,
  actioning,
  actionStep,
  isMyOrder,
  isTaker,
  unisatConnected,
  unisatConnecting,
  onCancel,
  onSendAndClaim,
  onRefund,
  onConnectUnisat,
}) => {
  const blocksLeft = order.expiry > 0 ? order.expiry - currentBlock : 0;
  const isExpired = order.expiry > 0 && blocksLeft <= 0;
  const isBtcToFb = order.direction === SwapDirection.BTC_TO_FB;
  const isThisActioning = actioning === order.id;
  const iNeedToAct = order.status === OrderStatus.Taken && (
    (isBtcToFb && isTaker) || (!isBtcToFb && isMyOrder)
  );
  const statusInfo = STATUS_COLORS[order.status] ?? STATUS_COLORS[OrderStatus.Open] ?? { bg: 'rgba(59,130,246,.12)', text: '#60a5fa', label: 'Unknown' };
  const isChild = order.parentId > 0;
  const hasPartialFills = order.filledBtc > 0n && order.parentId === 0;

  return (
    <React.Fragment key={order.id}>
      <div className="ob-row" role="row" aria-label={`Order #${order.id}`} style={{ gridTemplateColumns: MY_COLS }}>
        <span className="ob-mono c-t3">
          #{order.id}
          {isChild && <span className="fs-2xs c-t3" title={`Fill of parent #${order.parentId}`}>{'\u2190'}#{order.parentId}</span>}
        </span>
        <span>
          <span className="ob-badge" style={{
            background: isBtcToFb ? 'rgba(139,92,246,.15)' : 'rgba(245,158,11,.15)',
            color: isBtcToFb ? '#a78bfa' : '#f59e0b',
          }}>
            {isBtcToFb ? 'BTC\u2192FB' : 'FB\u2192BTC'}
          </span>
        </span>
        <span className="ob-mono ob-r">{fmtBtc(order.btcAmount)}</span>
        <span className="ob-mono ob-r">{fmtBtc(order.wantAmount)}</span>
        <span className="ob-mono ob-r c-t2">{fmtRate(order.btcAmount, order.wantAmount)}</span>
        <span>
          <span className="ob-badge" style={{ background: statusInfo.bg, color: statusInfo.text }}>{statusInfo.label}</span>
          {hasPartialFills && <FillProgressBar filledBtc={order.filledBtc} btcAmount={order.btcAmount} />}
        </span>
        <div className="ob-act">
          {order.status === OrderStatus.Open && isMyOrder && !isChild && (
            <>
              <span style={{ color: '#8b5cf6' }}>{'\u231B'}</span>
              <button className="ob-btn danger" disabled={isThisActioning}
                onClick={() => onCancel(order.id)}>Cancel</button>
            </>
          )}
          {iNeedToAct && !isExpired && (
            unisatConnected ? (
              <button className="ob-btn green" disabled={isThisActioning}
                onClick={() => onSendAndClaim(order.id)}>
                Send & Claim
              </button>
            ) : (
              <button className="ob-btn accent" disabled={unisatConnecting}
                onClick={() => onConnectUnisat()}>
                Connect UniSat
              </button>
            )
          )}
          {isExpired && order.status === OrderStatus.Taken && (isMyOrder || isTaker) && (
            <button className="ob-btn danger" disabled={isThisActioning}
              onClick={() => onRefund(order.id)}>Refund</button>
          )}
          {order.expiry > 0 && (
            <span style={{ fontSize: '.62rem', color: isExpired ? '#ef4444' : 'var(--t3)' }}>
              {isExpired ? 'EXP' : formatBlockCountdown(blocksLeft)}
            </span>
          )}
        </div>
      </div>
      {isThisActioning && actionStep && (
        <div className="cc-pending-info" aria-live="polite">
          {actionStep}
        </div>
      )}
    </React.Fragment>
  );
};

export const MyOrderRow = React.memo(MyOrderRowBase);

/* ─────────────────────────────────────────────────────────
   AvailableOrderRow — a row in the available swaps tables
   v8: shows fill progress + partial fill support
   ───────────────────────────────────────────────────────── */
interface AvailableOrderRowProps {
  order: FractalSwapOrder;
  currentBlock: number;
  actioning: string | null;
  actionStep: string;
  feeBps: number;
  isLocked: boolean;
  walletAddress: string;
  onTakeAndSwap: (id: string, takerAddr: string, fillBtcAmount: bigint) => void;
}

const AvailableOrderRowBase: React.FC<AvailableOrderRowProps> = ({
  order,
  currentBlock,
  actioning,
  actionStep,
  feeBps,
  isLocked,
  walletAddress,
  onTakeAndSwap,
}) => {
  const blocksLeft = order.expiry > 0 ? order.expiry - currentBlock : 0;
  const isExpired = order.expiry > 0 && blocksLeft <= 0;
  const isThisActioning = actioning === order.id;

  // v8: remaining = btcAmount - filledBtc
  const remaining = order.btcAmount - (order.filledBtc ?? 0n);
  const hasPartialFills = order.filledBtc > 0n;

  // BTC_TO_FB only: taker gets BTC, sends FB
  return (
    <React.Fragment key={order.id}>
      <div className="ob-row" role="row" aria-label={`Available swap order #${order.id}`} style={{ gridTemplateColumns: AV_COLS }}>
        <span className="ob-mono ob-r fw-700" style={{ color: '#22c55e' }}>
          {hasPartialFills ? (
            <span title={`${fmtBtc(remaining)} remaining of ${fmtBtc(order.btcAmount)} total`}>
              {fmtBtc(remaining)} <span className="fw-500 fs-62 c-t3">/ {fmtBtc(order.btcAmount)} BTC</span>
            </span>
          ) : (
            <>{fmtBtc(order.btcAmount)} <span className="fw-500 fs-62 c-t2">BTC</span></>
          )}
        </span>
        <span className="ob-mono ob-r c-t1">
          {fmtBtc(order.wantAmount)} <span className="fs-62 c-t3">FB</span>
        </span>
        <span className="ob-mono ob-r c-t2">{fmtRate(order.btcAmount, order.wantAmount)}</span>
        <div className="ob-act">
          {!isExpired && (
            <TakeOrderButton orderId={order.id} feeBps={feeBps}
              remaining={remaining}
              onTake={onTakeAndSwap} disabled={isThisActioning || isLocked}
              defaultAddr={walletAddress || ''}
              addrHint="Your OPNet address (opt1p...)"
              label={isLocked ? '\u{1F512}' : 'Take & Swap'} />
          )}
          {isExpired && <span className="c-red fs-64">Expired</span>}
          {hasPartialFills && <FillProgressBar filledBtc={order.filledBtc} btcAmount={order.btcAmount} />}
        </div>
      </div>
      {isThisActioning && actionStep && (
        <div className="cc-pending-info" aria-live="polite">
          {actionStep}
        </div>
      )}
    </React.Fragment>
  );
};

export const AvailableOrderRow = React.memo(AvailableOrderRowBase);
