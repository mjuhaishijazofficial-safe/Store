'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import LanguageToggle from '@/components/LanguageToggle';
import ThemeToggle from '@/components/ThemeToggle';
import PaletteToggle from '@/components/PaletteToggle';
import { useLang } from '@/lib/i18n-context';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="card w-full max-w-sm p-7">
        <div className="flex justify-end gap-2 mb-3">
          <ThemeToggle />
          <PaletteToggle />
          <LanguageToggle />
        </div>
        <div className="font-display text-2xl font-700 text-haldi mb-6">{t('auth.loginTitle')}</div>

        {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}

        <label className="block text-xs text-chalkdim mb-1">{t('auth.email')}</label>
        <input className="input mb-4" type="email" required value={email} onChange={e => setEmail(e.target.value)} />

        <label className="block text-xs text-chalkdim mb-1">{t('auth.password')}</label>
        <input className="input mb-2" type="password" required value={password} onChange={e => setPassword(e.target.value)} />

        <div className="text-right mb-4">
          <Link href="/forgot-password" className="text-xs text-chalkdim hover:text-haldi">{t('auth.forgotPassword')}</Link>
        </div>

        <button disabled={loading} className="btn-primary w-full mb-4">
          {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
        </button>

        <div className="text-center text-sm text-chalkdim">
          {t('auth.noAccount')} <Link href="/signup" className="text-haldi font-700">{t('auth.signupLink')}</Link>
        </div>
        <div className="text-center text-[11px] text-chalkdim mt-1">{t('auth.signupSub')}</div>
      </form>
    </main>
  );
}
