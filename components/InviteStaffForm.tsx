'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';

export default function InviteStaffForm() {
  const { t } = useLang();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);

  async function invite() {
    if (!email.trim()) return;
    setLoading(true);
    setMsg('');
    const res = await fetch('/api/staff/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() })
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setIsError(true);
      setMsg(data.error === 'email_taken' ? t('staff.emailTaken') : (data.error || t('common.error')));
      return;
    }

    setIsError(false);
    setEmail('');
    setMsg(t('staff.invited'));
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="font-display text-lg text-haldi font-700 mb-3">{t('staff.inviteTitle')}</div>
      <label className="block text-xs text-chalkdim mb-1">{t('staff.email')}</label>
      <input className="input mb-3" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="staff@example.com" />
      <button onClick={invite} disabled={loading} className="btn-primary w-full">
        {loading ? t('staff.inviting') : t('staff.inviteBtn')}
      </button>
      {msg && <div className={`text-sm mt-3 ${isError ? 'text-mirch' : 'text-dhania'}`}>{msg}</div>}
    </div>
  );
}
