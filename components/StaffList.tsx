'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';

type StaffRow = { id: string; full_name: string | null; email: string | null; role: string };

export default function StaffList({ staff }: { staff: StaffRow[] }) {
  const { t } = useLang();
  const router = useRouter();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState<StaffRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirming) return;
    setBusy(true);
    const res = await fetch('/api/staff/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId: confirming.id })
    });
    setBusy(false);
    if (!res.ok) { showToast(t('common.error'), 'error'); return; }
    setConfirming(null);
    showToast(t('staff.removed'), 'success');
    router.refresh();
  }

  return (
    <>
      <div className="space-y-2 mb-6">
        {staff.map(s => (
          <div key={s.id} className="card p-3 px-4 flex justify-between items-center">
            <div>
              <div className="font-600 text-sm">{s.full_name || s.email || '—'}</div>
              {s.full_name && <div className="text-xs text-chalkdim">{s.email}</div>}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs px-2 py-1 rounded-full bg-board3 text-chalkdim">
                {s.role === 'owner' ? t('staff.roleOwner') : t('staff.roleStaff')}
              </div>
              {/* Owner row has no remove — that's what Settings > Delete
                  Account is for, a deliberate whole-shop action, not a
                  click on a list row. */}
              {s.role === 'staff' && (
                <button onClick={() => setConfirming(s)} className="text-chalkdim text-xs hover:text-mirch">✕</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => !busy && setConfirming(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-mirch font-700 mb-2">{t('staff.removeTitle')}</div>
            <p className="text-sm mb-5">
              <strong>{confirming.full_name || confirming.email}</strong> {t('staff.removeBody')}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(null)} disabled={busy} className="btn-secondary flex-1">{t('contact.cancel')}</button>
              <button onClick={remove} disabled={busy} className="flex-1 rounded-lg font-700 text-white bg-mirch disabled:opacity-40 px-4 py-2.5">
                {busy ? t('contact.deleting') : t('staff.removeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
