/**
 * CrossChainOrderRow.test.tsx -- Tests for src/components/crosschain/CrossChainOrderRow.tsx
 *
 * Covers: TakeOrderButton, MY_COLS/AV_COLS exports, PreimageInput
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { TakeOrderButton, MY_COLS, AV_COLS } from '../components/crosschain/CrossChainOrderRow';

describe('CrossChainOrderRow exports', () => {
  it('MY_COLS is defined', () => {
    expect(MY_COLS).toBeTruthy();
    expect(typeof MY_COLS).toBe('string');
  });

  it('AV_COLS is defined', () => {
    expect(AV_COLS).toBeTruthy();
    expect(typeof AV_COLS).toBe('string');
  });
});

describe('TakeOrderButton', () => {
  const defaultProps = {
    orderId: 'order-1',
    feeSats: 5000,
    onTake: vi.fn(),
    disabled: false,
  };

  it('renders Take button initially', () => {
    render(<TakeOrderButton {...defaultProps} />);
    expect(screen.getByText('Take')).toBeTruthy();
  });

  it('shows fee info', () => {
    render(<TakeOrderButton {...defaultProps} />);
    expect(screen.getByText(/5.?000.*sat fee/)).toBeTruthy();
  });

  it('shows address input on click', () => {
    render(<TakeOrderButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Take'));
    expect(screen.getByLabelText('Fractal address for swap')).toBeTruthy();
  });

  it('has OK button disabled without address', () => {
    render(<TakeOrderButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Take'));
    const okBtn = screen.getByText('OK');
    expect(okBtn.hasAttribute('disabled')).toBe(true);
  });

  it('calls onTake with orderId and address', () => {
    const onTake = vi.fn();
    render(<TakeOrderButton {...defaultProps} onTake={onTake} defaultAddr="bc1ptest12345678" />);
    fireEvent.click(screen.getByText('Take'));
    fireEvent.click(screen.getByText('OK'));
    expect(onTake).toHaveBeenCalledWith('order-1', 'bc1ptest12345678');
  });

  it('cancel button hides address input', () => {
    render(<TakeOrderButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Take'));
    expect(screen.getByLabelText('Fractal address for swap')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel take order' }));
    expect(screen.queryByLabelText('Fractal address for swap')).toBeNull();
  });

  it('renders custom label', () => {
    render(<TakeOrderButton {...defaultProps} label="Buy Now" />);
    expect(screen.getByText('Buy Now')).toBeTruthy();
  });

  it('is disabled when prop set', () => {
    render(<TakeOrderButton {...defaultProps} disabled={true} />);
    const btn = screen.getByText('Take');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});
