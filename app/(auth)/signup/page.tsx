'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import LanguageToggle from '@/components/LanguageToggle';
import ThemeToggle from '@/components/ThemeToggle';
import { useLang } from '@/lib/i18n-context';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const { t } = useLang();
  const [shopName, setShopName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { shop_name: shopName || 'Meri Dukaan', full_name: fullName }
      }
    });

    setLoading(false);

    if (signErr) {
      setError(signErr.message);
      return;
    }

    // If the Supabase project has email confirmation turned on, signUp()
    // succeeds but returns no session yet — redirecting to /dashboard here
    // used to just bounce straight back to /login with no explanation.
    if (!data.session) {
      setNeedsConfirmation(true);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  if (needsConfirmation) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card w-full max-w-sm p-7 text-center">
          <div className="font-display text-2xl font-700 text-haldi mb-3">{t('auth.confirmEmailTitle')}</div>
          <div className="text-chalkdim text-sm">{t('auth.confirmEmailBody')}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSignup} className="card w-full max-w-sm p-7">
        <div className="flex justify-end gap-2 mb-3">
          <ThemeToggle />
          <LanguageToggle />
        </div>
        <div className="font-display text-2xl font-700 text-haldi mb-1">{t('auth.signupTitle')}</div>
        <div className="text-chalkdim text-sm mb-6">{t('auth.signupSub')}</div>

        {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}

        <label className="block text-xs text-chalkdim mb-1">{t('auth.shopName')}</label>
        <input className="input mb-4" value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Chachu Kiryana Store" />

        <label className="block text-xs text-chalkdim mb-1">{t('auth.yourName')}</label>
        <input className="input mb-4" value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t('auth.yourName')} />

        <label className="block text-xs text-chalkdim mb-1">{t('auth.email')}</label>
        <input className="input mb-4" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />

        <label className="block text-xs text-chalkdim mb-1">{t('auth.password')}</label>
        <input className="input mb-6" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder={t('auth.passwordHint')} />

        <button disabled={loading} className="btn-primary w-full mb-4">
          {loading ? t('auth.creating') : t('auth.createAccount')}
        </button>

        <div className="text-center text-sm text-chalkdim">
          {t('auth.haveAccount')} <Link href="/login" className="text-haldi">{t('auth.loginLink')}</Link>
        </div>
      </form>
    </main>
  );
}
