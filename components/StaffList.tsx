'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';
import { hasSection, ALL_SECTIONS, Section } from '@/lib/permissions';

type StaffRow = { id: string; full_name: string | null; email: string | null; role: string; allowed_sections?: string[] | null };

const AVATAR_COLORS = ['#0B5E56', '#B8791A', '#7A2E1D', '#1E7A4C', '#8A6747'];
function avatarColor(id: string) {
  return AVATAR_COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}
// Figma match — 4 permission pills per staff card. Billing/Settings
// aren't real per-staff toggles in this app's model (Billing is
// unrestricted for every role, Settings is owner-only, never staff) —
// shown here as a section a Manager/Cashier can genuinely be
// restricted on instead, via the same hasSection() check the nav uses.
const PILL_SECTIONS: Section[] = ['inventory', 'khata', 'suppliers', 'reports'];

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
        {staff.map(s => {
          // Owner rows aren't linked — attendance/salary tracking is a
          // staff concept, an owner doesn't clock in against themselves,
          // and (same reasoning as the missing remove button) Settings >
          // Delete Account is the deliberate path for anything owner-level.
          const allowedSections = s.allowed_sections ?? null;
          const body = (
            <>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-700 shrink-0" style={{ background: avatarColor(s.id) }}>{initials(s.full_name || s.email || '?')}</span>
                  <div className="min-w-0">
                    <div className="font-600 text-sm truncate">{s.full_name || s.email || '—'}{s.role === 'owner' ? ` (${t('staff.you')})` : ''}</div>
                    {s.full_name && <div className="text-xs text-chalkdim truncate">{s.email}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-[10px] px-2 py-0.5 rounded-full bg-board3 text-chalkdim uppercase">
                    {s.role === 'owner' ? t('staff.roleOwner') : s.role === 'manager' ? t('staff.roleManager') : t('staff.roleCashier')}
                  </div>
                  {s.role !== 'owner' && (
                    <button onClick={e => { e.preventDefault(); setConfirming(s); }} className="text-chalkdim text-xs hover:text-mirch">✕</button>
                  )}
                </div>
              </div>
              {s.role !== 'owner' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {ALL_SECTIONS.filter(s2 => PILL_SECTIONS.includes(s2.key)).map(({ key, labelKey }) => {
                    const allowed = hasSection(s.role as 'manager' | 'cashier', allowedSections, key);
                    return (
                      <div key={key} className={`text-[9px] text-center py-1 rounded border truncate ${allowed ? 'border-dhania/40 text-dhania' : 'border-chalk/15 text-chalkdim'}`}>
                        {allowed ? '✓' : '✕'} {t(labelKey)}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );

          return s.role !== 'owner' ? (
            <Link key={s.id} href={`/dashboard/staff/${s.id}`} className="card p-3 px-4 block">
              {body}
            </Link>
          ) : (
            <div key={s.id} className="card p-3 px-4">
              {body}
            </div>
          );
        })}
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
