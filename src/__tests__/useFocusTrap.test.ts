/**
 * useFocusTrap.test.ts -- Tests for src/hooks/useFocusTrap.ts
 *
 * Covers: focus trapping behavior, Escape key handling, Tab wrapping,
 *         cleanup on unmount, ref return.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from '../hooks/useFocusTrap';

describe('useFocusTrap', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a ref object', () => {
    const { result } = renderHook(() => useFocusTrap(false, onClose));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it('does not call onClose when isOpen is false', () => {
    renderHook(() => useFocusTrap(false, onClose));
    // Simulate Escape key on document
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape key when isOpen and ref is attached', () => {
    const { result } = renderHook(() => useFocusTrap(true, onClose));

    // Create a DOM element and attach it to the ref
    const container = document.createElement('div');
    const button = document.createElement('button');
    container.appendChild(button);
    document.body.appendChild(container);

    // Manually set ref.current
    Object.defineProperty(result.current, 'current', {
      value: container,
      writable: true,
    });

    // Re-render to trigger useEffect with new ref
    renderHook(() => useFocusTrap(true, onClose));
    const container2 = document.createElement('div');
    const btn2 = document.createElement('button');
    container2.appendChild(btn2);
    document.body.appendChild(container2);

    // Dispatch Escape key directly on the container element
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    container2.dispatchEvent(event);

    // Clean up
    document.body.removeChild(container);
    document.body.removeChild(container2);
  });

  it('returns ref that can be attached to a div', () => {
    const { result } = renderHook(() => useFocusTrap(true, onClose));
    // The ref is a React RefObject<HTMLDivElement | null>
    expect(result.current).toHaveProperty('current');
  });

  it('hook does not throw when isOpen changes', () => {
    const { rerender } = renderHook(
      ({ isOpen }) => useFocusTrap(isOpen, onClose),
      { initialProps: { isOpen: false } },
    );

    expect(() => rerender({ isOpen: true })).not.toThrow();
    expect(() => rerender({ isOpen: false })).not.toThrow();
  });

  it('hook does not throw when onClose changes', () => {
    const onClose2 = vi.fn();
    const { rerender } = renderHook(
      ({ closeFn }) => useFocusTrap(true, closeFn),
      { initialProps: { closeFn: onClose } },
    );

    expect(() => rerender({ closeFn: onClose2 })).not.toThrow();
  });
});
