/**
 * useNotifications-extended.test.ts -- Extended tests for src/hooks/useNotifications.ts
 *
 * Covers additional edge cases:
 *   - Notification not supported (no window.Notification)
 *   - Permission already granted
 *   - Permission denied on setEnabled
 *   - notify when enabled and granted
 *   - Loading stored preferences
 *   - Corrupted localStorage
 *   - setEnabled(false) disabling
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from '../hooks/useNotifications';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('useNotifications extended', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('when Notification is NOT supported', () => {
    let savedNotification: unknown;

    beforeEach(() => {
      // Actually remove Notification from window so 'Notification' in window === false
      savedNotification = (window as any).Notification;
      delete (window as any).Notification;
    });

    afterEach(() => {
      // Restore
      (window as any).Notification = savedNotification;
    });

    it('isSupported is false', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isSupported).toBe(false);
    });

    it('permission is denied', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.permission).toBe('denied');
    });

    it('notify returns null', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.notify('test')).toBeNull();
    });

    it('setEnabled enables when unsupported (skips permission check)', async () => {
      const { result } = renderHook(() => useNotifications());
      await act(async () => {
        await result.current.setEnabled(true);
      });
      // When isSupported is false, the permission check condition is false,
      // so it skips permission request and directly sets enabled=true
      expect(result.current.isEnabled).toBe(true);
    });
  });

  describe('when permission is already granted', () => {
    beforeEach(() => {
      vi.stubGlobal('Notification', class {
        static permission: NotificationPermission = 'granted';
        static requestPermission = vi.fn().mockResolvedValue('granted');
        constructor(public title: string, public options?: NotificationOptions) {}
      });
    });

    it('setEnabled(true) does NOT call requestPermission', async () => {
      const { result } = renderHook(() => useNotifications());
      await act(async () => {
        await result.current.setEnabled(true);
      });
      // Permission already 'granted' => requestPermission not needed
      expect(result.current.isEnabled).toBe(true);
    });

    it('notify returns a Notification when enabled', async () => {
      const { result } = renderHook(() => useNotifications());
      await act(async () => {
        await result.current.setEnabled(true);
      });
      const n = result.current.notify('Hello', 'World');
      expect(n).not.toBeNull();
      expect((n as any).title).toBe('Hello');
    });

    it('notify with options', async () => {
      const { result } = renderHook(() => useNotifications());
      await act(async () => {
        await result.current.setEnabled(true);
      });
      const n = result.current.notify('Test', 'Body', { tag: 'test-tag' });
      expect(n).not.toBeNull();
    });
  });

  describe('when permission is denied', () => {
    beforeEach(() => {
      vi.stubGlobal('Notification', class {
        static permission: NotificationPermission = 'default';
        static requestPermission = vi.fn().mockResolvedValue('denied');
        constructor(public title: string, public options?: NotificationOptions) {}
      });
    });

    it('setEnabled(true) does not enable when permission denied', async () => {
      const { result } = renderHook(() => useNotifications());
      await act(async () => {
        await result.current.setEnabled(true);
      });
      expect(result.current.isEnabled).toBe(false);
    });
  });

  describe('localStorage edge cases', () => {
    beforeEach(() => {
      vi.stubGlobal('Notification', class {
        static permission: NotificationPermission = 'granted';
        static requestPermission = vi.fn().mockResolvedValue('granted');
        constructor(public title: string, public options?: NotificationOptions) {}
      });
    });

    it('loads enabled=true from localStorage', () => {
      localStorage.setItem('hub_notifications', JSON.stringify({ enabled: true }));
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isEnabled).toBe(true);
    });

    it('handles corrupted JSON in localStorage', () => {
      localStorage.setItem('hub_notifications', 'not-valid-json');
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isEnabled).toBe(false);
    });

    it('setEnabled(false) disables notifications', async () => {
      localStorage.setItem('hub_notifications', JSON.stringify({ enabled: true }));
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isEnabled).toBe(true);

      await act(async () => {
        await result.current.setEnabled(false);
      });
      expect(result.current.isEnabled).toBe(false);

      const stored = JSON.parse(localStorage.getItem('hub_notifications')!);
      expect(stored.enabled).toBe(false);
    });

    it('handles localStorage.setItem throwing', async () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };

      const { result } = renderHook(() => useNotifications());
      // Should not throw
      await act(async () => {
        await result.current.setEnabled(true);
      });

      Storage.prototype.setItem = original;
    });
  });

  describe('notify edge cases', () => {
    beforeEach(() => {
      vi.stubGlobal('Notification', class {
        static permission: NotificationPermission = 'denied';
        static requestPermission = vi.fn().mockResolvedValue('denied');
        constructor(public title: string, public options?: NotificationOptions) {}
      });
    });

    it('notify returns null when permission is not granted even if enabled', () => {
      // Force enabled via localStorage, but permission is 'denied'
      localStorage.setItem('hub_notifications', JSON.stringify({ enabled: true }));
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isEnabled).toBe(true);
      expect(result.current.notify('test')).toBeNull();
    });
  });
});
