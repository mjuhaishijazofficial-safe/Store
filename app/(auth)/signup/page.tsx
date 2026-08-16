'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useLang } from '@/lib/i18n-context';
import { StoreIcon, PersonIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, ArrowLeftIcon } from '@/components/icons';

// Same dark-gradient brand moment as /login (see the note there) — the
// two auth screens are one visual pair (a tab switch between them), so
// this mirrors login's structure field-for-field: same background, same
// top bar, same icon-prefixed input style, same button. Only the fields
// in the middle differ (shop name + full name, on top of email/password).
export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const { t, lang, setLang } = useLang();
  const [shopName, setShopName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      <main className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: 'linear-gradient(180deg, #0D1B12 0%, #152820 100%)' }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 mx-auto" style={{ background: '#E8A33D' }}>
            <MailIcon className="w-8 h-8 text-[#0D1B12]" />
          </div>
          <div className="font-display text-lg font-700 text-white mb-2">{t('auth.confirmEmailTitle')}</div>
          <div className="text-white/60 text-sm">{t('auth.confirmEmailBody')}</div>
        </div>
      </main>
    );
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

        {/* Login / Sign Up tabs — mirror of /login's own switcher, this
            page IS Sign Up so that side is highlighted here instead. */}
        <div className="flex rounded-xl bg-white/10 p-1 mb-6">
          <Link href="/login" className="flex-1 text-center py-2 rounded-lg text-white/70 text-sm">{t('auth.loginTitle')}</Link>
          <div className="flex-1 text-center py-2 rounded-lg bg-white text-[#0D1B12] font-700 text-sm">{t('auth.signupLink')}</div>
        </div>

        <form onSubmit={handleSignup}>
          {error && <div className="text-sm mb-4 bg-red-500/15 text-red-300 p-3 rounded-lg">{error}</div>}

          <label className="block text-xs text-white/60 mb-1">{t('auth.shopName')}</label>
          <div className="relative mb-4">
            <StoreIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Chachu Kiryana Store"
            />
          </div>

          <label className="block text-xs text-white/60 mb-1">{t('auth.yourName')}</label>
          <div className="relative mb-4">
            <PersonIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t('auth.yourName')}
            />
          </div>

          <label className="block text-xs text-white/60 mb-1">{t('auth.email')}</label>
          <div className="relative mb-4">
            <MailIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
            />
          </div>

          <label className="block text-xs text-white/60 mb-1">{t('auth.password')}</label>
          <div className="relative mb-6">
            <LockIcon className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className="w-full bg-white/10 border border-white/15 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]"
              type={showPassword ? 'text' : 'password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder={t('auth.passwordHint')}
            />
            <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
              {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>

          <button disabled={loading} className="w-full py-3.5 rounded-xl font-700 text-white disabled:opacity-50" style={{ background: '#0B5E56' }}>
            {loading ? t('auth.creating') : t('auth.createAccount')}
          </button>
        </form>

        <div className="text-center text-sm text-white/50 mt-5">
          {t('auth.haveAccount')} <Link href="/login" className="text-[#E8A33D] font-700">{t('auth.loginLink')}</Link>
        </div>
      </div>
    </main>
  );
}
