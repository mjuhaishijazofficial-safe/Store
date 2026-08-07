'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';

type Item = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  stock: number;
  min_stock: number;
  price: number;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function InventoryPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId } = useShop();
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [moveItem, setMoveItem] = useState<Item | null>(null);
  const [moveType, setMoveType] = useState<'purchase' | 'sale'>('purchase');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ name: '', category: '', unit: '', stock: 0, min_stock: 0, price: 0 });
  const [moveForm, setMoveForm] = useState({ qty: 0, amount: 0 });

  useEffect(() => { loadItems(); }, [shopId]);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase.from('items').select('*').eq('shop_id', shopId).order('name');
    setItems(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ name: '', category: '', unit: '', stock: 0, min_stock: 0, price: 0 });
    setError('');
    setModalOpen(true);
  }

  function openEdit(it: Item) {
    setEditing(it);
    setForm({ name: it.name, category: it.category || '', unit: it.unit || '', stock: it.stock, min_stock: it.min_stock, price: it.price });
    setError('');
    setModalOpen(true);
  }

  async function saveItem() {
    if (!form.name.trim() || !shopId) return;
    const { error: err } = editing
      ? await supabase.from('items').update({ ...form }).eq('id', editing.id)
      : await supabase.from('items').insert({ ...form, shop_id: shopId });

    if (err) { setError(t('common.error')); return; }
    setModalOpen(false);
    await loadItems();
  }

  async function deleteItem() {
    if (!editing) return;
    const { error: err } = await supabase.from('items').delete().eq('id', editing.id);
    if (err) { setError(t('common.error')); return; }
    setModalOpen(false);
    await loadItems();
  }

  function openMove(it: Item, type: 'purchase' | 'sale') {
    setMoveItem(it);
    setMoveType(type);
    setMoveForm({ qty: 0, amount: 0 });
    setError('');
    setMoveOpen(true);
  }

  async function confirmMove() {
    if (!moveItem || !shopId || moveForm.qty <= 0) return;

    const amount = moveType === 'purchase' ? (moveForm.amount || moveForm.qty * moveItem.price) : 0;

    // Atomic: stock update + transactions log row happen in one DB
    // transaction (record_stock_move), so a mid-way failure can't leave
    // a logged move with no matching stock change, and concurrent moves
    // from two staff members on the same item can't silently clobber
    // each other the way two separate read-then-write calls could.
    const { error: err } = await supabase.rpc('record_stock_move', {
      p_item_id: moveItem.id,
      p_type: moveType,
      p_qty: moveForm.qty,
      p_amount: amount
    });

    if (err) { setError(t('common.error')); return; }

    setMoveOpen(false);
    await loadItems();
  }

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder={t('inventory.search')} value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={openAdd} className="btn-primary whitespace-nowrap">{t('inventory.addNew')}</button>
      </div>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('inventory.loading')}</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-haldi text-base mb-1">{t('inventory.emptyTitle')}</div>
          {t('inventory.emptyBody')}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(it => {
          const low = it.stock <= it.min_stock;
          return (
            <div key={it.id} className={`card p-4 ${low ? 'border-mirch' : ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-700">{it.name}</div>
                  <div className="text-xs text-chalkdim">{it.category || '—'}</div>
                </div>
                <div className={`font-mono font-700 text-right ${low ? 'text-mirch' : ''}`}>
                  {it.stock} <span className="block text-[10px] font-normal text-chalkdim">{it.unit}</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-chalkdim mt-2">
                <span>{t('inventory.alertLevel')}: {it.min_stock}</span>
                <span>{fmt(it.price)} / {it.unit}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => openMove(it, 'purchase')} className="flex-1 text-xs py-2 rounded-lg border border-dhania text-dhania">{t('inventory.stockIn')}</button>
                <button onClick={() => openMove(it, 'sale')} className="flex-1 text-xs py-2 rounded-lg border border-mirch text-mirch">{t('inventory.stockOut')}</button>
                <button onClick={() => openEdit(it)} className="flex-1 text-xs py-2 rounded-lg border border-chalk/10 text-chalkdim">{t('inventory.edit')}</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{editing ? t('inventory.editItemTitle') : t('inventory.newItemTitle')}</div>
            {error && <div className="text-mirch text-sm mb-3 bg-mirch/10 p-3 rounded-lg">{error}</div>}
            <label className="block text-xs text-chalkdim mb-1">{t('inventory.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('inventory.category')}</label>
            <input className="input mb-3" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.stock')}</label>
                <input type="number" className="input" value={form.stock} onChange={e => setForm({ ...form, stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.unit')}</label>
                <input className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={t('inventory.unitPlaceholder')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.alertLevel')}</label>
                <input type="number" className="input" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.price')}</label>
                <input type="number" className="input" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
              <button onClick={saveItem} className="btn-primary flex-1">{t('inventory.save')}</button>
            </div>
            {editing && <button onClick={deleteItem} className="w-full text-mirch text-sm py-2">{t('inventory.deleteItem')}</button>}
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveOpen && moveItem && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setMoveOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">
              {moveType === 'purchase' ? t('inventory.newStockTitle') : t('inventory.outStockTitle')}{moveItem.name}
            </div>
            {error && <div className="text-mirch text-sm mb-3 bg-mirch/10 p-3 rounded-lg">{error}</div>}
            <label className="block text-xs text-chalkdim mb-1">{t('inventory.quantity')} ({moveItem.unit})</label>
            <input type="number" className="input mb-3" value={moveForm.qty} onChange={e => setMoveForm({ ...moveForm, qty: Number(e.target.value) })} />
            {moveType === 'purchase' && (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.totalAmount')}</label>
                <input type="number" className="input mb-3" value={moveForm.amount} onChange={e => setMoveForm({ ...moveForm, amount: Number(e.target.value) })} />
              </>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setMoveOpen(false)} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
              <button onClick={confirmMove} className="btn-primary flex-1">{t('inventory.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
