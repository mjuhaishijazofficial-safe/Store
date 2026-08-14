'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useLang } from '@/lib/i18n-context';
import { StoreIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, ArrowLeftIcon } from '@/components/icons';

// Figma match (Mobile UI brief) — auth screens (Login/Signup/Forgot
// Password) get a fixed dark look regardless of whatever theme/palette
// a returning user last picked for the in-app dashboard: nobody has
// chosen one yet at this point, and Figma's own splash/login screens
// are a deliberately distinct dark-green + amber brand moment, not the
// user-customizable Saffron/Teal/Sabz system. Hardcoded hex here, not
// the --color-* CSS variables the dashboard uses, so this stays
// visually locked to that brand moment either way.
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const { t, lang, setLang } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: 'linear-gradient(180deg, #0D1B12 0%, #152820 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-between items-center mb-8">
          <Link href="/" aria-label="Back" className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div className="flex text-xs rounded-full border border-white/15 overflow-hidden">
            <button onClick={() => setLang('ur')} className={`px-2.5 py-1 ${lang === 'ur' ? 'bg-[#E8A33D] text-[#0D1B12] font-700' : 'text-white/60'}`}>اردو</button>
            <button onClick={() => setLang('en')} className={`px-2.5 py-1 ${lang === 'en' ? 'bg-[#E8A33D] text-[#0D1B12] font-700' : 'text-white/60'}`}>EN</button>
          </div>
        </div>

        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3" style={{ background: '#E8A33D' }}>
            <StoreIcon className="w-8 h-8 text-[#0D1B12]" />
          </div>
          <div className="font-display text-lg font-700 text-white text-center">Dukaan ERP — Kiryana Management</div>
        </div>

        {/* Login / Sign Up tabs — this page IS Login, tapping Sign Up
            navigates to /signup rather than swapping form fields in
            place, since they're genuinely different forms/flows. */}
        <div className="flex rounded-xl bg-white/10 p-1 mb-6">
          <div className="flex-1 text-center py-2 rounded-lg bg-white text-[#0D1B12] font-700 text-sm">{t('auth.loginTitle')}</div>
          <Link href="/signup" className="flex-1 text-center py-2 rounded-lg text-white/70 text-sm">{t('auth.signupLink')}</Link>
        </div>

        <form onSubmit={handleLogin}>
          {error && <div className="text-sm mb-4 bg-red-500/15 text-red-300 p-3 rounded-lg">{error}</div>}

          <label className="block text-xs text-white/60 mb-1">{t('auth.email')}</label>
          <div className="relative mb-4">
            <MailIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>

          <label className="block text-xs text-white/60 mb-1">{t('auth.password')}</label>
          <div className="relative mb-2">
            <LockIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
            />
            <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
              {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-right mb-5">
            <Link href="/forgot-password" className="text-xs text-white/50 hover:text-white">{t('auth.forgotPassword')}</Link>
          </div>

          <button disabled={loading} className="w-full py-3.5 rounded-xl font-700 text-white disabled:opacity-50" style={{ background: '#0B5E56' }}>
            {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
          </button>
        </form>

        <div className="text-center text-sm text-white/50 mt-5">
          {t('auth.noAccount')} <Link href="/signup" className="text-[#E8A33D] font-700">{t('auth.signupLink')}</Link>
        </div>
      </div>
    </main>
  );
}
