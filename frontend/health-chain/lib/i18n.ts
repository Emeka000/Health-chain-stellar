import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import commonEN from '../public/locales/en/common.json';
import commonFR from '../public/locales/fr/common.json';
import formsEN from '../public/locales/en/forms.json';
import formsFR from '../public/locales/fr/forms.json';
import ordersEN from '../public/locales/en/orders.json';
import ordersFR from '../public/locales/fr/orders.json';
import dispatchEN from '../public/locales/en/dispatch.json';
import dispatchFR from '../public/locales/fr/dispatch.json';
import verificationEN from '../public/locales/en/verification.json';
import verificationFR from '../public/locales/fr/verification.json';
import errorsEN from '../public/locales/en/errors.json';
import errorsFR from '../public/locales/fr/errors.json';
import medicalEN from '../public/locales/en/medical.json';
import medicalFR from '../public/locales/fr/medical.json';
import emergencyEN from '../public/locales/en/emergency.json';
import emergencyFR from '../public/locales/fr/emergency.json';

export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locales that require RTL layout */
export const RTL_LOCALES: SupportedLocale[] = [];

export function isRTL(locale: string): boolean {
  return RTL_LOCALES.includes(locale as SupportedLocale);
}

const ALL_NAMESPACES = [
  'common',
  'forms',
  'orders',
  'dispatch',
  'verification',
  'errors',
  'medical',
  'emergency',
] as const;

export type I18nNamespace = (typeof ALL_NAMESPACES)[number];

const resources = {
  en: {
    common: commonEN,
    forms: formsEN,
    orders: ordersEN,
    dispatch: dispatchEN,
    verification: verificationEN,
    errors: errorsEN,
    medical: medicalEN,
    emergency: emergencyEN,
  },
  fr: {
    common: commonFR,
    forms: formsFR,
    orders: ordersFR,
    dispatch: dispatchFR,
    verification: verificationFR,
    errors: errorsFR,
    medical: medicalFR,
    emergency: emergencyFR,
  },
};

/** Emits a console warning for every missing translation key in non-production. */
function missingKeyHandler(
  locales: readonly string[],
  ns: string,
  key: string,
  fallbackValue: string,
) {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(
    `[i18n] Missing translation — locale: "${locales.join(', ')}" | ns: "${ns}" | key: "${key}" | fallback: "${fallbackValue}"`,
  );
}

const sharedConfig = {
  resources,
  fallbackLng: 'en' as SupportedLocale,
  defaultNS: 'common' as I18nNamespace,
  ns: ALL_NAMESPACES,
  interpolation: { escapeValue: false },
  saveMissing: process.env.NODE_ENV !== 'production',
  missingKeyHandler,
  returnNull: false,
  returnEmptyString: false,
};

if (typeof window !== 'undefined') {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      ...sharedConfig,
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    });
} else {
  i18n.use(initReactI18next).init({
    ...sharedConfig,
    lng: 'en',
  });
}

export default i18n;
