// @ts-nocheck

import React, { createContext, useContext, useState, useCallback } from 'react';
import { translations } from '../i18n/translations';
import type { Lang, T } from '../i18n/translations';

const LANG_KEY = 'global-radio-lang';

function savedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'zh' || v === 'en') return v;
  } catch {}
  // Auto-detect: default to Chinese if browser language starts with 'zh'
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

interface LanguageCtx {
  lang: Lang;
  t: T;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageCtx>({
  lang:   'zh',
  t:      translations.zh,
  toggle: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(savedLang);

  const toggle = useCallback(() => {
    setLang(prev => {
      const next: Lang = prev === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem(LANG_KEY, next); } catch {}
      return next;
    });
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, t: translations[lang], toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}

