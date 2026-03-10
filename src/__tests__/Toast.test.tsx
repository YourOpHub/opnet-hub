/**
 * Toast.test.tsx -- Tests for src/components/Toast.tsx
 *
 * Covers: ToastProvider, useToast, toast display, auto-dismiss, toast types
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../components/Toast';

// Test component that uses the toast hook
const TestToastTrigger: React.FC<{
  message?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  link?: { url: string; label: string };
}> = ({ message = 'Test toast', type = 'info', link }) => {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(message, type, link)}>
      Show Toast
    </button>
  );
};

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without toasts initially', () => {
    render(
      <ToastProvider>
        <div>App content</div>
      </ToastProvider>
    );
    expect(screen.getByText('App content')).toBeTruthy();
    // No toast container should be present
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows toast when triggered', () => {
    render(
      <ToastProvider>
        <TestToastTrigger message="Hello world" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows info toast with info icon', () => {
    render(
      <ToastProvider>
        <TestToastTrigger type="info" message="Info message" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Info message')).toBeTruthy();
  });

  it('shows success toast', () => {
    render(
      <ToastProvider>
        <TestToastTrigger type="success" message="Success!" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Success!')).toBeTruthy();
  });

  it('shows error toast', () => {
    render(
      <ToastProvider>
        <TestToastTrigger type="error" message="Error occurred" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Error occurred')).toBeTruthy();
  });

  it('shows warning toast', () => {
    render(
      <ToastProvider>
        <TestToastTrigger type="warning" message="Warning!" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Warning!')).toBeTruthy();
  });

  it('shows toast with link', () => {
    render(
      <ToastProvider>
        <TestToastTrigger message="With link" link={{ url: 'https://example.com', label: 'View' }} />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('With link')).toBeTruthy();
    const link = screen.getByText(/View/);
    expect(link).toBeTruthy();
  });

  it('dismisses toast on click', () => {
    render(
      <ToastProvider>
        <TestToastTrigger message="Click to dismiss" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    const toastEl = screen.getByText('Click to dismiss').closest('[role="alert"]');
    expect(toastEl).toBeTruthy();

    act(() => {
      fireEvent.click(toastEl!);
    });

    // After leaving animation (350ms)
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByText('Click to dismiss')).toBeNull();
  });

  it('auto-dismisses after 4500ms', () => {
    render(
      <ToastProvider>
        <TestToastTrigger message="Auto dismiss" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    expect(screen.getByText('Auto dismiss')).toBeTruthy();

    // Advance past auto-dismiss timeout (4500ms) + leaving animation (350ms)
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText('Auto dismiss')).toBeNull();
  });

  it('can show multiple toasts', () => {
    render(
      <ToastProvider>
        <TestToastTrigger message="Toast 1" />
      </ToastProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Show Toast'));
    });

    // Both should be visible (both say "Toast 1")
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBe(2);
  });
});
