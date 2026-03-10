/**
 * RouteErrorBoundary.test.tsx -- Tests for src/components/RouteErrorBoundary.tsx
 *
 * Covers: normal render, error caught, routeName display, reset behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import RouteErrorBoundary from '../components/RouteErrorBoundary';

const ThrowingChild = ({ shouldThrow }: { shouldThrow?: boolean }) => {
  if (shouldThrow) throw new Error('Route error');
  return <div>Route content</div>;
};

/** Wrapper that controls shouldThrow via state so reset works */
const ResettableWrapper = ({ routeName, onResetCb }: { routeName?: string; onResetCb?: () => void }) => {
  const [doThrow, setDoThrow] = useState(true);
  return (
    <RouteErrorBoundary routeName={routeName} onReset={() => { setDoThrow(false); onResetCb?.(); }}>
      <ThrowingChild shouldThrow={doThrow} />
    </RouteErrorBoundary>
  );
};

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <RouteErrorBoundary routeName="Dashboard">
        <div>Dashboard content</div>
      </RouteErrorBoundary>
    );
    expect(screen.getByText('Dashboard content')).toBeTruthy();
  });

  it('shows error UI with route name when child throws', () => {
    render(
      <RouteErrorBoundary routeName="Swap">
        <ThrowingChild shouldThrow />
      </RouteErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Route error')).toBeTruthy();
    expect(screen.getByText('Swap')).toBeTruthy();
  });

  it('shows "in" route name indicator', () => {
    render(
      <RouteErrorBoundary routeName="Portfolio">
        <ThrowingChild shouldThrow />
      </RouteErrorBoundary>
    );
    const routeDiv = screen.getByText('Portfolio');
    expect(routeDiv.closest('.reb-route')).toBeTruthy();
  });

  it('shows error UI without route name when routeName not provided', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow />
      </RouteErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // No route name element should be present
    expect(screen.queryByText('in')).toBeNull();
  });

  it('has role="alert" on error display', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow />
      </RouteErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('resets on "Try Again" click', () => {
    const onResetCb = vi.fn();
    render(<ResettableWrapper routeName="Test" onResetCb={onResetCb} />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    fireEvent.click(screen.getByText('Try Again'));
    expect(onResetCb).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Route content')).toBeTruthy();
  });

  it('shows generic message when error has no message', () => {
    const BrokenChild = () => { throw Object.create(null); };
    render(
      <RouteErrorBoundary>
        <BrokenChild />
      </RouteErrorBoundary>
    );
    expect(screen.getByText('An unexpected error occurred in this section.')).toBeTruthy();
  });
});
