/**
 * MultiSenderProgress.test.tsx -- Tests for src/components/multisender/MultiSenderProgress.tsx
 *
 * Covers: progress bar, status summary, results list, complete message, buttons
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultiSenderProgress from '../components/multisender/MultiSenderProgress';
import type { SendResult } from '../components/multisender/MultiSenderProgress';

const mkResult = (overrides: Partial<SendResult> = {}): SendResult => ({
  address: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my',
  amount: '100',
  status: 'pending',
  ...overrides,
});

describe('MultiSenderProgress', () => {
  const defaultProps = {
    results: [
      mkResult({ status: 'success' }),
      mkResult({ status: 'error', error: 'Insufficient funds', address: 'opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa' }),
      mkResult({ status: 'pending', address: 'opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802' }),
    ],
    sending: false,
    sendComplete: false,
    tokenSymbol: 'MINE',
    completedCount: 1,
    failedCount: 1,
    progressPct: 66.7,
    validRecipientsCount: 3,
    onStartSend: vi.fn(),
    onReset: vi.fn(),
  };

  it('renders title and progress bar', () => {
    render(<MultiSenderProgress {...defaultProps} />);
    expect(screen.getByText('Sending Transfers')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('shows status summary', () => {
    render(<MultiSenderProgress {...defaultProps} />);
    expect(screen.getByText('1 sent')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
    expect(screen.getByText('1 remaining')).toBeTruthy();
  });

  it('renders results list with all statuses', () => {
    render(<MultiSenderProgress {...defaultProps} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(3);
    // Error message visible
    expect(screen.getByText('Insufficient funds')).toBeTruthy();
  });

  it('shows start send button when not sending and not complete', () => {
    render(<MultiSenderProgress {...defaultProps} />);
    const btn = screen.getByText('Send 3 Transfers');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(defaultProps.onStartSend).toHaveBeenCalledTimes(1);
  });

  it('hides start button when sending', () => {
    render(<MultiSenderProgress {...defaultProps} sending={true} />);
    expect(screen.queryByText(/Send \d+ Transfer/)).toBeNull();
  });

  it('shows completion message with all success', () => {
    render(<MultiSenderProgress {...defaultProps} sendComplete={true} completedCount={3} failedCount={0} />);
    expect(screen.getByText('All transfers completed!')).toBeTruthy();
    expect(screen.getByText('3 of 3 transfers successful')).toBeTruthy();
  });

  it('shows completion message with errors', () => {
    render(<MultiSenderProgress {...defaultProps} sendComplete={true} />);
    expect(screen.getByText('Completed with 1 error')).toBeTruthy();
  });

  it('shows New Batch button when complete', () => {
    render(<MultiSenderProgress {...defaultProps} sendComplete={true} />);
    const btn = screen.getByText('New Batch');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(defaultProps.onReset).toHaveBeenCalledTimes(1);
  });

  it('shows plural errors message', () => {
    render(<MultiSenderProgress {...defaultProps} sendComplete={true} failedCount={3} />);
    expect(screen.getByText('Completed with 3 errors')).toBeTruthy();
  });

  it('truncates long addresses', () => {
    const longAddr = 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my';
    render(<MultiSenderProgress {...defaultProps} results={[mkResult({ address: longAddr })]} />);
    // Address should be truncated with ...
    const listItem = screen.getByRole('listitem');
    expect(listItem.textContent).toContain('...');
  });

  it('singular transfer text for 1 recipient', () => {
    render(<MultiSenderProgress {...defaultProps} validRecipientsCount={1} results={[mkResult()]} />);
    expect(screen.getByText('Send 1 Transfer')).toBeTruthy();
  });

  it('shows sending status icon', () => {
    render(<MultiSenderProgress {...defaultProps} sending={true} results={[mkResult({ status: 'sending' })]} />);
    const item = screen.getByRole('listitem');
    expect(item).toBeTruthy();
  });
});
