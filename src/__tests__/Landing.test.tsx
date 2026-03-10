/**
 * Landing.test.tsx -- Tests for src/components/Landing.tsx
 *
 * Covers: hero, features grid, tech pillars, CTA, links, navigation callbacks
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(5000),
  callContract: vi.fn().mockResolvedValue(null),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({
    usd: 90000,
    usd_24h_change: 1.5,
    usd_market_cap: 1800000000000,
  }),
}));

import Landing from '../components/Landing';

describe('Landing', () => {
  const onNav = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onNav.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders hero section', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByText('Bitcoin L1 Smart Contracts')).toBeTruthy();
    expect(screen.getByText(/Pure Bitcoin/)).toBeTruthy();
  });

  it('renders hero description', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText(/Swap, stake, and earn/)).toBeTruthy();
  });

  it('renders Start Trading button that navigates to swap', () => {
    render(<Landing onNav={onNav} />);
    const btn = screen.getByLabelText('Start trading tokens');
    fireEvent.click(btn);
    expect(onNav).toHaveBeenCalledWith('swap');
  });

  it('renders Play & Earn button that navigates to game', () => {
    render(<Landing onNav={onNav} />);
    const btn = screen.getByLabelText('Play and earn tokens');
    fireEvent.click(btn);
    expect(onNav).toHaveBeenCalledWith('game');
  });

  it('renders Read Docs link', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText('Read Docs')).toBeTruthy();
  });

  it('renders features grid', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText('What you can do')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Features' })).toBeTruthy();
    expect(screen.getByText('Swap')).toBeTruthy();
    expect(screen.getByText('Stake')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Market')).toBeTruthy();
    expect(screen.getByText('Explorer')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('MultiSend')).toBeTruthy();
    expect(screen.getByText('FractalSwap')).toBeTruthy();
    expect(screen.getByText('News')).toBeTruthy();
  });

  it('feature cards navigate on click', () => {
    render(<Landing onNav={onNav} />);
    const swapCard = screen.getByLabelText('Swap: Trade OP-20 tokens on a real Bitcoin L1 AMM with 0.3% fees');
    fireEvent.click(swapCard);
    expect(onNav).toHaveBeenCalledWith('swap');
  });

  it('feature cards navigate on Enter key', () => {
    render(<Landing onNav={onNav} />);
    const stakeCard = screen.getByLabelText(/^Stake:/);
    fireEvent.keyDown(stakeCard, { key: 'Enter' });
    expect(onNav).toHaveBeenCalledWith('staking');
  });

  it('renders tech stack section', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText('The stack')).toBeTruthy();
    expect(screen.getByText('Cryptographic')).toBeTruthy();
    expect(screen.getByText('WASM')).toBeTruthy();
    expect(screen.getByText('ML-DSA')).toBeTruthy();
  });

  it('renders CTA banner', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText('Ready to build on Bitcoin?')).toBeTruthy();
    const launchBtn = screen.getByLabelText('Launch a token on Bitcoin');
    fireEvent.click(launchBtn);
    expect(onNav).toHaveBeenCalledWith('launch');
  });

  it('renders external links', () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByText(/Documentation/)).toBeTruthy();
    expect(screen.getByText(/OPScan Explorer/)).toBeTruthy();
    expect(screen.getByText(/Vibecode Challenge/)).toBeTruthy();
    expect(screen.getByText(/Ecosystem/)).toBeTruthy();
  });

  it('renders live ticker', async () => {
    render(<Landing onNav={onNav} />);
    expect(screen.getByRole('region', { name: 'Live market data' })).toBeTruthy();
    expect(screen.getByText('Bitcoin')).toBeTruthy();
    expect(screen.getByText('OP_NET Block')).toBeTruthy();
    expect(screen.getByText('MINE / VIBE')).toBeTruthy();
    expect(screen.getByText('Network')).toBeTruthy();
  });

  it('ticker MINE/VIBE navigates to swap on click', () => {
    render(<Landing onNav={onNav} />);
    const mineVibe = screen.getByLabelText('View MINE/VIBE swap rate');
    fireEvent.click(mineVibe);
    expect(onNav).toHaveBeenCalledWith('swap');
  });

  it('ticker Network navigates to analytics on click', () => {
    render(<Landing onNav={onNav} />);
    const network = screen.getByLabelText('View network analytics');
    fireEvent.click(network);
    expect(onNav).toHaveBeenCalledWith('analytics');
  });

  it('ticker keyboard navigation works', () => {
    render(<Landing onNav={onNav} />);
    const mineVibe = screen.getByLabelText('View MINE/VIBE swap rate');
    fireEvent.keyDown(mineVibe, { key: 'Enter' });
    expect(onNav).toHaveBeenCalledWith('swap');

    const network = screen.getByLabelText('View network analytics');
    fireEvent.keyDown(network, { key: ' ' });
    expect(onNav).toHaveBeenCalledWith('analytics');
  });
});
