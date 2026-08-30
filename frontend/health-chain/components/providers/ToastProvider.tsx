/**
 * Toast Provider - Global toast notification system
 * Handles session expiry notifications
 */

'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Toast } from '../ui/Toast';
import { ToastContext, useToastState } from '../../lib/hooks/useToast';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toastState = useToastState();
  const { toasts, hideToast, error } = toastState;
  const searchParams = useSearchParams();

  useEffect(() => {
    // Check for session expiry reason in URL
    const reason = searchParams.get('reason');

    if (reason === 'session_expired') {
      error('Your session has expired. Please sign in again.');

      // Clean up URL
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('reason');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [searchParams, error]);

  return (
    <ToastContext.Provider value={toastState}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
