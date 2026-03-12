/**
 * MultiSenderSetup.test.tsx -- Tests for MultiSenderSetup component + parseRecipients + formatAmount
 *
 * Covers: pure functions, step 1 token selection, step 2 recipient input, validation display
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultiSenderSetup, { parseRecipients, formatAmount } from '../components/multisender/MultiSenderSetup';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('parseRecipients', () => {
  it('parses valid comma-separated lines', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,100\nopt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa,250');
    expect(result.length).toBe(2);
    expect(result[0]!.valid).toBe(true);
    expect(result[0]!.amount).toBe('100');
    expect(result[1]!.valid).toBe(true);
    expect(result[1]!.amount).toBe('250');
  });

  it('parses tab-separated lines', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my\t500');
    expect(result.length).toBe(1);
    expect(result[0]!.valid).toBe(true);
    expect(result[0]!.amount).toBe('500');
  });

  it('parses space-separated lines', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my 200');
    expect(result.length).toBe(1);
    expect(result[0]!.valid).toBe(true);
  });

  it('marks short addresses as invalid', () => {
    const result = parseRecipients('opt1short,100');
    expect(result.length).toBe(1);
    expect(result[0]!.valid).toBe(false);
  });

  it('marks zero amount as invalid', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,0');
    expect(result.length).toBe(1);
    expect(result[0]!.valid).toBe(false);
  });

  it('marks negative amount as invalid', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,-50');
    expect(result[0]!.valid).toBe(false);
  });

  it('marks missing amount as invalid', () => {
    const result = parseRecipients('opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my');
    expect(result[0]!.valid).toBe(false);
  });

  it('accepts 0x hex addresses of length 66', () => {
    const hex66 = '0x' + 'a'.repeat(64);
    const result = parseRecipients(`${hex66},100`);
    expect(result[0]!.valid).toBe(true);
  });

  it('accepts bc1 addresses', () => {
    const bc1 = 'bc1' + 'q'.repeat(39);
    const result = parseRecipients(`${bc1},100`);
    expect(result[0]!.valid).toBe(true);
  });

  it('skips empty lines', () => {
    const result = parseRecipients('\n\nopt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my,100\n\n');
    expect(result.length).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(parseRecipients('')).toEqual([]);
  });
});

describe('formatAmount', () => {
  it('formats integer amount with 8 decimals', () => {
    expect(formatAmount('100', 8)).toBe(10000000000n);
  });

  it('formats decimal amount with 8 decimals', () => {
    expect(formatAmount('1.5', 8)).toBe(150000000n);
  });

  it('formats amount with 0 decimals', () => {
    expect(formatAmount('42', 0)).toBe(42n);
  });

  it('returns 0n for invalid amount', () => {
    expect(formatAmount('abc', 8)).toBe(0n);
  });

  it('returns 0n for zero amount', () => {
    expect(formatAmount('0', 8)).toBe(0n);
  });

  it('returns 0n for negative amount', () => {
    expect(formatAmount('-5', 8)).toBe(0n);
  });

  it('truncates excess decimal places', () => {
    // "1.123456789" with 8 decimals -> should take only 8 decimal digits
    expect(formatAmount('1.123456789', 8)).toBe(112345678n);
  });

  it('pads missing decimal places', () => {
    expect(formatAmount('1.1', 8)).toBe(110000000n);
  });

  it('formats with 18 decimals', () => {
    expect(formatAmount('1', 18)).toBe(1000000000000000000n);
  });
});

describe('MultiSenderSetup component', () => {
  const baseProps = {
    step: 1 as number,
    selectedToken: '',
    setSelectedToken: vi.fn(),
    customAddress: '',
    setCustomAddress: vi.fn(),
    tokenDecimals: 8,
    setTokenDecimals: vi.fn(),
    tokenSymbol: '',
    setTokenSymbol: vi.fn(),
    useCustom: false,
    setUseCustom: vi.fn(),
    rawInput: '',
    setRawInput: vi.fn(),
    recipients: [] as Array<{ address: string; amount: string; valid: boolean }>,
    validRecipients: [] as Array<{ address: string; amount: string; valid: boolean }>,
    invalidCount: 0,
    totalAmount: 0,
  };

  it('renders step 1 - token selection', () => {
    render(<MultiSenderSetup {...baseProps} />);
    expect(screen.getByText('Choose Token')).toBeTruthy();
    expect(screen.getByText('MINE')).toBeTruthy();
    expect(screen.getByText('VIBE')).toBeTruthy();
  });

  it('renders step 2 - recipient list', () => {
    render(<MultiSenderSetup {...baseProps} step={2} />);
    expect(screen.getByText('Recipient List')).toBeTruthy();
    expect(screen.getByLabelText(/Recipient list/i)).toBeTruthy();
  });

  it('returns null for step 3', () => {
    const { container } = render(<MultiSenderSetup {...baseProps} step={3} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for step 4', () => {
    const { container } = render(<MultiSenderSetup {...baseProps} step={4} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows custom address section when useCustom is true', () => {
    render(<MultiSenderSetup {...baseProps} useCustom={true} />);
    expect(screen.getByLabelText('Custom contract address')).toBeTruthy();
    expect(screen.getByLabelText('Token decimals')).toBeTruthy();
    expect(screen.getByLabelText('Token symbol')).toBeTruthy();
  });

  it('shows validation summary on step 2 with recipients', () => {
    const recipients = [
      { address: 'opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my', amount: '100', valid: true },
      { address: 'short', amount: '50', valid: false },
    ];
    render(<MultiSenderSetup {...baseProps} step={2} recipients={recipients} validRecipients={[recipients[0]!]} invalidCount={1} totalAmount={100} tokenSymbol="MINE" />);
    expect(screen.getByText(/1 valid recipient/)).toBeTruthy();
    expect(screen.getByText(/1 invalid/)).toBeTruthy();
    expect(screen.getByText(/100/)).toBeTruthy();
  });

  it('has Sample Data button on step 2', () => {
    render(<MultiSenderSetup {...baseProps} step={2} />);
    const sampleBtn = screen.getByText('Sample Data');
    expect(sampleBtn).toBeTruthy();
    fireEvent.click(sampleBtn);
    expect(baseProps.setRawInput).toHaveBeenCalled();
  });

  it('has Clear button on step 2', () => {
    render(<MultiSenderSetup {...baseProps} step={2} />);
    const clearBtn = screen.getByText('Clear');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn);
    expect(baseProps.setRawInput).toHaveBeenCalledWith('');
  });

  it('has Upload CSV button on step 2', () => {
    render(<MultiSenderSetup {...baseProps} step={2} />);
    expect(screen.getByText('Upload CSV')).toBeTruthy();
  });
});
