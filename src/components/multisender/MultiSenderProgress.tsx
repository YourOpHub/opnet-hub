import React from 'react';

export interface SendResult {
  address: string;
  amount: string;
  status: 'pending' | 'sending' | 'success' | 'error';
  error?: string;
}

export interface MultiSenderProgressProps {
  results: SendResult[];
  sending: boolean;
  sendComplete: boolean;
  tokenSymbol: string;
  completedCount: number;
  failedCount: number;
  progressPct: number;
  validRecipientsCount: number;
  onStartSend: () => void;
  onReset: () => void;
}

const MultiSenderProgress: React.FC<MultiSenderProgressProps> = ({
  results, sending, sendComplete, tokenSymbol,
  completedCount, failedCount, progressPct,
  validRecipientsCount, onStartSend, onReset,
}) => {
  return (
    <div className="P p-20">
      <div className="Lb">Sending Transfers</div>

      {/* Progress bar */}
      <div className="ms-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Transfer progress">
        <div style={{
          height: '100%', borderRadius: 4,
          background: failedCount > 0 ? 'linear-gradient(90deg, var(--g), var(--r))' : 'var(--g)',
          width: `${progressPct}%`, transition: 'width .4s ease',
        }} />
      </div>

      {/* Status summary */}
      <div className="flex-jc-center gap-12 mb-14 fs-74 fw-600" aria-live="polite">
        <span className="c-g">{completedCount} sent</span>
        <span className="c-r">{failedCount} failed</span>
        <span className="c-t3">
          {results.length - completedCount - failedCount} remaining
        </span>
      </div>

      {/* Results list */}
      <div className="br-12 bd ov-y-auto" role="list" aria-label="Transfer results" style={{ maxHeight: 340 }}>
        {results.map((r, i) => (
          <div
            key={i}
            role="listitem"
            aria-label={`Transfer to ${r.address.length > 30 ? r.address.slice(0, 14) + '...' : r.address}: ${r.status}`}
            className="d-flex ai-center gap-10 p-10-12 bd-b"
            style={{ background: r.status === 'sending' ? 'rgba(247,147,26,.04)' : 'transparent' }}
          >
            {/* Status icon */}
            <div className="w-22 h-22 br-50 d-flex ai-center jc-center flex-shrink-0 fs-70"
              style={{
                background:
                  r.status === 'success' ? 'rgba(34,197,94,.15)' :
                  r.status === 'error' ? 'rgba(239,68,68,.15)' :
                  r.status === 'sending' ? 'rgba(247,147,26,.15)' :
                  'var(--bg3)',
              }}>
              {r.status === 'success' && <span className="c-g">{'\u2713'}</span>}
              {r.status === 'error' && <span className="c-r">{'\u2717'}</span>}
              {r.status === 'sending' && (
                <span className="c-o" style={{ animation: 'spin 1s linear infinite' }}>
                  {'\u25E6'}
                </span>
              )}
              {r.status === 'pending' && <span className="c-t4">{'\u2022'}</span>}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="fs-70 c-t2 text-mono">
                {r.address.length > 30
                  ? r.address.slice(0, 14) + '...' + r.address.slice(-10)
                  : r.address}
              </div>
              {r.error && (
                <div className="fs-60 c-r mt-2">{r.error}</div>
              )}
            </div>

            {/* Amount */}
            <div className="fs-72 text-mono fw-600 flex-shrink-0"
              style={{ color: r.status === 'success' ? 'var(--g)' : 'var(--t2)' }}>
              {parseFloat(r.amount).toLocaleString()} {tokenSymbol}
            </div>
          </div>
        ))}
      </div>

      {/* Complete message */}
      {sendComplete && (
        <div className="mt-14 p-14 br-12 text-center" style={{
          background: failedCount === 0 ? 'rgba(34,197,94,.08)' : 'rgba(234,179,8,.08)',
          border: `1px solid ${failedCount === 0 ? 'rgba(34,197,94,.2)' : 'rgba(234,179,8,.2)'}`,
        }}>
          <div className="fw-700 fs-88" role="alert"
            style={{ color: failedCount === 0 ? 'var(--g)' : '#eab308' }}>
            {failedCount === 0
              ? 'All transfers completed!'
              : `Completed with ${failedCount} error${failedCount > 1 ? 's' : ''}`}
          </div>
          <div className="fs-68 c-t3 mt-4">
            {completedCount} of {results.length} transfers successful
          </div>
        </div>
      )}

      {/* Start / Reset buttons */}
      {!sending && !sendComplete && (
        <button
          className="btn-p w-full mt-14 fw-700 fs-82 p-12"
          onClick={onStartSend}
        >
          Send {validRecipientsCount} Transfer{validRecipientsCount !== 1 ? 's' : ''}
        </button>
      )}
      {sendComplete && (
        <button
          className="btn-s w-full mt-10 fs-78 p-10"
          onClick={onReset}
        >
          New Batch
        </button>
      )}
    </div>
  );
};

export default React.memo(MultiSenderProgress);
