/**
 * CrossChainOrderForm.test.tsx -- Tests for src/components/crosschain/CrossChainOrderForm.tsx
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwapDirection } from '../crosschain/types';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import CrossChainOrderForm from '../components/crosschain/CrossChainOrderForm';

const makeProps = () => ({
  formDirection: SwapDirection.BTC_TO_FB,
  setFormDirection: vi.fn(),
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
  sendUnit: 'BTC',
  receiveUnit: 'FB',
  onSubmit: vi.fn(),
});

describe('CrossChainOrderForm', () => {
  it('renders form role', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByRole('form', { name: 'Create swap order' })).toBeTruthy();
  });

  it('renders direction buttons', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByText('I have BTC, want FB')).toBeTruthy();
    expect(screen.getByText('I have FB, want BTC')).toBeTruthy();
  });

  it('renders pay and get inputs', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByLabelText(/Amount you pay in BTC/)).toBeTruthy();
    expect(screen.getByLabelText(/Amount you get in FB/)).toBeTruthy();
  });

  it('renders receiving address input', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByLabelText(/Fractal.*receiving address/i)).toBeTruthy();
  });

  it('calls setFormDirection on direction change', () => {
    const props = makeProps();
    render(<CrossChainOrderForm {...props} />);
    fireEvent.click(screen.getByText('I have FB, want BTC'));
    expect(props.setFormDirection).toHaveBeenCalledWith(SwapDirection.FB_TO_BTC);
  });

  it('renders summary section', () => {
    render(<CrossChainOrderForm {...makeProps()} />);
    expect(screen.getByText(/You pay:/)).toBeTruthy();
    expect(screen.getByText(/Taker fee/)).toBeTruthy();
  });

  it('shows creating text', () => {
    const props = makeProps();
    props.creating = true;
    props.formMakerAddr = 'bc1pfoo';
    render(<CrossChainOrderForm {...props} />);
    expect(screen.getByText('Creating...')).toBeTruthy();
  });
});
