import React from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import type { Recipient } from './MultiSenderSetup';

export interface MultiSenderReviewProps {
  tokenSymbol: string;
  validRecipients: Recipient[];
  totalAmount: number;
  estimatedGasSats: number;
  estimatedGasBtc: string;
}

const MultiSenderReview: React.FC<MultiSenderReviewProps> = ({
  tokenSymbol, validRecipients, totalAmount, estimatedGasSats, estimatedGasBtc,
}) => {
  const { walletAddress, openConnectModal } = useWalletConnect();
  const connected = !!walletAddress;

  return (
    <div className="P p-20">
      <div className="Lb">Review Transfers</div>

      {/* Summary cards */}
      <div className="grid-3col gap-8 mb-14">
        <div className="ms-summary-card ms-sum-o">
          <div className="ms-summary-label">Token</div>
          <div className="ms-summary-val c-o">{tokenSymbol || 'Custom'}</div>
        </div>
        <div className="ms-summary-card ms-sum-b">
          <div className="ms-summary-label">Recipients</div>
          <div className="ms-summary-val c-c2">{validRecipients.length}</div>
        </div>
        <div className="ms-summary-card ms-sum-g">
          <div className="ms-summary-label">Total Amount</div>
          <div className="ms-summary-val c-g">{totalAmount.toLocaleString()}</div>
        </div>
      </div>

      {/* Recipient table */}
      <div className="br-12 bd mb-14" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className="w-full fs-72" aria-label="Recipients to receive transfers" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
              <th className="text-left c-t3 fw-600 fs-66" style={{ padding: '8px 10px' }}>#</th>
              <th className="text-left c-t3 fw-600 fs-66" style={{ padding: '8px 10px' }}>Recipient</th>
              <th className="c-t3 fw-600 fs-66" style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {validRecipients.map((r, i) => (
              <tr key={i} className="bd-b">
                <td className="c-t4 text-mono" style={{ padding: '7px 10px' }}>{i + 1}</td>
                <td className="c-t2 text-mono fs-68" style={{ padding: '7px 10px' }}>
                  {r.address.length > 30
                    ? r.address.slice(0, 14) + '...' + r.address.slice(-10)
                    : r.address}
                </td>
                <td className="c-w text-mono fw-600" style={{ padding: '7px 10px', textAlign: 'right' }}>
                  {parseFloat(r.amount).toLocaleString()} {tokenSymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gas estimate */}
      <div className="flex-between br-12 fs-72 p-10-14 ms-sum-o">
        <span className="c-t3">Estimated gas ({validRecipients.length} txns):</span>
        <span className="fw-700 c-o text-mono">
          ~{estimatedGasSats.toLocaleString()} sats (~{estimatedGasBtc} BTC)
        </span>
      </div>

      {/* Wallet check */}
      {!connected && (
        <div className="mt-12 br-12 fs-72 text-center cc-result-err" role="alert">
          Connect your wallet to proceed.
          <button className="btn-p fs-68 ml-10 p-4-12" onClick={openConnectModal}>
            Connect
          </button>
        </div>
      )}

      {connected && (
        <div className="mt-10 br-8 fs-68 c-g cc-result-ok" aria-live="polite">
          Wallet: {walletAddress.slice(0, 16)}...{walletAddress.slice(-8)}
        </div>
      )}
    </div>
  );
};

export default React.memo(MultiSenderReview);
