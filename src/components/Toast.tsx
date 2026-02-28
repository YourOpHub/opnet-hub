import React, { useState, useCallback, useEffect, createContext, useContext } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
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

  const toast = useCallback((message: string, type: ToastType = 'info', link?: { url: string; label: string }) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, message, type, link }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const colors: Record<ToastType, { bg: string; border: string; text: string }> = {
    success: { bg: 'rgba(16,185,129,.08)', border: 'rgba(16,185,129,.2)', text: '#10b981' },
    error: { bg: 'rgba(239,68,68,.08)', border: 'rgba(239,68,68,.2)', text: '#ef4444' },
    warning: { bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)', text: '#f59e0b' },
    info: { bg: 'rgba(59,130,246,.08)', border: 'rgba(59,130,246,.2)', text: '#3b82f6' },
  };

  const icons: Record<ToastType, string> = {
    success: '\u2713', error: '\u2717', warning: '!', info: 'i',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400,
        }}>
          {toasts.map(t => {
            const c = colors[t.type];
            return (
              <div key={t.id} style={{
                padding: '12px 16px', borderRadius: 12,
                background: c.bg, border: `1px solid ${c.border}`,
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'flex-start', gap: 10,
                animation: 'toastIn .3s ease-out',
                cursor: 'pointer',
                fontSize: '.78rem', fontFamily: 'var(--ff)',
              }} onClick={() => dismiss(t.id)}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: c.border, color: c.text,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '.65rem', fontWeight: 800, flexShrink: 0,
                }}>{icons[t.type]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--w)', lineHeight: 1.4 }}>{t.message}</div>
                  {t.link && (
                    <a href={t.link.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--ac)', fontSize: '.7rem', textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}
                      onClick={e => e.stopPropagation()}>
                      {t.link.label}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
