'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
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

const PAGE_SIZE = 30;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function SupplierDetailPage() {
  const params = useParams();
  const supplierId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();

  const [shopId, setShopId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalType, setModalType] = useState<'purchase' | 'payment' | null>(null);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });

  useEffect(() => { init(); }, [supplierId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
    setShopId(profile?.shop_id || null);
    await loadAll();
  }

  async function loadBalance() {
    const [{ data: pSum }, { data: nSum }] = await Promise.all([
      supabase.from('supplier_entries').select('amount.sum()').eq('supplier_id', supplierId).eq('type', 'purchase').single(),
      supabase.from('supplier_entries').select('amount.sum()').eq('supplier_id', supplierId).eq('type', 'payment').single()
    ]);
    setTotal(((pSum as any)?.sum || 0) - ((nSum as any)?.sum || 0));
  }

  async function loadEntries(reset: boolean) {
    const offset = reset ? 0 : entries.length;
    const { data: rows } = await supabase
      .from('supplier_entries')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const newRows = rows || [];
    setEntries(reset ? newRows : prev => [...prev, ...newRows]);
    setHasMore(newRows.length === PAGE_SIZE);
  }

  async function loadMore() {
    setLoadingMore(true);
    await loadEntries(false);
    setLoadingMore(false);
  }

  async function loadAll() {
    setLoading(true);
    const { data: sup } = await supabase.from('suppliers').select('*').eq('id', supplierId).single();
    setSupplier(sup || null);
    await Promise.all([loadEntries(true), loadBalance()]);
    setLoading(false);
  }

  function openModal(type: 'purchase' | 'payment') {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setError('');
    setModalType(type);
  }

  async function saveEntry() {
    if (!shopId || !modalType) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;

    const { error: err } = await supabase.from('supplier_entries').insert({
      shop_id: shopId,
      supplier_id: supplierId,
      type: modalType,
      item_name: modalType === 'purchase' ? (form.item_name.trim() || null) : null,
      qty: modalType === 'purchase' && form.qty ? Number(form.qty) : null,
      amount,
      note: form.note.trim() || null
    });

    if (err) { setError(t('common.error')); return; }
    setModalType(null);
    await loadAll();
  }

  async function deleteEntry(id: string) {
    const { error: err } = await supabase.from('supplier_entries').delete().eq('id', id);
    if (err) { setError(t('common.error')); return; }
    await loadAll();
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('suppliersDetail.loading')}</div>;
  if (!supplier) return <div className="text-chalkdim text-sm text-center py-10">{t('suppliersDetail.notFound')}</div>;

  return (
    <div>
      <Link href="/dashboard/suppliers" className="text-xs text-chalkdim hover:text-haldi">{t('suppliersDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="font-display text-lg font-700">{supplier.name}</div>
        <div className="text-xs text-chalkdim mb-4">{supplier.phone || '—'}</div>

        <div className="text-xs text-chalkdim">{t('suppliersDetail.totalOwed')}</div>
        <div className={`font-mono font-800 text-3xl ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(total)}</div>

        <div className="flex gap-2 mt-4">
          <button onClick={() => openModal('purchase')} className="flex-1 text-sm py-2.5 rounded-lg border border-mirch text-mirch">{t('suppliersDetail.maalLiya')}</button>
          <button onClick={() => openModal('payment')} className="flex-1 text-sm py-2.5 rounded-lg border border-dhania text-dhania">{t('suppliersDetail.paymentDi')}</button>
        </div>
      </div>

      {error && <div className="text-mirch text-sm mb-3 bg-mirch/10 p-3 rounded-lg">{error}</div>}

      {entries.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('suppliersDetail.empty')}</div>
      )}

      <div className="space-y-2">
        {entries.map(e => {
          const d = new Date(e.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return (
            <div key={e.id} className="card p-3 px-4 flex justify-between items-center">
              <div>
                <div className="font-600 text-sm">
                  {e.type === 'purchase' ? (e.item_name || t('suppliersDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '') : t('suppliersDetail.paymentLabel')}
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

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('suppliersDetail.loading') : t('common.loadMore')}
        </button>
      )}

      {/* Add Entry Modal */}
      {modalType && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalType(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">
              {modalType === 'purchase' ? t('suppliersDetail.maalLiya') : t('suppliersDetail.paymentDi')}
            </div>
            {modalType === 'purchase' && (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('suppliersDetail.itemName')}</label>
                <input className="input mb-3" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} placeholder={t('suppliersDetail.itemPlaceholder')} />
                <label className="block text-xs text-chalkdim mb-1">{t('suppliersDetail.qtyOptional')}</label>
                <input type="number" className="input mb-3" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="e.g. 1" />
              </>
            )}
            <label className="block text-xs text-chalkdim mb-1">{t('suppliersDetail.amount')}</label>
            <input type="number" className="input mb-3" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('suppliersDetail.noteOptional')}</label>
            <input className="input mb-5" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalType(null)} className="btn-secondary flex-1">{t('suppliersDetail.cancel')}</button>
              <button onClick={saveEntry} className="btn-primary flex-1">{t('suppliersDetail.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
