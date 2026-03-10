/**
 * TxStepIndicator.test.tsx -- Tests for src/components/TxStepIndicator.tsx
 *
 * Covers: default steps, step states (idle, approving, waiting, executing, done, error),
 * error display, done with txHash, retry button, custom steps, progressbar ARIA
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TxStepIndicator from '../components/TxStepIndicator';

describe('TxStepIndicator', () => {
  it('renders default 4 steps', () => {
    const { container } = render(<TxStepIndicator step="idle" />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // Default steps: Approve, Confirm, Execute, Done
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.getByText('Execute')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    // Step numbers should be visible
    const spans = container.querySelectorAll('span');
    const numbers = Array.from(spans).filter(s => /^[1-4]$/.test(s.textContent || ''));
    expect(numbers.length).toBe(4);
  });

  it('renders custom steps', () => {
    render(<TxStepIndicator step="idle" steps={['Setup', 'Send', 'Finish']} />);
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Finish')).toBeTruthy();
  });

  it('shows step 1 as active when approving', () => {
    render(<TxStepIndicator step="approving" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('1');
    // "Approve" label should be orange (active)
    const approveLabel = screen.getByText('Approve');
    expect(approveLabel.style.color).toBe('var(--o)');
  });

  it('shows step 2 as active when waiting', () => {
    render(<TxStepIndicator step="waiting" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('2');
    // Waiting text shown
    expect(screen.getByText('Waiting for block confirmation...')).toBeTruthy();
  });

  it('shows step 3 as active when executing', () => {
    render(<TxStepIndicator step="executing" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('3');
  });

  it('shows completed state with txHash', () => {
    render(<TxStepIndicator step="done" txHash="abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('4');
    // Check that txHash is displayed truncated
    expect(screen.getByText(/TX:/)).toBeTruthy();
    expect(screen.getByText(/abcdef1234/)).toBeTruthy();
  });

  it('shows error state with error message', () => {
    render(<TxStepIndicator step="error" error="Transaction failed" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Transaction failed')).toBeTruthy();
  });

  it('shows retry button on error with onRetry callback', () => {
    const onRetry = vi.fn();
    render(<TxStepIndicator step="error" error="Failed" onRetry={onRetry} />);
    const retryBtn = screen.getByText('Retry');
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry button without onRetry', () => {
    render(<TxStepIndicator step="error" error="Failed" />);
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('does not show message row on idle', () => {
    render(<TxStepIndicator step="idle" />);
    expect(screen.queryByText(/Waiting/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/TX:/)).toBeNull();
  });

  it('does not show message row on approving', () => {
    render(<TxStepIndicator step="approving" />);
    expect(screen.queryByText(/Waiting/)).toBeNull();
  });

  it('completed steps show checkmark SVG', () => {
    const { container } = render(<TxStepIndicator step="executing" />);
    // Steps 0 and 1 should be completed (approving, waiting done), step 2 active
    const svgs = container.querySelectorAll('svg');
    // Two completed steps should have SVG checkmarks
    expect(svgs.length).toBe(2);
  });

  it('error step shows exclamation mark', () => {
    const { container } = render(<TxStepIndicator step="error" error="Err" />);
    const exclSpans = Array.from(container.querySelectorAll('span')).filter(s => s.textContent === '!');
    expect(exclSpans.length).toBeGreaterThanOrEqual(1);
  });

  it('done step without txHash does not show TX line', () => {
    render(<TxStepIndicator step="done" />);
    expect(screen.queryByText(/TX:/)).toBeNull();
  });

  it('renders all 4 steps with numbers', () => {
    const { container } = render(<TxStepIndicator step="idle" />);
    // 4 step numbers should be visible
    const spans = Array.from(container.querySelectorAll('span'));
    const numbers = spans.filter(s => /^[1-4]$/.test(s.textContent ?? ''));
    expect(numbers.length).toBe(4);
  });
});
