'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';

type Reconciliation = {
  id: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  expected_change: number;
  actual_balance: number;
  note: string | null;
  created_at: string;
};

// A reconciliation is "balanced" if the owner's real statement landed
// within a rupee of what the app's bank-tagged entries predicted —
// exact-equality would flag every reconciliation as off over a rounding
// difference that means nothing.
const BALANCE_TOLERANCE = 1;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// A date input is day-precision but the ledger's created_at is a
// timestamptz — treat the chosen day as "through the end of that day"
// so a reconciliation dated today includes everything logged today.
function endOfDayIso(dateStr: string) {
  return new Date(dateStr + 'T23:59:59.999').toISOString();
}

export default function BankReconciliationPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, role } = useShop();
  const { showToast } = useToast();
  const isOwner = role === 'owner';

  const [history, setHistory] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(todayStr());
  const [expectedChange, setExpectedChange] = useState<number | null>(null);
  const [loadingExpected, setLoadingExpected] = useState(false);
  const [actualBalance, setActualBalance] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (isOwner) loadHistory(); }, [isOwner]);

  async function loadHistory() {
    setLoading(true);
    const { data } = await supabase.from('bank_reconciliations').select('*').order('period_end', { ascending: false });
    setHistory(data || []);
    setLoading(false);
  }

  const lastRecon = history[0] || null;
  const openingBalance = lastRecon?.actual_balance || 0;
  // First-ever reconciliation covers every bank-tagged entry that ever
  // existed; every later one picks up right where the last one left off
  // — no gap, no double-counting a payment across two periods.
  const periodStartIso = lastRecon?.period_end || new Date(0).toISOString();

  async function loadExpected(endDateStr: string) {
    setLoadingExpected(true);
    const { data, error: err } = await supabase.rpc('bank_expected_change', {
      p_shop_id: shopId,
      p_since: periodStartIso,
      p_until: endOfDayIso(endDateStr)
    });
    setLoadingExpected(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setExpectedChange((data as number) || 0);
  }

  function openForm() {
    const d = todayStr();
    setPeriodEnd(d);
    setActualBalance('');
    setNote('');
    setExpectedChange(null);
    setFormOpen(true);
    loadExpected(d);
  }

  const expectedClosing = openingBalance + (expectedChange || 0);
  const actualNum = Number(actualBalance) || 0;
  const difference = actualBalance ? actualNum - expectedClosing : null;

  async function save() {
    if (!shopId || actualBalance === '' || expectedChange === null) return;
    setSaving(true);
    const { error: err } = await supabase.from('bank_reconciliations').insert({
      shop_id: shopId,
      period_start: periodStartIso,
      period_end: endOfDayIso(periodEnd),
      opening_balance: openingBalance,
      expected_change: expectedChange,
      actual_balance: actualNum,
      note: note.trim() || null
    });
    setSaving(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setFormOpen(false);
    showToast(t('bankRecon.saved'), 'success');
    await loadHistory();
  }

  if (!isOwner) {
    return <div className="text-chalkdim text-sm py-10 text-center">{t('staff.ownerOnly')}</div>;
  }

  return (
    <div className="max-w-md">
      <h1 className="font-display text-xl font-700 mb-1">{t('bankRecon.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{t('bankRecon.subtitle')}</p>

      {!formOpen && (
        <button onClick={openForm} className="btn-primary w-full mb-5">{t('bankRecon.newReconciliation')}</button>
      )}

      {formOpen && (
        <div className="card p-5 mb-5">
          <label className="block text-xs text-chalkdim mb-1">{t('bankRecon.periodEnd')}</label>
          <input
            type="date"
            className="input mb-3"
            value={periodEnd}
            max={todayStr()}
            onChange={e => { setPeriodEnd(e.target.value); loadExpected(e.target.value); }}
          />

          <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
            <div>
              <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('bankRecon.openingBalance')}</div>
              <div className="font-mono font-700">{fmt(openingBalance)}</div>
            </div>
            <div>
              <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('bankRecon.expectedChange')}</div>
              <div className="font-mono font-700">{loadingExpected ? '…' : fmt(expectedChange || 0)}</div>
            </div>
          </div>

          <div className="card p-3 bg-board3 mb-4">
            <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('bankRecon.expectedClosing')}</div>
            <div className="font-mono font-700 text-lg">{loadingExpected ? '…' : fmt(expectedClosing)}</div>
          </div>

          <label className="block text-xs text-chalkdim mb-1">{t('bankRecon.actualBalance')}</label>
          <input type="number" inputMode="decimal" className="input mb-1" value={actualBalance} onChange={e => setActualBalance(e.target.value)} placeholder={t('bankRecon.actualBalanceHint')} />

          {difference !== null && (
            <div className={`text-sm font-700 mt-2 mb-3 ${Math.abs(difference) <= BALANCE_TOLERANCE ? 'text-dhania' : 'text-mirch'}`}>
              {Math.abs(difference) <= BALANCE_TOLERANCE
                ? t('bankRecon.balanced')
                : `${t('bankRecon.difference')}: ${difference > 0 ? '+' : ''}${fmt(difference)}`}
            </div>
          )}

          <label className="block text-xs text-chalkdim mb-1 mt-2">{t('khataDetail.noteOptional')}</label>
          <input className="input mb-5" value={note} onChange={e => setNote(e.target.value)} placeholder={t('bankRecon.noteHint')} />

          <div className="flex gap-2">
            <button onClick={() => setFormOpen(false)} className="btn-secondary flex-1">{t('contact.cancel')}</button>
            <button onClick={save} disabled={saving || actualBalance === '' || loadingExpected} className="btn-primary flex-1">
              {saving ? t('settings.saving') : t('contact.save')}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      {!loading && history.length === 0 && !formOpen && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('bankRecon.empty')}</div>
      )}

      {history.length > 0 && (
        <>
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-2">{t('bankRecon.history')}</div>
          <div className="space-y-2">
            {history.map(r => {
              const closing = r.opening_balance + r.expected_change;
              const diff = r.actual_balance - closing;
              const balanced = Math.abs(diff) <= BALANCE_TOLERANCE;
              return (
                <div key={r.id} className={`card p-4 ${balanced ? '' : 'border-mirch'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-sm font-600">
                      {new Date(r.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' → '}
                      {new Date(r.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                    <div className={`text-xs font-700 ${balanced ? 'text-dhania' : 'text-mirch'}`}>
                      {balanced ? t('bankRecon.balanced') : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-chalkdim">
                    <div>{t('bankRecon.openingBalance')}<div className="font-mono text-sm text-chalk">{fmt(r.opening_balance)}</div></div>
                    <div>{t('bankRecon.expectedClosing')}<div className="font-mono text-sm text-chalk">{fmt(closing)}</div></div>
                    <div>{t('bankRecon.actualBalance')}<div className="font-mono text-sm text-chalk">{fmt(r.actual_balance)}</div></div>
                  </div>
                  {r.note && <div className="text-xs text-chalkdim mt-2">{r.note}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
