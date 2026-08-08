'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n-context';
import { isAppLockEnabled, isCurrentlyUnlocked, verifyPin, markUnlocked, touchActivity } from '@/lib/app-lock';

// Wraps the dashboard's page content only — header/nav stay visible so
// sign-out and theme/language toggles work even while locked. See
// lib/app-lock.ts for what this is and isn't defending against.
export default function AppLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  // 'checking' renders nothing so a locked device never flashes real
  // data before the effect below has a chance to run.
  const [status, setStatus] = useState<'checking' | 'locked' | 'open'>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(isAppLockEnabled() && !isCurrentlyUnlocked() ? 'locked' : 'open');
  }, []);

  useEffect(() => {
    if (status !== 'open' || !isAppLockEnabled()) return;

    const onActivity = () => touchActivity();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !isCurrentlyUnlocked()) setStatus('locked');
    };
    // A periodic check catches the idle timeout even if the tab is left
    // open and visible with no interaction at all.
    const interval = window.setInterval(() => {
      if (!isCurrentlyUnlocked()) setStatus('locked');
    }, 15_000);

    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach(ev => window.addEventListener(ev, onActivity));
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      events.forEach(ev => window.removeEventListener(ev, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [status]);

  async function unlock() {
    setBusy(true);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (!ok) {
      setError(true);
      setPin('');
      return;
    }
    markUnlocked();
    setError(false);
    setPin('');
    setStatus('open');
  }

  if (status === 'checking') return null;

  if (status === 'locked') {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-4">
        <div className="text-4xl mb-3">🔒</div>
        <div className="font-display text-lg font-700 mb-1">{t('applock.title')}</div>
        <p className="text-chalkdim text-sm mb-6">{t('applock.subtitle')}</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          className={`input text-center text-2xl tracking-[0.5em] w-48 ${error ? 'border-mirch' : ''}`}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(false); }}
          onKeyDown={e => { if (e.key === 'Enter' && pin.length >= 4) unlock(); }}
        />
        {error && <div className="text-mirch text-xs mt-2">{t('applock.wrong')}</div>}
        <button onClick={unlock} disabled={pin.length < 4 || busy} className="btn-primary mt-5 w-48">
          {busy ? t('common.loading') : t('applock.unlock')}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
