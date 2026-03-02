import React, { useState, useCallback, createContext, useContext } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  leaving?: boolean;
  link?: { url: string; label: string };
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, link?: { url: string; label: string }) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 350);
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info', link?: { url: string; label: string }) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, message, type, link }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const icons: Record<ToastType, string> = {
    success: '\u2713', error: '\u2717', warning: '!', info: 'i',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id}
              className={`toast toast-${t.type}${t.leaving ? ' leaving' : ''}`}
              onClick={() => dismiss(t.id)}
              style={{ cursor: 'pointer' }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'currentColor', color: 'var(--bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.65rem', fontWeight: 800, flexShrink: 0,
                opacity: .9,
              }}>{icons[t.type]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--w)', lineHeight: 1.4 }}>{t.message}</div>
                {t.link && (
                  <a href={t.link.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', fontSize: '.68rem', marginTop: 4, display: 'inline-block' }}
                    onClick={e => e.stopPropagation()}>
                    {t.link.label} ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export default ToastProvider;
