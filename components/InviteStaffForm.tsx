'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';

export default function InviteStaffForm() {
  const { t } = useLang();
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'cashier' | 'manager'>('cashier');
  const [loading, setLoading] = useState(false);
  // email_taken gets a full explanatory paragraph, not a flash-and-gone
  // message — worth keeping visible inline rather than an auto-dismissing
  // toast. Every other outcome (success, generic failure) is transient
  // action feedback and fits the toast pattern used everywhere else.
  const [emailTakenMsg, setEmailTakenMsg] = useState('');

  async function invite() {
    if (!email.trim()) return;
    setLoading(true);
    setEmailTakenMsg('');
    const res = await fetch('/api/staff/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role })
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      if (data.error === 'email_taken') {
        setEmailTakenMsg(t('staff.emailTaken'));
      } else {
        showToast(data.error || t('common.error'), 'error');
      }
      return;
    }

    setEmail('');
    showToast(t('staff.invited'), 'success');
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="font-display text-lg text-haldi font-700 mb-3">{t('staff.inviteTitle')}</div>
      <label className="block text-xs text-chalkdim mb-1">{t('staff.email')}</label>
      <input className="input mb-3" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="staff@example.com" />
      <label className="block text-xs text-chalkdim mb-1">{t('staff.role')}</label>
      <select className="input mb-3" value={role} onChange={e => setRole(e.target.value as 'cashier' | 'manager')}>
        <option value="cashier">{t('staff.roleCashier')}</option>
        <option value="manager">{t('staff.roleManager')}</option>
      </select>
      <button onClick={invite} disabled={loading} className="btn-primary w-full">
        {loading ? t('staff.inviting') : t('staff.inviteBtn')}
      </button>
      {emailTakenMsg && <div className="text-mirch text-sm mt-3">{emailTakenMsg}</div>}
    </div>
  );
}
