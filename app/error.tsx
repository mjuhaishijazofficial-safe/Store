'use client';

import { useEffect } from 'react';
import { useLang } from '@/lib/i18n-context';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLang();

  useEffect(() => {
    // Best-effort client-side log — no error tracking service wired up
    // yet, but at least this shows up in the browser console instead of
    // vanishing silently behind the fallback UI.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <div className="font-display text-5xl font-800 text-mirch mb-4">⚠</div>
        <h1 className="font-display text-2xl font-700 mb-2">{t('errorPage.title')}</h1>
        <p className="text-chalkdim text-sm max-w-sm mx-auto mb-8">{t('errorPage.body')}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="btn-primary">{t('errorPage.retry')}</button>
          <a href="/" className="btn-secondary">{t('errorPage.home')}</a>
        </div>
      </div>
    </main>
  );
}
