/**
 * Shared toast context — single queue written by all callers, rendered once by ToastProvider.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { ToastType } from '../../components/ui/Toast';

interface ToastState {
  message: string;
  type: ToastType;
  id: number;
}

export interface ToastContextValue {
  toasts: ToastState[];
  showToast: (message: string, type?: ToastType) => void;
  hideToast: (id: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** Called once by ToastProvider to own the shared toast state. */
export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { message, type, id }]);
  }, []);

  const hideToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string) => showToast(message, 'success'), [showToast]);
  const error = useCallback((message: string) => showToast(message, 'error'), [showToast]);
  const warning = useCallback((message: string) => showToast(message, 'warning'), [showToast]);
  const info = useCallback((message: string) => showToast(message, 'info'), [showToast]);

  return { toasts, showToast, hideToast, success, error, warning, info };
}

/** Consume the shared toast queue. Must be called within a ToastProvider. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
