import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'hub_notifications';

interface NotificationPreferences {
    enabled: boolean;
}

function loadPreferences(): NotificationPreferences {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as NotificationPreferences;
        }
    } catch {
        // Corrupted storage — fall back to defaults
    }
    return { enabled: false };
}

function savePreferences(prefs: NotificationPreferences): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Storage full or unavailable — silently ignore
    }
}

export function useNotifications() {
    const isSupported = typeof window !== 'undefined' && 'Notification' in window;

    const [enabled, setEnabledState] = useState<boolean>(() => loadPreferences().enabled);
    const [permission, setPermission] = useState<NotificationPermission>(
        isSupported ? Notification.permission : 'denied',
    );

    // Sync permission state when it may change externally
    useEffect(() => {
        if (!isSupported) return;
        setPermission(Notification.permission);
    }, [isSupported]);

    const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
        if (!isSupported) return 'denied';
        if (Notification.permission === 'granted') return 'granted';

        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
    }, [isSupported]);

    const setEnabled = useCallback(
        async (value: boolean) => {
            if (value && isSupported && Notification.permission !== 'granted') {
                const result = await requestPermission();
                if (result !== 'granted') {
                    // Permission denied — don't enable
                    return;
                }
            }

            setEnabledState(value);
            savePreferences({ enabled: value });
        },
        [isSupported, requestPermission],
    );

    const notify = useCallback(
        (title: string, body?: string, options?: NotificationOptions) => {
            if (!isSupported || !enabled) return null;
            if (Notification.permission !== 'granted') return null;

            return new Notification(title, { body, ...options });
        },
        [isSupported, enabled],
    );

    return {
        notify,
        setEnabled,
        isEnabled: enabled,
        isSupported,
        permission,
    };
}
