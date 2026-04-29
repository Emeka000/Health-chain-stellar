'use client';

import { useTranslation } from 'react-i18next';
import { isRTL } from '@/lib/i18n';

/**
 * Provides locale-aware formatting for dates, numbers, units, and RTL direction.
 * All formatters respect the active i18n language automatically.
 */
export function useLocaleFormat() {
  const { i18n } = useTranslation();
  const locale = i18n.language ?? 'en';
  const dir = isRTL(locale) ? 'rtl' : 'ltr';

  function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  function formatDateShort(value: string | Date): string {
    return formatDate(value, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(value: string | Date): string {
    return formatDate(value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(locale, options).format(value);
  }

  function formatTemperature(celsius: number): string {
    return `${formatNumber(celsius, { maximumFractionDigits: 1 })} °C`;
  }

  function formatVolume(ml: number): string {
    return `${formatNumber(ml)} mL`;
  }

  return { locale, dir, formatDate, formatDateShort, formatDateTime, formatNumber, formatTemperature, formatVolume };
}
