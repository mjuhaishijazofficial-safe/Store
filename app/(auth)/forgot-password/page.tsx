'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import LanguageToggle from '@/components/LanguageToggle';
import { useLang } from '@/lib/i18n-context';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`
    });

    setLoading(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="flex justify-end mb-3">
          <LanguageToggle />
        </div>
        <div className="font-display text-2xl font-700 text-haldi mb-1">{t('auth.forgotTitle')}</div>
        <div className="text-chalkdim text-sm mb-6">{t('auth.forgotBody')}</div>

        {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}

        {sent ? (
          <div className="text-dhania text-sm mb-4 bg-dhania/10 p-3 rounded-lg">{t('auth.resetLinkSent')}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="block text-xs text-chalkdim mb-1">{t('auth.email')}</label>
            <input className="input mb-6" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
            <button disabled={loading} className="btn-primary w-full mb-4">
              {loading ? t('auth.sending') : t('auth.sendResetLink')}
            </button>
          </form>
        )}

        <div className="text-center text-sm text-chalkdim">
          <Link href="/login" className="text-haldi">{t('auth.backToLogin')}</Link>
        </div>
      </div>
    </main>
  );
}
