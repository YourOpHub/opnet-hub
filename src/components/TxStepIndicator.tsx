/**
 * TxStepIndicator — visual step progress for multi-step transaction flows.
 *
 * Renders a horizontal step bar with numbered circles and labels.
 * Uses the app's CSS variables for dark-theme consistency.
 */
import React from 'react';

const DEFAULT_STEPS = ['Approve', 'Confirm', 'Execute', 'Done'];

/** Map a TxStep value to its index in the steps array */
function stepIndex(step: string, steps: string[]): number {
  const map: Record<string, number> = {
    idle: -1,
    approving: 0,
    waiting: 1,
    executing: 2,
    done: steps.length - 1,
    error: -2,
  };
  return map[step] ?? -1;
}

interface TxStepIndicatorProps {
  step: string;
  steps?: string[];
  error?: string;
  txHash?: string;
  onRetry?: () => void;
}

const TxStepIndicator: React.FC<TxStepIndicatorProps> = ({
  step,
  steps = DEFAULT_STEPS,
  error,
  txHash,
  onRetry,
}) => {
  const current = stepIndex(step, steps);
  const isError = step === 'error';
  const isDone = step === 'done';

  return (
    <div style={styles.container}>
      {/* Step circles + connectors */}
      <div style={styles.track}>
        {steps.map((label, i) => {
          const completed = !isError && current > i;
          const active = !isError && current === i;
          const errored = isError && i === Math.max(current, 0);

          let circleColor = 'rgba(255,255,255,.15)';
          if (completed) circleColor = 'var(--g)';
          else if (active) circleColor = 'var(--o)';
          else if (errored) circleColor = 'var(--r)';

          let lineColor = 'rgba(255,255,255,.1)';
          if (completed) lineColor = 'var(--g)';

          return (
            <React.Fragment key={i}>
              {/* Connector line (skip before first) */}
              {i > 0 && (
                <div
                  style={{
                    ...styles.line,
                    background: lineColor,
                  }}
                />
              )}
              {/* Step circle + label */}
              <div style={styles.stepCol}>
                <div
                  style={{
                    ...styles.circle,
                    background: circleColor,
                    boxShadow: active
                      ? '0 0 12px rgba(247,147,26,.4)'
                      : errored
                        ? '0 0 12px rgba(239,68,68,.4)'
                        : 'none',
                  }}
                >
                  {completed ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : errored ? (
                    <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>!</span>
                  ) : (
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{i + 1}</span>
                  )}
                </div>
                <span
                  style={{
                    ...styles.label,
                    color: active
                      ? 'var(--o)'
                      : completed
                        ? 'var(--g)'
                        : errored
                          ? 'var(--r)'
                          : 'rgba(255,255,255,.4)',
                  }}
                >
                  {label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Status message */}
      {(isError || isDone || step === 'waiting') && (
        <div style={styles.messageRow}>
          {isError && error && (
            <p style={styles.errorText}>{error}</p>
          )}
          {isDone && txHash && (
            <p style={styles.doneText}>
              TX: <span style={styles.hash}>{txHash.slice(0, 10)}...{txHash.slice(-8)}</span>
            </p>
          )}
          {step === 'waiting' && (
            <p style={styles.waitingText}>Waiting for block confirmation...</p>
          )}
        </div>
      )}

      {/* Retry button on error */}
      {isError && onRetry && (
        <button onClick={onRetry} style={styles.retryBtn}>
          Retry
        </button>
      )}
    </div>
  );
};

/** Inline styles using CSS variables from the app's dark theme */
const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'rgba(10,10,18,.5)',
    borderRadius: 12,
    padding: '16px 20px',
    fontFamily: 'var(--ff)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  track: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  stepCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    minWidth: 56,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all .3s ease',
    flexShrink: 0,
  },
  line: {
    height: 2,
    flex: 1,
    minWidth: 24,
    maxWidth: 64,
    borderRadius: 1,
    transition: 'background .3s ease',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.02em',
    textTransform: 'uppercase' as const,
    transition: 'color .3s ease',
    whiteSpace: 'nowrap',
  },
  messageRow: {
    textAlign: 'center',
    marginTop: 4,
  },
  errorText: {
    color: 'var(--r)',
    fontSize: 13,
    fontFamily: 'var(--fm)',
    margin: 0,
    wordBreak: 'break-word',
  },
  doneText: {
    color: 'var(--g)',
    fontSize: 13,
    margin: 0,
  },
  hash: {
    fontFamily: 'var(--fm)',
    opacity: 0.85,
  },
  waitingText: {
    color: 'var(--o)',
    fontSize: 13,
    margin: 0,
    opacity: 0.9,
  },
  retryBtn: {
    alignSelf: 'center',
    background: 'rgba(239,68,68,.15)',
    color: 'var(--r)',
    border: '1px solid rgba(239,68,68,.3)',
    borderRadius: 8,
    padding: '6px 20px',
    fontSize: 13,
    fontFamily: 'var(--ff)',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all .2s ease',
  },
};

export default TxStepIndicator;
