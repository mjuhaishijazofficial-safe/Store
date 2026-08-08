'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { startOfTodayPKT, startOfMonthPKT } from '@/lib/pkt-time';
import { ALL_SECTIONS, Section } from '@/lib/permissions';
import ConfirmDeleteButton from '@/components/ConfirmDeleteButton';

type StaffProfile = { id: string; full_name: string | null; email: string | null; role: string; monthly_salary: number; allowed_sections: string[] | null };
type AttendanceRow = { id: string; date: string; status: 'present' | 'absent' | 'half_day' | 'leave' };
type Status = AttendanceRow['status'];
type AdjustmentType = 'bonus' | 'overtime' | 'deduction';
type Adjustment = { id: string; type: AdjustmentType; amount: number; note: string | null; created_at: string };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

const todayStr = startOfTodayPKT().toISOString().slice(0, 10);

export default function StaffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const staffId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, role: myRole } = useShop();
  const { showToast } = useToast();

  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [salaryInput, setSalaryInput] = useState('');
  const [savingSalary, setSavingSalary] = useState(false);
  const [markingStatus, setMarkingStatus] = useState<Status | null>(null);
  // null = unrestricted (owner sees every section). A selected set means
  // "only these" — mirrors the allowed_sections column semantics exactly,
  // see lib/permissions.ts.
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjForm, setAdjForm] = useState<{ type: AdjustmentType; amount: string; note: string }>({ type: 'bonus', amount: '', note: '' });
  const [savingAdj, setSavingAdj] = useState(false);

  const isOwner = myRole === 'owner';

  const statusLabels: Record<Status, string> = {
    present: t('attendance.present'),
    absent: t('attendance.absent'),
    half_day: t('attendance.halfDay'),
    leave: t('attendance.leave')
  };
  const statusColors: Record<Status, string> = {
    present: 'text-dhania',
    absent: 'text-mirch',
    half_day: 'text-haldi',
    leave: 'text-chalkdim'
  };
  const adjTypeLabels: Record<AdjustmentType, string> = {
    bonus: t('staffDetail.bonus'),
    overtime: t('staffDetail.overtime'),
    deduction: t('staffDetail.deduction')
  };

  useEffect(() => { if (isOwner) loadAll(); }, [staffId, isOwner]);

  async function loadAll() {
    setLoading(true);
    const [{ data: prof }, { data: att }, { data: adj }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, monthly_salary, allowed_sections').eq('id', staffId).single(),
      supabase
        .from('staff_attendance')
        .select('id, date, status')
        .eq('staff_id', staffId)
        .gte('date', startOfMonthPKT().toISOString().slice(0, 10))
        .order('date', { ascending: false }),
      supabase
        .from('salary_adjustments')
        .select('id, type, amount, note, created_at')
        .eq('staff_id', staffId)
        .gte('created_at', startOfMonthPKT().toISOString())
        .order('created_at', { ascending: false })
    ]);
    setStaff(prof || null);
    setSalaryInput(prof ? String(prof.monthly_salary || 0) : '');
    setAllowedSections(prof ? (prof.allowed_sections as string[] | null) : null);
    setAttendance(att || []);
    setAdjustments(adj || []);
    setLoading(false);
  }

  async function saveSalary() {
    const value = Number(salaryInput);
    if (isNaN(value) || value < 0) return;
    setSavingSalary(true);
    const res = await fetch('/api/staff/set-salary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, monthlySalary: value })
    });
    setSavingSalary(false);
    if (!res.ok) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
  }

  function toggleSection(section: Section) {
    setAllowedSections(prev => {
      // Starting from "unrestricted" (null) and unchecking one box means
      // "everything except this" — materialize the full list minus the
      // toggled key rather than trying to represent that as null.
      const base = prev === null ? ALL_SECTIONS.map(s => s.key) : prev;
      return base.includes(section) ? base.filter(s => s !== section) : [...base, section];
    });
  }

  async function savePermissions() {
    setSavingPerms(true);
    const res = await fetch('/api/staff/set-permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, allowedSections })
    });
    setSavingPerms(false);
    if (!res.ok) { showToast(t('common.error'), 'error'); return; }
    showToast(t('staffDetail.permissionsSaved'), 'success');
  }

  async function addAdjustment() {
    const amount = Number(adjForm.amount);
    if (!amount || amount <= 0 || !shopId) return;
    setSavingAdj(true);
    const { error: err } = await supabase.from('salary_adjustments').insert({
      shop_id: shopId,
      staff_id: staffId,
      type: adjForm.type,
      amount,
      note: adjForm.note.trim() || null
    });
    setSavingAdj(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setAdjForm({ type: 'bonus', amount: '', note: '' });
    await loadAll();
  }

  // Ledger-style entry, same convention as expenses/khata/supplier
  // entries — delete + re-add, no in-place edit.
  async function removeAdjustment(id: string) {
    const { error: err } = await supabase.from('salary_adjustments').delete().eq('id', id);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
  }

  async function markToday(status: Status) {
    setMarkingStatus(status);
    const { error: err } = await supabase
      .from('staff_attendance')
      .upsert({ shop_id: shopId, staff_id: staffId, date: todayStr, status }, { onConflict: 'staff_id,date' });
    setMarkingStatus(null);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('attendance.marked'), 'success');
    await loadAll();
  }

  async function markDate(date: string, status: Status) {
    const { error: err } = await supabase
      .from('staff_attendance')
      .upsert({ shop_id: shopId, staff_id: staffId, date, status }, { onConflict: 'staff_id,date' });
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
  }

  if (!isOwner) {
    return <div className="text-chalkdim text-sm py-10 text-center">{t('staff.ownerOnly')}</div>;
  }
  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>;
  if (!staff) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.notFound')}</div>;

  const counts = attendance.reduce(
    (acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; },
    {} as Record<Status, number>
  );
  const todayEntry = attendance.find(a => a.date === todayStr);

  // Additive to monthly_salary only — deliberately not folding attendance
  // in (see the comment on salary_adjustments in schema.sql).
  const bonusTotal = adjustments.filter(a => a.type === 'bonus').reduce((s, a) => s + a.amount, 0);
  const overtimeTotal = adjustments.filter(a => a.type === 'overtime').reduce((s, a) => s + a.amount, 0);
  const deductionTotal = adjustments.filter(a => a.type === 'deduction').reduce((s, a) => s + a.amount, 0);
  const netPay = (staff.monthly_salary || 0) + bonusTotal + overtimeTotal - deductionTotal;

  return (
    <div className="max-w-sm">
      <Link href="/dashboard/staff" className="text-xs text-chalkdim hover:text-haldi">{t('staffDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="font-display text-lg font-700">{staff.full_name || staff.email}</div>
        <div className="text-xs text-chalkdim mb-4">{staff.email}</div>

        <label className="block text-xs text-chalkdim mb-1">{t('staffDetail.monthlySalary')}</label>
        <div className="flex gap-2">
          <input type="number" inputMode="decimal" className="input flex-1" value={salaryInput} onChange={e => setSalaryInput(e.target.value)} />
          <button onClick={saveSalary} disabled={savingSalary} className="btn-primary whitespace-nowrap">
            {savingSalary ? t('settings.saving') : t('contact.save')}
          </button>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('staffDetail.netPayThisMonth')}</div>
        <div className="font-mono font-800 text-2xl text-dhania mb-3">{fmt(netPay)}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-chalkdim mb-4">
          <div className="flex justify-between"><span>{t('staffDetail.baseSalary')}</span><span className="font-mono">{fmt(staff.monthly_salary || 0)}</span></div>
          <div className="flex justify-between"><span>{t('staffDetail.overtime')}</span><span className="font-mono text-dhania">+{fmt(overtimeTotal)}</span></div>
          <div className="flex justify-between"><span>{t('staffDetail.bonus')}</span><span className="font-mono text-dhania">+{fmt(bonusTotal)}</span></div>
          <div className="flex justify-between"><span>{t('staffDetail.deduction')}</span><span className="font-mono text-mirch">−{fmt(deductionTotal)}</span></div>
        </div>

        {adjustments.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {adjustments.map(a => (
              <div key={a.id} className="flex justify-between items-center text-xs">
                <div>
                  <span className={a.type === 'deduction' ? 'text-mirch' : 'text-dhania'}>{adjTypeLabels[a.type]}</span>
                  {a.note && <span className="text-chalkdim"> — {a.note}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{a.type === 'deduction' ? '−' : '+'}{fmt(a.amount)}</span>
                  <ConfirmDeleteButton onConfirm={() => removeAdjustment(a.id)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-2">
          <select className="input py-1.5 text-sm col-span-1" value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value as AdjustmentType })}>
            <option value="bonus">{adjTypeLabels.bonus}</option>
            <option value="overtime">{adjTypeLabels.overtime}</option>
            <option value="deduction">{adjTypeLabels.deduction}</option>
          </select>
          <input type="number" inputMode="decimal" className="input py-1.5 text-sm col-span-2" placeholder={t('staffDetail.adjustmentAmount')} value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} />
        </div>
        <input className="input py-1.5 text-sm mb-2" placeholder={t('khataDetail.noteOptional')} value={adjForm.note} onChange={e => setAdjForm({ ...adjForm, note: e.target.value })} />
        <button onClick={addAdjustment} disabled={savingAdj || !adjForm.amount} className="btn-secondary w-full text-sm">
          {savingAdj ? t('settings.saving') : t('staffDetail.addAdjustment')}
        </button>
      </div>

      <div className="card p-5 mb-4">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('staffDetail.permissions')}</div>
        <p className="text-[11px] text-chalkdim mb-3">{t('staffDetail.permissionsHint')}</p>

        <label className="flex items-center gap-2 text-sm mb-3 pb-3 border-b border-chalk/10">
          <input
            type="checkbox"
            checked={allowedSections === null}
            onChange={e => setAllowedSections(e.target.checked ? null : [])}
          />
          <span className="font-600">{t('staffDetail.allSections')}</span>
        </label>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {ALL_SECTIONS.map(s => (
            <label key={s.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowedSections === null || allowedSections.includes(s.key)}
                onChange={() => toggleSection(s.key)}
              />
              <span>{t(s.labelKey)}</span>
            </label>
          ))}
        </div>

        <button onClick={savePermissions} disabled={savingPerms} className="btn-primary w-full">
          {savingPerms ? t('settings.saving') : t('contact.save')}
        </button>
      </div>

      <div className="card p-5 mb-4">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-3">{t('attendance.markToday')}</div>
        <div className="grid grid-cols-2 gap-2">
          {(['present', 'absent', 'half_day', 'leave'] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => markToday(s)}
              disabled={markingStatus !== null}
              className={`text-sm py-2 rounded-lg border ${
                todayEntry?.status === s ? `${statusColors[s]} border-current font-700` : 'border-chalk/15 text-chalkdim'
              }`}
            >
              {statusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-chalkdim uppercase tracking-wide mb-2">{t('attendance.thisMonth')}</div>
      <div className="grid grid-cols-4 gap-2 mb-5">
        <div className="card p-3 text-center">
          <div className="font-mono font-700 text-dhania">{counts.present || 0}</div>
          <div className="text-[10px] text-chalkdim mt-0.5">{t('attendance.present')}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="font-mono font-700 text-mirch">{counts.absent || 0}</div>
          <div className="text-[10px] text-chalkdim mt-0.5">{t('attendance.absent')}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="font-mono font-700 text-haldi">{counts.half_day || 0}</div>
          <div className="text-[10px] text-chalkdim mt-0.5">{t('attendance.halfDay')}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="font-mono font-700 text-chalkdim">{counts.leave || 0}</div>
          <div className="text-[10px] text-chalkdim mt-0.5">{t('attendance.leave')}</div>
        </div>
      </div>

      {attendance.length === 0 ? (
        <div className="text-center py-10 text-chalkdim text-sm">{t('attendance.empty')}</div>
      ) : (
        <div className="card divide-y divide-chalk/10">
          {attendance.map(a => (
            <div key={a.id} className="p-3 px-4 flex justify-between items-center">
              <div className="text-sm">{new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', weekday: 'short' })}</div>
              <select
                className="text-xs bg-transparent border border-chalk/15 rounded-lg px-2 py-1"
                value={a.status}
                onChange={e => markDate(a.date, e.target.value as Status)}
              >
                <option value="present">{statusLabels.present}</option>
                <option value="absent">{statusLabels.absent}</option>
                <option value="half_day">{statusLabels.half_day}</option>
                <option value="leave">{statusLabels.leave}</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
