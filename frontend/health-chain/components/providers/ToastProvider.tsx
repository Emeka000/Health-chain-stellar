/**
 * Toast Provider - Global toast notification system
 * Handles session expiry notifications
 */

'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Toast } from '../ui/Toast';
import { useToast } from '../../lib/hooks/useToast';
import { useTranslations } from 'next-intl';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Toasts');
  const { toasts, hideToast, error } = useToast();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Check for session expiry reason in URL
    const reason = searchParams.get('reason');
    
    if (reason === 'session_expired') {
      error(t('sessionExpired'));
      
      // Clean up URL
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('reason');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [searchParams, error, t]);

  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </div>
    </>
  );
}
