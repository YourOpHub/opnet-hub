import React, { useState } from 'react';
import { type FractalSwapOrder, OrderStatus, SwapDirection } from '../../crosschain/types';
import { formatBlockCountdown } from '../../crosschain/htlc';
import { STATUS_COLORS, iStyle, btnSmall, fmtBtc, fmtRate } from './types';

/** Grid column definitions */
export const MY_COLS = '30px 64px 90px 90px 68px 60px auto';
export const AV_COLS = '90px 90px 68px auto';

/* ─────────────────────────────────────────────────────────
   TakeOrderButton — inline take button with address input
   ───────────────────────────────────────────────────────── */
export const TakeOrderButton: React.FC<{
  orderId: string; feeSats: number; defaultAddr?: string; label?: string;
  onTake: (id: string, takerAddr: string) => void; disabled: boolean;
}> = ({ orderId, feeSats, onTake, disabled, defaultAddr, label }) => {
  const [show, setShow] = useState(false);
  const [addr, setAddr] = useState(defaultAddr || '');
  const addrRef = React.useRef(addr);
  addrRef.current = addr;

  React.useEffect(() => {
    if (defaultAddr && !addrRef.current) setAddr(defaultAddr);
  }, [defaultAddr]);

  if (!show) {
    return (
      <div className="d-flex flex-col-dir ai-end" style={{ gap: 1 }}>
        <button className="ob-btn green"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); setShow(true); }}>
          {label || 'Take'}
        </button>
        <span style={{ fontSize: '.54rem', color: 'var(--t3)' }}>+{feeSats.toLocaleString()} sat fee</span>
      </div>
    );
  }
  return (
    <div className="d-flex gap-4 ai-center flex-wrap" onClick={e => e.stopPropagation()}>
      <input style={{ ...iStyle, width: 200, fontSize: '.66rem', padding: '4px 8px' }}
        aria-label="Receiving address for swap"
        placeholder="Receiving address (bc1p...)"
        value={addr} onChange={e => setAddr(e.target.value)} />
      <button className="ob-btn green"
        disabled={disabled || addr.length < 10}
        onClick={() => onTake(orderId, addr)}>
        OK
      </button>
      <button className="ob-btn" aria-label="Cancel take order" onClick={() => setShow(false)}>X</button>
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
      <button className="btn-p" style={{ fontSize: '.72rem', padding: '6px 14px' }}
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
      <button className="btn-p" style={{ fontSize: '.68rem', padding: '6px 10px' }}
        disabled={disabled || val.length < 64}
        onClick={() => onConfirm(orderId, val)}>
        Confirm
      </button>
      <button style={btnSmall} aria-label="Cancel preimage entry" onClick={() => setShow(false)}>X</button>
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

  return (
    <React.Fragment key={order.id}>
      <div className="ob-row" role="row" aria-label={`Order #${order.id}`} style={{ gridTemplateColumns: MY_COLS }}>
        <span className="ob-mono" style={{ color: 'var(--t3)' }}>#{order.id}</span>
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
        <span className="ob-mono ob-r" style={{ color: 'var(--t2)' }}>{fmtRate(order.btcAmount, order.wantAmount)}</span>
        <span><span className="ob-badge" style={{ background: statusInfo.bg, color: statusInfo.text }}>{statusInfo.label}</span></span>
        <div className="ob-act">
          {order.status === OrderStatus.Open && isMyOrder && (
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
          {/* "Claim only" hidden — auto-flow handles everything via Send & Claim */}
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
   ───────────────────────────────────────────────────────── */
interface AvailableOrderRowProps {
  order: FractalSwapOrder;
  currentBlock: number;
  actioning: string | null;
  actionStep: string;
  feeBps: number;
  isLocked: boolean;
  walletAddress: string | undefined | null;
  unisatAddress: string;
  onTakeAndSwap: (id: string, takerAddr: string) => void;
  onTake: (id: string, takerAddr: string) => void;
}

const AvailableOrderRowBase: React.FC<AvailableOrderRowProps> = ({
  order,
  currentBlock,
  actioning,
  actionStep,
  feeBps,
  isLocked,
  walletAddress,
  unisatAddress,
  onTakeAndSwap,
  onTake,
}) => {
  const blocksLeft = order.expiry > 0 ? order.expiry - currentBlock : 0;
  const isExpired = order.expiry > 0 && blocksLeft <= 0;
  const feeSats = (order.btcAmount * BigInt(feeBps)) / 10000n;
  const isBtcToFb = order.direction === SwapDirection.BTC_TO_FB;
  const isThisActioning = actioning === order.id;

  const takerGetsAmount = isBtcToFb ? order.btcAmount : order.wantAmount;
  const takerSendsAmount = isBtcToFb ? order.wantAmount : order.btcAmount;
  const takerGetsUnit = isBtcToFb ? 'BTC' : 'FB';
  const takerSendsUnit = isBtcToFb ? 'FB' : 'BTC';

  return (
    <React.Fragment key={order.id}>
      <div className="ob-row" role="row" aria-label={`Available swap order #${order.id}`} style={{ gridTemplateColumns: AV_COLS }}>
        <span className="ob-mono ob-r" style={{ color: '#22c55e', fontWeight: 700 }}>
          {fmtBtc(takerGetsAmount)} <span style={{ fontWeight: 500, fontSize: '.62rem', color: 'var(--t2)' }}>{takerGetsUnit}</span>
        </span>
        <span className="ob-mono ob-r" style={{ color: 'var(--t1)' }}>
          {fmtBtc(takerSendsAmount)} <span style={{ fontSize: '.62rem', color: 'var(--t3)' }}>{takerSendsUnit}</span>
        </span>
        <span className="ob-mono ob-r" style={{ color: 'var(--t2)' }}>{fmtRate(order.btcAmount, order.wantAmount)}</span>
        <div className="ob-act">
          {!isExpired && isBtcToFb && (
            <TakeOrderButton orderId={order.id} feeSats={Number(feeSats)}
              onTake={onTakeAndSwap} disabled={isThisActioning || isLocked}
              defaultAddr={unisatAddress || ''}
              label={isLocked ? '\u{1F512}' : 'Take'} />
          )}
          {!isExpired && !isBtcToFb && (
            <TakeOrderButton orderId={order.id} feeSats={Number(feeSats)}
              onTake={onTake} disabled={isThisActioning || isLocked}
              defaultAddr={walletAddress || ''}
              label={isLocked ? '\u{1F512}' : 'Take'} />
          )}
          {isExpired && <span style={{ color: '#ef4444', fontSize: '.64rem' }}>Expired</span>}
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
