import React from 'react';
import { OrderStatus } from '../../crosschain/types';
import { formatBlockCountdown } from '../../crosschain/htlc';
import { type TokenEscrowOrder, STATUS_COLORS, DIR_SELL_TOKEN, btnSmall, satsToBtc } from './types';
import { TakeOrderButton, PreimageInput } from './CrossChainOrderRow';

/** Format token amount with decimals */
function formatTokenAmount(amount: bigint, decimals: number): string {
  const div = 10 ** decimals;
  const num = Number(amount) / div;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface EscrowOrderCardProps {
  order: TokenEscrowOrder;
  currentBlock: number;
  actioning: string | null;
  actionStep: string;
  feeBps: number;
  mldsaHex: string;
  preimageStore: Record<string, string>;
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  tokenInfo: { symbol: string; icon: string; decimals: number; address: string } | null;
  onTake: (id: string, takerAddr: string) => void;
  onConfirm: (id: string, preimage: string) => void;
  onRefund: (id: string) => void;
  onCancel: (id: string) => void;
}

/** Status badge component */
const StatusBadge: React.FC<{ status: OrderStatus }> = ({ status }) => {
  const s = STATUS_COLORS[status] ?? STATUS_COLORS[OrderStatus.Open] ?? { bg: 'rgba(59,130,246,.12)', text: '#60a5fa', label: 'Unknown' };
  return (
    <span style={{
      background: s.bg, color: s.text,
      padding: '3px 8px', borderRadius: 6, fontSize: '.68rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '.04em',
    }}>
      {s.label}
    </span>
  );
};

/** Token Escrow Order Card (for Token Bridge mode) */
const EscrowOrderCardBase: React.FC<EscrowOrderCardProps> = ({
  order,
  currentBlock,
  actioning,
  actionStep,
  feeBps,
  mldsaHex,
  preimageStore,
  expandedOrder,
  setExpandedOrder,
  tokenInfo,
  onTake,
  onConfirm,
  onRefund,
  onCancel,
}) => {
  const isExpanded = expandedOrder === `tb_${order.id}`;
  const blocksLeft = order.expiry > 0 ? order.expiry - currentBlock : 0;
  const isExpired = order.expiry > 0 && blocksLeft <= 0;
  const myPreimage = preimageStore[`tb_${order.id}`];
  const isMyOrder = !!(mldsaHex && order.creator.toLowerCase() === mldsaHex);
  const feeSats = (order.btcPrice * BigInt(feeBps)) / 10000n;
  const tokenSymbol = tokenInfo?.symbol || 'TOKEN';
  const tokenIcon = tokenInfo?.icon || '';
  const tokenDecimals = tokenInfo?.decimals || 8;
  const isSell = order.direction === DIR_SELL_TOKEN;
  const isThisTbActioning = actioning === 'tb:' + order.id;
  const ZERO_HEX = '0'.repeat(64);

  return (
    <div key={`tb_${order.id}`} className="Pg mb-8 pointer" role="article" aria-label={`${isSell ? 'Sell' : 'Buy'} ${tokenSymbol} order #${order.id}`} aria-expanded={isExpanded}
      onClick={() => setExpandedOrder(isExpanded ? null : `tb_${order.id}`)}
    >
      {/* Header */}
      <div className="flex-between gap-8">
        <div className="flex-center gap-8">
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isSell ? 'rgba(239,68,68,.12)' : 'rgba(34,197,94,.12)',
            color: isSell ? '#ef4444' : '#22c55e',
            padding: '4px 10px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700,
          }}>
            {isSell ? 'Sell' : 'Buy'} {tokenIcon} {tokenSymbol}
          </span>
          <span className="fw-700 fs-82">
            {formatTokenAmount(order.tokenAmount, tokenDecimals)} {tokenSymbol}
          </span>
        </div>
        <div className="flex-center gap-8">
          <StatusBadge status={order.status as OrderStatus} />
          <span className="fs-72 c-t3">#{order.id}</span>
        </div>
      </div>

      {/* Info row */}
      <div className="d-flex gap-16 mt-8 fs-72 c-t2 flex-wrap">
        <span>Price: <b className="c-o">{satsToBtc(order.btcPrice)}</b></span>
        <span>Fee: <b>+{Number(feeSats).toLocaleString()} sats</b></span>
        {order.expiry > 0 && (
          <span style={{ color: isExpired ? 'var(--r)' : 'var(--g)' }}>
            {isExpired ? 'EXPIRED' : `Expires: ${formatBlockCountdown(blocksLeft)}`}
          </span>
        )}
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div className="mt-12 pt-12 bd-t-bd">
          <div className="cc-detail-row">
            <div><b>Direction:</b> {isSell ? 'Selling tokens for BTC' : 'Buying tokens with BTC'}</div>
            <div className="cc-detail-line"><b>Token:</b> {tokenIcon} {tokenSymbol} ({tokenInfo?.address ? tokenInfo.address.slice(0, 20) + '...' : order.tokenHex.slice(0, 20) + '...'})</div>
            <div className="cc-detail-line"><b>Amount:</b> {formatTokenAmount(order.tokenAmount, tokenDecimals)} {tokenSymbol}</div>
            <div className="cc-detail-line"><b>BTC Price:</b> {satsToBtc(order.btcPrice)}</div>
            <div className="cc-detail-line"><b>Hashlock:</b> <code className="fs-65 word-break">{order.hashlock}</code></div>
            {order.preimage !== ZERO_HEX && (
              <div className="cc-detail-line"><b>Preimage:</b> <code className="fs-65 word-break">{order.preimage}</code></div>
            )}
            {myPreimage && order.preimage === ZERO_HEX && (
              <div className="cc-preimage-box">
                <b className="c-y">Your Preimage (keep secret!):</b>
                <code className="fs-65 word-break d-block mt-2">{myPreimage}</code>
              </div>
            )}
            {order.expiry > 0 && (
              <div className="cc-detail-line"><b>Expiry:</b> Block {order.expiry.toLocaleString()} ({formatBlockCountdown(blocksLeft)})</div>
            )}
          </div>

          {/* Action buttons */}
          <div className="cc-actions-row">
            {/* Take order */}
            {order.status === 1 && !isExpired && !isMyOrder && (
              <TakeOrderButton orderId={order.id} feeSats={Number(feeSats)}
                onTake={(id, addr) => onTake(id, addr)} disabled={isThisTbActioning} />
            )}

            {/* Confirm with preimage */}
            {order.status === 2 && !isExpired && myPreimage && (
              <button className="btn-p fs-72 p-6-14"
                disabled={isThisTbActioning}
                onClick={(e) => { e.stopPropagation(); onConfirm(order.id, myPreimage); }}>
                Reveal Preimage & Release Tokens
              </button>
            )}

            {/* Confirm with manual preimage */}
            {order.status === 2 && !isExpired && !myPreimage && (
              <PreimageInput orderId={order.id}
                onConfirm={(id, pre) => onConfirm(id, pre)} disabled={isThisTbActioning} />
            )}

            {/* Refund expired */}
            {isExpired && order.status === 2 && (
              <button style={{ ...btnSmall, background: 'rgba(239,68,68,.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }}
                disabled={isThisTbActioning}
                onClick={(e) => { e.stopPropagation(); onRefund(order.id); }}>
                Refund (Return Tokens)
              </button>
            )}

            {/* Cancel */}
            {order.status === 1 && isMyOrder && (
              <button style={{ ...btnSmall, background: 'rgba(107,114,128,.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,.3)' }}
                disabled={isThisTbActioning}
                onClick={(e) => { e.stopPropagation(); onCancel(order.id); }}>
                Cancel
              </button>
            )}
          </div>

          {isThisTbActioning && actionStep && (
            <div className="cc-step-status" aria-live="polite">
              {actionStep}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const EscrowOrderCard = React.memo(EscrowOrderCardBase);
export default EscrowOrderCard;
