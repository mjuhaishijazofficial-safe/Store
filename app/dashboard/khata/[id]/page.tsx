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

type ItemLite = { id: string; name: string; price: number; unit: string | null; stock: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();

  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalType, setModalType] = useState<'purchase' | 'payment' | null>(null);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => { init(); }, [customerId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
    const sid = profile?.shop_id || null;
    setShopId(sid);
    if (sid) {
      const { data: shop } = await supabase.from('shops').select('name').eq('id', sid).single();
      setShopName(shop?.name || '');
      await reloadItems(sid);
    }
    await loadAll();
  }

  async function reloadItems(sid?: string | null) {
    const id = sid || shopId;
    if (!id) return;
    const { data: inv } = await supabase.from('items').select('id, name, price, unit, stock').eq('shop_id', id).order('name');
    setItems(inv || []);
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

  const projectedTotal = total + (modalType === 'purchase' ? (Number(form.amount) || 0) : 0);
  const willGoOverLimit = modalType === 'purchase' && customer?.credit_limit != null && projectedTotal > customer.credit_limit;

  const itemMatches = form.item_name.trim() && showDropdown
    ? items.filter(i => i.name.toLowerCase().includes(form.item_name.toLowerCase())).slice(0, 5)
    : [];

  function openModal(type: 'purchase' | 'payment') {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setSelectedItemId(null);
    setShowDropdown(false);
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

    await supabase.from('khata_entries').insert({
      shop_id: shopId,
      customer_id: customerId,
      type: modalType,
      item_id: modalType === 'purchase' ? selectedItemId : null,
      item_name: modalType === 'purchase' ? (form.item_name.trim() || null) : null,
      qty: modalType === 'purchase' ? qtyNum : null,
      amount,
      note: form.note.trim() || null
    });

    // Khata + Inventory link: deduct stock when the item was picked from inventory
    if (modalType === 'purchase' && selectedItemId) {
      const item = items.find(i => i.id === selectedItemId);
      if (item) {
        const newStock = Math.max(0, item.stock - (qtyNum || 0));
        await supabase.from('items').update({ stock: newStock }).eq('id', item.id);
      }
    }

    setModalType(null);
    await loadAll();
    await reloadItems();
  }

  async function deleteEntry(id: string) {
    await supabase.from('khata_entries').delete().eq('id', id);
    await loadAll();
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

        <div className="text-xs text-chalkdim">{t('khataDetail.totalUdhaar')}</div>
        <div className={`font-mono font-800 text-3xl ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(total)}</div>
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
