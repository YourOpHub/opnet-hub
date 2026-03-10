/**
 * CopyBtn.test.tsx -- Tests for src/components/tools/CopyBtn.tsx
 *
 * Covers: render, clipboard copy, visual feedback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CopyBtn from '../components/tools/CopyBtn';

describe('CopyBtn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with copy icon initially', () => {
    render(<CopyBtn text="hello" />);
    const btn = screen.getByRole('button', { name: 'Copy to clipboard' });
    expect(btn).toBeTruthy();
  });

  it('copies text on click and shows checkmark', () => {
    render(<CopyBtn text="test-value" />);
    const btn = screen.getByRole('button');

    act(() => {
      fireEvent.click(btn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test-value');
    // After click, aria-label changes to "Copied"
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('reverts to copy icon after 1500ms', () => {
    render(<CopyBtn text="revert-test" />);
    const btn = screen.getByRole('button');

    act(() => {
      fireEvent.click(btn);
    });

    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeTruthy();
  });
});
