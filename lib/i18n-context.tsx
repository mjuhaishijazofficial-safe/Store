'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_LANG, DictKey, Lang, LANG_COOKIE, translate } from './i18n';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: DictKey) => string };

const LangContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children, initialLang }: { children: React.ReactNode; initialLang: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang || DEFAULT_LANG);
  const router = useRouter();

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000`;
    router.refresh();
  }, [router]);

  const t = useCallback((key: DictKey) => translate(key, lang), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}
