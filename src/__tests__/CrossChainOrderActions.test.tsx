/**
 * CrossChainOrderActions.test.tsx -- Tests for src/components/crosschain/CrossChainOrderActions.tsx
 *
 * Covers: EscrowOrderCard render, StatusBadge
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatus } from '../crosschain/types';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { EscrowOrderCard } from '../components/crosschain/CrossChainOrderActions';

describe('EscrowOrderCard', () => {
  const baseOrder = {
    id: '1',
    direction: 1, // sell_token
    status: OrderStatus.Open,
    creator: 'abc123',
    taker: '',
    tokenHex: 'deadbeef',
    tokenAmount: 1000000n * 100000000n,
    btcPrice: 50000n,
    hashlock: '0000',
    preimage: '',
    expiry: 200,
    makerAddr: 'bc1pmaker',
    takerAddr: '',
    feePaid: 0n,
  };

  const defaultProps = {
    order: baseOrder,
    currentBlock: 100,
    actioning: null,
    actionStep: '',
    feeBps: 100,
    mldsaHex: 'fff',
    preimageStore: {},
    expandedOrder: null,
    setExpandedOrder: vi.fn(),
    tokenInfo: { symbol: 'MINE', icon: '\u26CF', decimals: 8, address: 'opt1sqtest' },
    onTake: vi.fn(),
    onConfirm: vi.fn(),
    onRefund: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders order card', () => {
    render(<EscrowOrderCard {...defaultProps} />);
    // Should render order status badge
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('renders without crash for Taken status', () => {
    render(<EscrowOrderCard {...defaultProps} order={{ ...baseOrder, status: OrderStatus.Taken, taker: 'taker1' }} />);
    expect(screen.getByText('Taken')).toBeTruthy();
  });

  it('renders without crash for Completed status', () => {
    render(<EscrowOrderCard {...defaultProps} order={{ ...baseOrder, status: OrderStatus.Completed }} />);
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('renders without crash for Cancelled status', () => {
    render(<EscrowOrderCard {...defaultProps} order={{ ...baseOrder, status: OrderStatus.Cancelled }} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});
