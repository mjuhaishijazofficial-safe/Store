'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number | null;
};

type Entry = {
  id: string;
  type: 'purchase' | 'payment';
  item_name: string | null;
  qty: number | null;
  amount: number;
  note: string | null;
  created_at: string;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();

  const [shopId, setShopId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalType, setModalType] = useState<'purchase' | 'payment' | null>(null);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });

  useEffect(() => { init(); }, [customerId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
    setShopId(profile?.shop_id || null);
    await loadAll();
  }

  async function loadAll() {
    setLoading(true);
    const [{ data: cust }, { data: rows }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).single(),
      supabase.from('khata_entries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false })
    ]);
    setCustomer(cust || null);
    setEntries(rows || []);
    setLoading(false);
  }

  const total = entries.reduce((sum, e) => sum + (e.type === 'purchase' ? e.amount : -e.amount), 0);
  const over = customer?.credit_limit != null && total > customer.credit_limit;

  function openModal(type: 'purchase' | 'payment') {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setModalType(type);
  }

  async function saveEntry() {
    if (!shopId || !modalType) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;

    await supabase.from('khata_entries').insert({
      shop_id: shopId,
      customer_id: customerId,
      type: modalType,
      item_name: modalType === 'purchase' ? (form.item_name.trim() || null) : null,
      qty: modalType === 'purchase' && form.qty ? Number(form.qty) : null,
      amount,
      note: form.note.trim() || null
    });

    setModalType(null);
    await loadAll();
  }

  async function deleteEntry(id: string) {
    await supabase.from('khata_entries').delete().eq('id', id);
    await loadAll();
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.loading')}</div>;
  if (!customer) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.notFound')}</div>;

  return (
    <div>
      <Link href="/dashboard/khata" className="text-xs text-chalkdim hover:text-haldi">{t('khataDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="font-display text-lg font-700">{customer.name}</div>
        <div className="text-xs text-chalkdim mb-4">{customer.phone || '—'}</div>

        <div className="text-xs text-chalkdim">{t('khataDetail.totalUdhaar')}</div>
        <div className={`font-mono font-800 text-3xl ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(total)}</div>
        {over && <div className="text-xs text-mirch mt-1">{t('khataDetail.overLimit')} ({fmt(customer.credit_limit!)})</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={() => openModal('purchase')} className="flex-1 text-sm py-2.5 rounded-lg border border-mirch text-mirch">{t('khataDetail.newSaman')}</button>
          <button onClick={() => openModal('payment')} className="flex-1 text-sm py-2.5 rounded-lg border border-dhania text-dhania">{t('khataDetail.paymentReceived')}</button>
        </div>
      </div>

      {entries.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('khataDetail.empty')}</div>
      )}

      <div className="space-y-2">
        {entries.map(e => {
          const d = new Date(e.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return (
            <div key={e.id} className="card p-3 px-4 flex justify-between items-center">
              <div>
                <div className="font-600 text-sm">
                  {e.type === 'purchase' ? (e.item_name || t('khataDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '') : t('khataDetail.paymentLabel')}
                </div>
                <div className="text-xs text-chalkdim mt-0.5">{when}{e.note ? ` • ${e.note}` : ''}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`font-mono font-700 text-sm ${e.type === 'purchase' ? 'text-mirch' : 'text-dhania'}`}>
                  {e.type === 'purchase' ? '+' : '−'}{fmt(e.amount)}
                </div>
                <button onClick={() => deleteEntry(e.id)} className="text-chalkdim text-xs hover:text-mirch">✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Entry Modal */}
      {modalType && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalType(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">
              {modalType === 'purchase' ? t('khataDetail.newSaman') : t('khataDetail.paymentReceived')}
            </div>
            {modalType === 'purchase' && (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.itemName')}</label>
                <input className="input mb-3" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} placeholder={t('khataDetail.itemPlaceholder')} />
                <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.qtyOptional')}</label>
                <input type="number" className="input mb-3" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="e.g. 1" />
              </>
            )}
            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.amount')}</label>
            <input type="number" className="input mb-3" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.noteOptional')}</label>
            <input className="input mb-5" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalType(null)} className="btn-secondary flex-1">{t('khataDetail.cancel')}</button>
              <button onClick={saveEntry} className="btn-primary flex-1">{t('khataDetail.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
