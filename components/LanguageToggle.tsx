'use client';

import { useLang } from '@/lib/i18n-context';

export default function LanguageToggle() {
  const { lang, setLang } = useLang();

  return (
    <div className="flex text-xs rounded-full border border-chalk/10 overflow-hidden shrink-0">
      <button
        onClick={() => setLang('ur')}
        className={`px-2.5 py-1 ${lang === 'ur' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        اردو
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1 ${lang === 'en' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        EN
      </button>
    </div>
  );
}
