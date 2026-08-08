'use client';

import { createContext, useCallback, useContext, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType };

type Ctx = { showToast: (message: string, type?: ToastType) => void };

const ToastContext = createContext<Ctx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  function dismiss(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-sm">
        {toasts.map(toast => (
          <div
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            className={`card p-3 px-4 text-sm cursor-pointer animate-toast-in ${
              toast.type === 'error' ? 'border-mirch text-mirch' : toast.type === 'success' ? 'border-dhania text-dhania' : ''
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
