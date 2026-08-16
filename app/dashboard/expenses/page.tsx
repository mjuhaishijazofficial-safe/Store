'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { startOfMonthPKT } from '@/lib/pkt-time';
import ConfirmDeleteButton from '@/components/ConfirmDeleteButton';
import { useSectionGuard } from '@/lib/use-section-guard';

type Category = 'rent' | 'salary' | 'utility' | 'marketing' | 'other';

type Expense = {
  id: string;
  category: Category;
  amount: number;
  note: string | null;
  created_at: string;
};

const PAGE_SIZE = 50;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function ExpensesPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId } = useShop();
  const { showToast } = useToast();
  useSectionGuard('expenses');

  const categoryLabels: Record<Category, string> = {
    rent: t('expenses.catRent'),
    salary: t('expenses.catSalary'),
    utility: t('expenses.catUtility'),
    marketing: t('expenses.catMarketing'),
    other: t('expenses.catOther')
  };

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<{ category: Category; amount: string; note: string; paymentMethod: 'cash' | 'bank' | 'easypaisa' | 'jazzcash' }>({ category: 'rent', amount: '', note: '', paymentMethod: 'cash' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { init(); }, [shopId]);

  async function init() {
    setLoading(true);
    await Promise.all([loadExpenses(true), loadMonthTotal()]);
    setLoading(false);
  }

  async function loadMonthTotal() {
    // expenses_sum is a real SQL function, not a client-side
    // `.select('amount.sum()')` call — see schema.sql for why that
    // pattern silently reads as ₨0 on failure elsewhere in this app.
    const { data, error: err } = await supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: startOfMonthPKT().toISOString() });
    if (!err) setMonthTotal(data || 0);
  }

  async function loadExpenses(reset: boolean) {
    const offset = reset ? 0 : expenses.length;
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const rows = data || [];
    setExpenses(reset ? rows : prev => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
  }

  async function loadMore() {
    setLoadingMore(true);
    await loadExpenses(false);
    setLoadingMore(false);
  }

  function openAdd() {
    setForm({ category: 'rent', amount: '', note: '', paymentMethod: 'cash' });
    setModalOpen(true);
  }

  async function save() {
    // saving guards against a double-tap firing two inserts for the same
    // expense — same fix as Khata/Supplier saveEntry, same reasoning:
    // this feeds Reports' Net Profit, not just a display list.
    const amount = Number(form.amount);
    if (!amount || amount <= 0 || !shopId || saving) return;
    setSaving(true);
    const { error: err } = await supabase.from('expenses').insert({
      shop_id: shopId,
      category: form.category,
      amount,
      note: form.note.trim() || null,
      payment_method: form.paymentMethod
    });
    setSaving(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    showToast(t('settings.saved'), 'success');
    await init();
  }

  // Ledger-style entry, same convention as khata/supplier entries and
  // transactions elsewhere in the app — delete + re-add, no in-place
  // edit. Editable "contact" records (customer/supplier/item) are the
  // exception, not the rule.
  async function remove(id: string) {
    const { error: err } = await supabase.from('expenses').delete().eq('id', id);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await init();
  }

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">{t('expenses.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{t('expenses.subtitle')}</p>

      <div className="card p-5 mb-5">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('expenses.thisMonth')}</div>
        <div className="font-mono font-800 text-3xl text-mirch">{fmt(monthTotal)}</div>
      </div>

      <button onClick={openAdd} className="btn-primary w-full mb-5">{t('expenses.add')}</button>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      {!loading && expenses.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('expenses.empty')}</div>
      )}

      <div className="space-y-2">
        {expenses.map(e => {
          const d = new Date(e.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return (
            <div key={e.id} className="card p-3 px-4 flex justify-between items-center">
              <div>
                <div className="font-600 text-sm">{categoryLabels[e.category]}</div>
                <div className="text-xs text-chalkdim mt-0.5">{when}{e.note ? ` • ${e.note}` : ''}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="font-mono font-700 text-sm text-mirch">{fmt(e.amount)}</div>
                <ConfirmDeleteButton onConfirm={() => remove(e.id)} />
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('common.loading') : t('common.loadMore')}
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('expenses.addTitle')}</div>

            <label className="block text-xs text-chalkdim mb-1">{t('expenses.category')}</label>
            <select className="input mb-3" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })}>
              <option value="rent">{categoryLabels.rent}</option>
              <option value="salary">{categoryLabels.salary}</option>
              <option value="utility">{categoryLabels.utility}</option>
              <option value="marketing">{categoryLabels.marketing}</option>
              <option value="other">{categoryLabels.other}</option>
            </select>

            <label className="block text-xs text-chalkdim mb-1">{t('expenses.amount')}</label>
            <input type="number" inputMode="decimal" className="input mb-3" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />

            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.paymentMethod')}</label>
            <select className="input mb-3" value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value as typeof form.paymentMethod })}>
              <option value="cash">{t('paymentMethod.cash')}</option>
              <option value="bank">{t('paymentMethod.bank')}</option>
              <option value="easypaisa">{t('paymentMethod.easypaisa')}</option>
              <option value="jazzcash">{t('paymentMethod.jazzcash')}</option>
            </select>

            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.noteOptional')}</label>
            <input className="input mb-5" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />

            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('contact.cancel')}</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? t('khataDetail.loading') : t('contact.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
