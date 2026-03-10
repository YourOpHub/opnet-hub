/**
 * ErrorBoundary.test.tsx -- Tests for src/components/ErrorBoundary.tsx
 *
 * Covers: normal render, error caught, reset behavior, error message display
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import ErrorBoundary from '../components/ErrorBoundary';

const ThrowingChild = ({ shouldThrow }: { shouldThrow?: boolean }) => {
  if (shouldThrow) throw new Error('Test error message');
  return <div>Normal content</div>;
};

/** Wrapper that controls shouldThrow via state so rerender after reset works */
const ResettableWrapper = ({ onResetCb }: { onResetCb?: () => void }) => {
  const [doThrow, setDoThrow] = useState(true);
  return (
    <ErrorBoundary onReset={() => { setDoThrow(false); onResetCb?.(); }}>
      <ThrowingChild shouldThrow={doThrow} />
    </ErrorBoundary>
  );
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Suppress React error logging in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Test error message')).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('has role="alert" on error display', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('resets on "Try Again" click', () => {
    const onResetCb = vi.fn();
    render(<ResettableWrapper onResetCb={onResetCb} />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Click try again — onReset sets doThrow=false, boundary resets hasError
    fireEvent.click(screen.getByText('Try Again'));
    expect(onResetCb).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Normal content')).toBeTruthy();
  });

  it('shows generic message when error has no message', () => {
    const BrokenChild = () => { throw Object.create(null); };
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('An unexpected error occurred in this module.')).toBeTruthy();
  });
});
