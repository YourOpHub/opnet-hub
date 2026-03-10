/**
 * EcosystemDir.test.tsx -- Tests for src/components/EcosystemDir.tsx
 *
 * Covers: initial render, category filtering, app listing, localStorage side effect
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EcosystemDir from '../components/EcosystemDir';

describe('EcosystemDir', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<EcosystemDir />);
    expect(screen.getByText(/Apps on Bitcoin/i)).toBeTruthy();
  });

  it('renders category filter buttons', () => {
    render(<EcosystemDir />);
    // Use role=tab to avoid ambiguity with tag labels inside app cards
    expect(screen.getByRole('tab', { name: /Filter by All/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Filter by DeFi/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Filter by Tools/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Filter by Education/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Filter by Social/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Filter by Security/i })).toBeTruthy();
  });

  it('shows all apps by default', () => {
    render(<EcosystemDir />);
    // Should see Motoswap and other apps
    expect(screen.getByText('Motoswap')).toBeTruthy();
  });

  it('filters by DeFi category', () => {
    render(<EcosystemDir />);
    fireEvent.click(screen.getByRole('tab', { name: /Filter by DeFi/i }));
    // Should show DeFi apps like Motoswap
    expect(screen.getByText('Motoswap')).toBeTruthy();
  });

  it('filters by Education category', () => {
    render(<EcosystemDir />);
    fireEvent.click(screen.getByRole('tab', { name: /Filter by Education/i }));
    expect(screen.getByText('Bitcoin DeFi Bible')).toBeTruthy();
    // DeFi-only apps should not be visible
    expect(screen.queryByText('Motoswap')).toBeNull();
  });

  it('filters by Security category', () => {
    render(<EcosystemDir />);
    fireEvent.click(screen.getByRole('tab', { name: /Filter by Security/i }));
    expect(screen.getByText('Eternal Sentinel')).toBeTruthy();
  });

  it('shows Live and Building counts', () => {
    render(<EcosystemDir />);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Building')).toBeTruthy();
  });

  it('has proper ARIA attributes', () => {
    render(<EcosystemDir />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('sets localStorage on mount', () => {
    render(<EcosystemDir />);
    expect(localStorage.getItem('hub_eco_visited')).toBe('1');
  });

  it('can switch back to All after filtering', () => {
    render(<EcosystemDir />);
    fireEvent.click(screen.getByRole('tab', { name: /Filter by Education/i }));
    expect(screen.queryByText('Motoswap')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Filter by All/i }));
    expect(screen.getByText('Motoswap')).toBeTruthy();
  });
});
