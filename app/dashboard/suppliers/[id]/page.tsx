'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ContactEditModal from '@/components/ContactEditModal';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
};

type EntryType = 'purchase' | 'payment' | 'return';

type Entry = {
  id: string;
  type: EntryType;
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
  const router = useRouter();
  const supplierId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();
  const { shopId } = useShop();
  const { showToast } = useToast();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [modalType, setModalType] = useState<EntryType | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });

  useEffect(() => { loadAll(); }, [supplierId, shopId]);

  async function loadBalance() {
    // See khata_customer_totals in schema.sql for why this is a real SQL
    // function rather than a client-side `.select('amount.sum()')` call
    // — that pattern was silently reading as ₨0 with no error surfaced.
    // A return reduces what's owed the same direction a cash payment
    // does, so it comes out of the balance the same way.
    const { data, error: err } = await supabase.rpc('supplier_contact_totals', { p_supplier_id: supplierId }).single();
    if (err) { showToast(t('common.error'), 'error'); return; }
    const d = data as any;
    setTotal((d?.given || 0) - (d?.paid || 0) - (d?.returned || 0));
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

  function openModal(type: EntryType) {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setModalType(type);
  }

  // purchase and return both name a specific item — one arriving, one
  // going back — payment is just cash, no item involved.
  const modalNeedsItem = modalType === 'purchase' || modalType === 'return';

  async function saveEntry() {
    if (!shopId || !modalType) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;

    const { error: err } = await supabase.from('supplier_entries').insert({
      shop_id: shopId,
      supplier_id: supplierId,
      type: modalType,
      item_name: modalNeedsItem ? (form.item_name.trim() || null) : null,
      qty: modalNeedsItem && form.qty ? Number(form.qty) : null,
      amount,
      note: form.note.trim() || null
    });

    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalType(null);
    await loadAll();
  }

  async function deleteEntry(id: string) {
    const { error: err } = await supabase.from('supplier_entries').delete().eq('id', id);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('suppliersDetail.loading')}</div>;
  if (!supplier) return <div className="text-chalkdim text-sm text-center py-10">{t('suppliersDetail.notFound')}</div>;

  return (
    <div>
      <Link href="/dashboard/suppliers" className="text-xs text-chalkdim hover:text-haldi">{t('suppliersDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-display text-lg font-700">{supplier.name}</div>
            <div className="text-xs text-chalkdim">{supplier.phone || '—'}</div>
          </div>
          <button onClick={() => setEditOpen(true)} className="text-xs text-chalkdim hover:text-haldi shrink-0">{t('contact.edit')}</button>
        </div>

        <div className="text-xs text-chalkdim">{t('suppliersDetail.totalOwed')}</div>
        <div className={`font-mono font-800 text-3xl ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(total)}</div>

        <div className="flex gap-2 mt-4">
          <button onClick={() => openModal('purchase')} className="flex-1 text-sm py-2.5 rounded-lg border border-mirch text-mirch">{t('suppliersDetail.maalLiya')}</button>
          <button onClick={() => openModal('payment')} className="flex-1 text-sm py-2.5 rounded-lg border border-dhania text-dhania">{t('suppliersDetail.paymentDi')}</button>
        </div>
        <button onClick={() => openModal('return')} className="w-full mt-2 text-sm py-2.5 rounded-lg border border-haldi text-haldi">{t('suppliersDetail.maalWapas')}</button>
      </div>

      {entries.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('suppliersDetail.empty')}</div>
      )}

      <div className="space-y-2">
        {entries.map(e => {
          const d = new Date(e.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          // Purchase (owe more) is red, payment and return both reduce
          // what's owed but stay visually distinct from each other —
          // green for actual cash out, amber for goods sent back, so
          // "I paid" and "I returned this" never read as the same thing
          // at a glance.
          const color = e.type === 'purchase' ? 'text-mirch' : e.type === 'return' ? 'text-haldi' : 'text-dhania';
          const label =
            e.type === 'purchase' ? (e.item_name || t('suppliersDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '')
            : e.type === 'return' ? (e.item_name || t('suppliersDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '') + ` (${t('suppliersDetail.maalWapas')})`
            : t('suppliersDetail.paymentLabel');
          return (
            <div key={e.id} className="card p-3 px-4 flex justify-between items-center">
              <div>
                <div className="font-600 text-sm">{label}</div>
                <div className="text-xs text-chalkdim mt-0.5">{when}{e.note ? ` • ${e.note}` : ''}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`font-mono font-700 text-sm ${color}`}>
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
              {modalType === 'purchase' ? t('suppliersDetail.maalLiya') : modalType === 'return' ? t('suppliersDetail.maalWapas') : t('suppliersDetail.paymentDi')}
            </div>
            {modalNeedsItem && (
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

      {editOpen && (
        <ContactEditModal
          kind="supplier"
          contact={supplier}
          balance={total}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); loadAll(); }}
          onDeleted={() => router.push('/dashboard/suppliers')}
        />
      )}
    </div>
  );
}
