'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import LanguageToggle from '@/components/LanguageToggle';
import { useLang } from '@/lib/i18n-context';

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();
  const [ready, setReady] = useState(false);
  const [validLink, setValidLink] = useState(true);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // The recovery link's token exchange happens client-side via
    // @supabase/ssr's browser client (detectSessionInUrl). Give it a
    // moment, then check whether a session actually came out of it —
    // an expired or already-used link lands here with no session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setValidLink(true);
        setReady(true);
      }
    });

    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setValidLink(!!session);
      setReady(true);
    }, 1500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: err } = await supabase.auth.updateUser({ password });

    setLoading(false);
    if (err) { setError(err.message); return; }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="flex justify-end mb-3">
          <LanguageToggle />
        </div>
        <div className="font-display text-2xl font-700 text-haldi mb-6">{t('auth.newPasswordTitle')}</div>

        {!ready && <div className="text-chalkdim text-sm">{t('common.loading')}</div>}

        {ready && !validLink && (
          <div className="text-mirch text-sm bg-mirch/10 p-3 rounded-lg">{t('auth.resetInvalidLink')}</div>
        )}

        {ready && validLink && (
          <form onSubmit={handleSubmit}>
            {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}
            <label className="block text-xs text-chalkdim mb-1">{t('auth.newPassword')}</label>
            <input className="input mb-6" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder={t('auth.passwordHint')} />
            <button disabled={loading} className="btn-primary w-full">
              {loading ? t('auth.settingPassword') : t('auth.setPassword')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
