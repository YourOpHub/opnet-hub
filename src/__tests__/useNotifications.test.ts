import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from '../hooks/useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
    // Mock Notification API
    vi.stubGlobal('Notification', class {
      static permission: NotificationPermission = 'default';
      static requestPermission = vi.fn().mockResolvedValue('granted');
      constructor(public title: string, public options?: NotificationOptions) {}
    });
  });

  it('starts disabled', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isSupported).toBe(true);
  });

  it('setEnabled(true) requests permission', async () => {
    const { result } = renderHook(() => useNotifications());
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(result.current.isEnabled).toBe(true);
  });

  it('notify returns null when disabled', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notify('test')).toBeNull();
  });

  it('persists preference to localStorage', async () => {
    const { result } = renderHook(() => useNotifications());
    await act(async () => {
      await result.current.setEnabled(true);
    });
    const stored = JSON.parse(localStorage.getItem('hub_notifications') || '{}');
    expect(stored.enabled).toBe(true);
  });
});
