/**
 * CrossChainOrderForm.test.tsx -- Tests for src/components/crosschain/CrossChainOrderForm.tsx
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import CrossChainOrderForm from '../components/crosschain/CrossChainOrderForm';

const makeProps = () => ({
  formAmount: '0.001',
  setFormAmount: vi.fn(),
  formReceive: '0.001',
  setFormReceive: vi.fn(),
  formMakerAddr: '',
  setFormMakerAddr: vi.fn(),
  setMakerAddrManual: vi.fn(),
  formExpiry: '144',
  setFormExpiry: vi.fn(),
  creating: false,
  createStep: '',
  contractReady: true,
  feeBps: 100,
  formAmountSats: 100000n,
  formReceiveSats: 100000n,
  formFeeSats: 1000n,
  formRate: '1.00',
  onSubmit: vi.fn(),
});

describe('CrossChainOrderForm', () => {
  it('renders form role', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByRole('form', { name: 'Create swap order' })).toBeTruthy();
  });

  it('renders BTC lock and FB want inputs', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByLabelText(/Amount of BTC to lock/)).toBeTruthy();
    expect(screen.getByLabelText(/Amount of FB you want/)).toBeTruthy();
  });

  it('renders Fractal receiving address input', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByLabelText(/Fractal receiving address/i)).toBeTruthy();
  });

  it('renders summary section', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByText(/You lock:/)).toBeTruthy();
    expect(screen.getByText(/Taker fee/)).toBeTruthy();
  });

  it('shows creating text', () => {
    const props = makeProps();
    props.creating = true;
    props.formMakerAddr = 'bc1pfoo';
    render(<CrossChainOrderForm {...props} />);
    expect(screen.getByText('Creating...')).toBeTruthy();
  });

  it('renders Lock BTC button', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByText('Lock BTC & Create Order')).toBeTruthy();
  });
});
