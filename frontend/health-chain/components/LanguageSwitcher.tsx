'use client';

import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useEffect, useState } from 'react';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('common');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const switchLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('i18nextLng', lng);
  };

  if (!mounted) return null;

  return (
    <div 
      className="flex items-center gap-2"
      role="group"
      aria-label={t('language')}
    >
      <Globe className="w-4 h-4 text-gray-600" aria-hidden="true" />
      
      <button
        onClick={() => switchLanguage('en')}
        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
          i18n.language === 'en'
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
        }`}
        aria-current={i18n.language === 'en' ? 'page' : undefined}
        aria-label={t('english')}
        title={t('english')}
      >
        {t('english')}
      </button>
      
      <button
        onClick={() => switchLanguage('fr')}
        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
          i18n.language === 'fr'
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
        }`}
        aria-current={i18n.language === 'fr' ? 'page' : undefined}
        aria-label={t('french')}
        title={t('french')}
      >
        {t('french')}
      </button>
    </div>
  );
}
