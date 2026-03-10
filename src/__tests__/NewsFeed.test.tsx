/**
 * NewsFeed.test.tsx -- Tests for src/components/NewsFeed.tsx
 *
 * Covers: initial render, mode switching (live/social), social feed display
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../opnet', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(5000),
  getGasParameters: vi.fn().mockResolvedValue(null),
  getMempoolInfo: vi.fn().mockResolvedValue(null),
  callContract: vi.fn().mockResolvedValue(null),
  getBlockByNumber: vi.fn().mockResolvedValue(null),
}));

vi.mock('../btc-price', () => ({
  fetchBtcPrice: vi.fn().mockResolvedValue({ usd: 95000, usd_24h_change: 1.5 }),
}));

import NewsFeed from '../components/NewsFeed';

describe('NewsFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders news feed header', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Network Feed')).toBeTruthy();
    // Multiple elements match "Live on-chain activity" (subtitle + live feed label)
    const matches = screen.getAllByText(/Live on-chain activity/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders mode toggle tabs', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('tablist', { name: 'Feed mode' })).toBeTruthy();
    expect(screen.getByText(/Live Activity/)).toBeTruthy();
    expect(screen.getByText('Social Feed')).toBeTruthy();
  });

  it('starts in live mode', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const liveTab = screen.getByText(/Live Activity/).closest('button');
    expect(liveTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('switches to social feed mode', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByText('Social Feed'));
    // Social feed shows curated posts with handles (multiple elements match each handle)
    const opHandles = screen.getAllByText(/@opaborat/);
    expect(opHandles.length).toBeGreaterThanOrEqual(1);
    const motoHandles = screen.getAllByText(/@maboratmarket/);
    expect(motoHandles.length).toBeGreaterThanOrEqual(1);
  });

  it('shows social links in social mode', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByText('Social Feed'));
    // Social links section
    const links = screen.getAllByText(/@opaborat/);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('shows post tags', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByText('Social Feed'));
    expect(screen.getByText('Breaking')).toBeTruthy();
    expect(screen.getByText('DeFi')).toBeTruthy();
  });

  it('sets localStorage on visit', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(localStorage.getItem('hub_news_visited')).toBe('1');
  });

  it('switches back to live mode', async () => {
    render(<NewsFeed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByText('Social Feed'));
    fireEvent.click(screen.getByText(/Live Activity/));
    const liveTab = screen.getByText(/Live Activity/).closest('button');
    expect(liveTab?.getAttribute('aria-selected')).toBe('true');
  });
});
