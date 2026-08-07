'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';

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

type ItemLite = { id: string; name: string; price: number; unit: string | null; stock: number };

const PAGE_SIZE = 30;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName } = useShop();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [advanceDepletedNotice, setAdvanceDepletedNotice] = useState(false);

  const [modalType, setModalType] = useState<'purchase' | 'payment' | null>(null);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => { init(); }, [customerId, shopId]);

  async function init() {
    await Promise.all([reloadItems(), loadAll()]);
  }

  async function reloadItems() {
    const { data: inv } = await supabase.from('items').select('id, name, price, unit, stock').eq('shop_id', shopId).order('name');
    setItems(inv || []);
  }

  // Balance comes from a DB-side sum, not by adding up whatever page of
  // entries happens to be loaded on screen — otherwise pagination would
  // silently understate the real total. A negative balance means the
  // customer has paid more than they've bought — an advance sitting with
  // the shop, consumed by future purchases before any new debt accrues.
  // Returns the value (not just setting state) so callers can compare
  // before/after and catch the moment the advance runs out.
  async function loadBalance(): Promise<number> {
    const [{ data: pSum }, { data: nSum }] = await Promise.all([
      supabase.from('khata_entries').select('amount.sum()').eq('customer_id', customerId).eq('type', 'purchase').single(),
      supabase.from('khata_entries').select('amount.sum()').eq('customer_id', customerId).eq('type', 'payment').single()
    ]);
    const newTotal = ((pSum as any)?.sum || 0) - ((nSum as any)?.sum || 0);
    setTotal(newTotal);
    return newTotal;
  }

  async function loadEntries(reset: boolean) {
    const offset = reset ? 0 : entries.length;
    const { data: rows } = await supabase
      .from('khata_entries')
      .select('*')
      .eq('customer_id', customerId)
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
    const { data: cust } = await supabase.from('customers').select('*').eq('id', customerId).single();
    setCustomer(cust || null);
    await Promise.all([loadEntries(true), loadBalance()]);
    setLoading(false);
  }

  const over = customer?.credit_limit != null && total > customer.credit_limit;

  const projectedTotal = total + (modalType === 'purchase' ? (Number(form.amount) || 0) : 0);
  const willGoOverLimit = modalType === 'purchase' && customer?.credit_limit != null && projectedTotal > customer.credit_limit;

  const itemMatches = form.item_name.trim() && showDropdown
    ? items.filter(i => i.name.toLowerCase().includes(form.item_name.toLowerCase())).slice(0, 5)
    : [];

  function openModal(type: 'purchase' | 'payment') {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setSelectedItemId(null);
    setShowDropdown(false);
    setError('');
    setModalType(type);
  }

  function onItemNameChange(v: string) {
    setForm(f => ({ ...f, item_name: v }));
    setSelectedItemId(null);
    setShowDropdown(true);
  }

  function onQtyChange(v: string) {
    const item = items.find(i => i.id === selectedItemId);
    setForm(f => ({
      ...f,
      qty: v,
      amount: item ? String((Number(v) || 1) * item.price) : f.amount
    }));
  }

  function selectItem(item: ItemLite) {
    const qty = form.qty || '1';
    setForm(f => ({
      ...f,
      item_name: item.name,
      qty,
      amount: String((Number(qty) || 1) * item.price)
    }));
    setSelectedItemId(item.id);
    setShowDropdown(false);
  }

  async function saveEntry() {
    if (!shopId || !modalType) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;

    const qtyNum = form.qty ? Number(form.qty) : null;
    const wasAdvance = total < 0;

    // Atomic: the ledger insert and the linked inventory stock deduction
    // happen in one DB transaction (record_khata_entry) instead of two
    // separate client calls, so a mid-way failure can't leave a "Naya
    // Saman Diya" entry recorded with no matching stock change.
    const { error: err } = await supabase.rpc('record_khata_entry', {
      p_customer_id: customerId,
      p_type: modalType,
      p_item_id: modalType === 'purchase' ? selectedItemId : null,
      p_item_name: modalType === 'purchase' ? (form.item_name.trim() || null) : null,
      p_qty: modalType === 'purchase' ? qtyNum : null,
      p_amount: amount,
      p_note: form.note.trim() || null
    });

    if (err) { setError(t('common.error')); return; }

    setModalType(null);
    const [, newTotal] = await Promise.all([loadEntries(true), loadBalance()]);
    await reloadItems();

    // The customer had an advance sitting with the shop and this entry
    // just used the last of it — flag it so the shopkeeper notices new
    // debt has started, not just silently see a number tick past zero.
    if (wasAdvance && newTotal >= 0) {
      setAdvanceDepletedNotice(true);
    }
  }

  async function deleteEntry(id: string) {
    // Atomic: also restores any inventory stock this entry had deducted.
    const { error: err } = await supabase.rpc('delete_khata_entry', { p_entry_id: id });
    if (err) { setError(t('common.error')); return; }
    await loadAll();
    await reloadItems();
  }

  function remindWhatsapp() {
    if (!customer?.phone) return;
    let digits = customer.phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '92' + digits.slice(1); // Pakistani local -> international
    const msg = t('khataDetail.reminderMsg').replace('{amount}', fmt(total).replace('₨', '')).replace('{shop}', shopName || 'Dukaan');
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.loading')}</div>;
  if (!customer) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.notFound')}</div>;

  return (
    <div>
      <Link href="/dashboard/khata" className="text-xs text-chalkdim hover:text-haldi">{t('khataDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="font-display text-lg font-700">{customer.name}</div>
        <div className="text-xs text-chalkdim mb-4">{customer.phone || '—'}</div>

        <div className="text-xs text-chalkdim">{total < 0 ? t('khataDetail.advanceBalance') : t('khataDetail.totalUdhaar')}</div>
        <div className={`font-mono font-800 text-3xl ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(Math.abs(total))}</div>
        {over && <div className="text-xs text-mirch mt-1">{t('khataDetail.overLimit')} ({fmt(customer.credit_limit!)})</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={() => openModal('purchase')} className="flex-1 text-sm py-2.5 rounded-lg border border-mirch text-mirch">{t('khataDetail.newSaman')}</button>
          <button onClick={() => openModal('payment')} className="flex-1 text-sm py-2.5 rounded-lg border border-dhania text-dhania">{t('khataDetail.paymentReceived')}</button>
        </div>

        {total > 0 && customer.phone && (
          <button onClick={remindWhatsapp} className="w-full mt-2 text-sm py-2.5 rounded-lg border border-dhania text-dhania">
            {t('khataDetail.remindWhatsapp')}
          </button>
        )}
      </div>

      {advanceDepletedNotice && (
        <div className="flex items-start justify-between gap-2 text-haldi text-sm mb-3 bg-haldi/10 p-3 rounded-lg">
          <span><strong>{customer.name}</strong> {t('khataDetail.advanceDepleted')}</span>
          <button onClick={() => setAdvanceDepletedNotice(false)} className="text-chalkdim shrink-0">✕</button>
        </div>
      )}

      {error && <div className="text-mirch text-sm mb-3 bg-mirch/10 p-3 rounded-lg">{error}</div>}

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

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('khataDetail.loading') : t('common.loadMore')}
        </button>
      )}

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
                <div className="relative mb-3">
                  <input
                    className="input"
                    value={form.item_name}
                    onChange={e => onItemNameChange(e.target.value)}
                    onFocus={() => setShowDropdown(true)}
                    placeholder={t('khataDetail.itemPlaceholder')}
                  />
                  {itemMatches.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 card p-1 z-10 max-h-48 overflow-y-auto">
                      {itemMatches.map(it => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => selectItem(it)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-board3 flex justify-between items-center text-sm"
                        >
                          <span>{it.name}</span>
                          <span className="text-xs text-chalkdim font-mono">{fmt(it.price)}/{it.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedItemId && <div className="text-[10px] text-dhania mt-1">✓ {t('khataDetail.fromInventory')}</div>}
                </div>
                <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.qtyOptional')}</label>
                <input type="number" className="input mb-3" value={form.qty} onChange={e => onQtyChange(e.target.value)} placeholder="e.g. 1" />
              </>
            )}
            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.amount')}</label>
            <input type="number" className="input mb-1" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            {willGoOverLimit && (
              <div className="text-xs text-mirch mb-2">{t('khataDetail.limitWarning')} ({fmt(customer.credit_limit!)})</div>
            )}
            <label className="block text-xs text-chalkdim mb-1 mt-2">{t('khataDetail.noteOptional')}</label>
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
