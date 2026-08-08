'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';
import { isAppLockEnabled, isValidPinFormat, enableAppLock, disableAppLock, verifyPin, lockNow } from '@/lib/app-lock';

type FormMode = 'idle' | 'setup' | 'verifyForChange' | 'changeTo' | 'verifyForDisable';

export default function AppLockSettings() {
  const { t } = useLang();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<FormMode>('idle');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reads localStorage, so this only settles after mount.
  useEffect(() => { setEnabled(isAppLockEnabled()); }, []);

  function reset() {
    setMode('idle');
    setPin('');
    setConfirmPin('');
    setError('');
  }

  async function submitSetup() {
    if (!isValidPinFormat(pin)) { setError(t('settings.pinFormatHint')); return; }
    if (pin !== confirmPin) { setError(t('settings.pinMismatch')); return; }
    setBusy(true);
    await enableAppLock(pin);
    setBusy(false);
    setEnabled(true);
    reset();
    showToast(t('settings.appLockEnabled'), 'success');
  }

  async function submitVerify(next: 'changeTo' | 'disable') {
    setBusy(true);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (!ok) { setError(t('settings.pinWrong')); setPin(''); return; }
    if (next === 'disable') {
      disableAppLock();
      setEnabled(false);
      reset();
      showToast(t('settings.appLockDisabled'), 'success');
    } else {
      setPin('');
      setConfirmPin('');
      setError('');
      setMode('changeTo');
    }
  }

  async function submitChangeTo() {
    if (!isValidPinFormat(pin)) { setError(t('settings.pinFormatHint')); return; }
    if (pin !== confirmPin) { setError(t('settings.pinMismatch')); return; }
    setBusy(true);
    await enableAppLock(pin);
    setBusy(false);
    reset();
    showToast(t('settings.appLockEnabled'), 'success');
  }

  function lockNowAndReload() {
    lockNow();
    // AppLockGate only re-checks on mount/activity/visibility — a full
    // reload is the simplest reliable way to hand control straight to
    // the lock screen from here.
    window.location.reload();
  }

  const pinInputClass = `input text-center text-xl tracking-[0.4em] ${error ? 'border-mirch' : ''}`;

  return (
    <div className="mt-10 pt-6 border-t border-chalk/10">
      <div className="text-xs text-chalkdim uppercase tracking-wide font-700 mb-1">{t('settings.appLock')}</div>
      <div className="text-chalkdim text-xs mb-3">{t('settings.appLockHint')}</div>

      {mode === 'idle' && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-600">
              {enabled ? t('settings.appLockOn') : t('settings.appLockOff')}
            </div>
            {enabled ? (
              <div className="flex gap-2">
                <button onClick={() => setMode('verifyForChange')} className="text-xs text-haldi font-700 border border-haldi/40 rounded-lg px-3 py-1.5">
                  {t('settings.changePin')}
                </button>
                <button onClick={() => setMode('verifyForDisable')} className="text-xs text-mirch font-700 border border-mirch/40 rounded-lg px-3 py-1.5">
                  {t('settings.turnOff')}
                </button>
              </div>
            ) : (
              <button onClick={() => setMode('setup')} className="text-xs text-haldi font-700 border border-haldi/40 rounded-lg px-3 py-1.5">
                {t('settings.turnOn')}
              </button>
            )}
          </div>
          {enabled && (
            <button onClick={lockNowAndReload} className="text-chalkdim text-xs mt-3 underline">
              {t('settings.lockNow')}
            </button>
          )}
        </div>
      )}

      {mode === 'setup' && (
        <div className="card p-4">
          <label className="block text-xs text-chalkdim mb-1">{t('settings.newPin')}</label>
          <input type="password" inputMode="numeric" maxLength={6} className={`${pinInputClass} mb-3`} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
          <label className="block text-xs text-chalkdim mb-1">{t('settings.confirmPin')}</label>
          <input type="password" inputMode="numeric" maxLength={6} className={`${pinInputClass} mb-2`} value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
          {error && <div className="text-mirch text-xs mb-3">{error}</div>}
          {!error && <div className="text-chalkdim text-xs mb-3">{t('settings.pinFormatHint')}</div>}
          <div className="flex gap-2">
            <button onClick={reset} disabled={busy} className="btn-secondary flex-1">{t('contact.cancel')}</button>
            <button onClick={submitSetup} disabled={busy} className="btn-primary flex-1">{busy ? t('settings.saving') : t('contact.save')}</button>
          </div>
        </div>
      )}

      {(mode === 'verifyForChange' || mode === 'verifyForDisable') && (
        <div className="card p-4">
          <label className="block text-xs text-chalkdim mb-1">{t('settings.currentPin')}</label>
          <input
            type="password" inputMode="numeric" autoFocus maxLength={6}
            className={`${pinInputClass} mb-2`}
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && pin.length >= 4) submitVerify(mode === 'verifyForDisable' ? 'disable' : 'changeTo'); }}
          />
          {error && <div className="text-mirch text-xs mb-3">{error}</div>}
          <div className="flex gap-2">
            <button onClick={reset} disabled={busy} className="btn-secondary flex-1">{t('contact.cancel')}</button>
            <button
              onClick={() => submitVerify(mode === 'verifyForDisable' ? 'disable' : 'changeTo')}
              disabled={busy || pin.length < 4}
              className={mode === 'verifyForDisable' ? 'flex-1 rounded-lg font-700 text-white bg-mirch disabled:opacity-40 px-4 py-2.5' : 'btn-primary flex-1'}
            >
              {busy ? t('settings.saving') : t('settings.continue')}
            </button>
          </div>
        </div>
      )}

      {mode === 'changeTo' && (
        <div className="card p-4">
          <label className="block text-xs text-chalkdim mb-1">{t('settings.newPin')}</label>
          <input type="password" inputMode="numeric" autoFocus maxLength={6} className={`${pinInputClass} mb-3`} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
          <label className="block text-xs text-chalkdim mb-1">{t('settings.confirmPin')}</label>
          <input type="password" inputMode="numeric" maxLength={6} className={`${pinInputClass} mb-2`} value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
          {error && <div className="text-mirch text-xs mb-3">{error}</div>}
          <div className="flex gap-2">
            <button onClick={reset} disabled={busy} className="btn-secondary flex-1">{t('contact.cancel')}</button>
            <button onClick={submitChangeTo} disabled={busy} className="btn-primary flex-1">{busy ? t('settings.saving') : t('contact.save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
