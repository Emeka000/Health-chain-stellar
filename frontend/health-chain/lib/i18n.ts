import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

// Import translation resources directly
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

const resources = {
  en: {
    common: commonEN,
    forms: formsEN,
    orders: ordersEN,
    dispatch: dispatchEN,
    verification: verificationEN,
    errors: errorsEN,
  },
  fr: {
    common: commonFR,
    forms: formsFR,
    orders: ordersFR,
    dispatch: dispatchFR,
    verification: verificationFR,
    errors: errorsFR,
  },
};

if (typeof window !== 'undefined') {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common', 'forms', 'orders', 'dispatch', 'verification', 'errors'],
      interpolation: {
        escapeValue: false,
      },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    });
} else {
  // Server-side initialization
  i18n.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'forms', 'orders', 'dispatch', 'verification', 'errors'],
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
