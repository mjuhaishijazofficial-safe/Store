'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';

type Supplier = { id: string; name: string };
type SourceItem = { id: string; name: string; unit: string | null; cost_price: number };
type Line = { itemId: string | null; name: string; unit: string | null; qty: number; costPrice: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function NewPurchaseOrderModal({
  suppliers,
  items,
  initialLine,
  onClose,
  onCreated
}: {
  suppliers: Supplier[];
  items: SourceItem[];
  // Smart Reorder's "1-tap send to stock-in" (spec §29) pre-fills one
  // line so the owner lands here with the suggested item/quantity
  // already in the cart, instead of having to search for it again.
  initialLine?: { itemId: string; name: string; unit: string | null; qty: number; costPrice: number };
  onClose: () => void;
  onCreated: (poId: string) => void;
}) {
  const supabase = createClient();
  const { t } = useLang();
  const { showToast } = useToast();

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>(() => initialLine ? [initialLine] : []);
  // A line typed by hand (not picked from inventory) — covers a brand
  // new item the shop has never stocked before; it lands on the PO with
  // item_id null, so mark_po_received records its ledger amount but
  // can't restock a row that doesn't exist yet.
  const [manualName, setManualName] = useState('');
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20);
  }, [search, items]);

  const total = lines.reduce((s, l) => s + l.qty * l.costPrice, 0);

  function addFromItem(it: SourceItem) {
    setLines(prev => prev.some(l => l.itemId === it.id)
      ? prev.map(l => l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l)
      : [...prev, { itemId: it.id, name: it.name, unit: it.unit, qty: 1, costPrice: it.cost_price || 0 }]);
    setSearch('');
  }

  function addManual() {
    const name = manualName.trim();
    if (!name) return;
    setLines(prev => [...prev, { itemId: null, name, unit: null, qty: 1, costPrice: 0 }]);
    setManualName('');
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!supplierId || lines.length === 0) return;
    setSaving(true);
    const { data, error: err } = await supabase.rpc('create_purchase_order', {
      p_supplier_id: supplierId,
      p_items: lines.map(l => ({ item_id: l.itemId, item_name: l.name, qty: l.qty, cost_price: l.costPrice })),
      p_note: note.trim() || null
    });
    setSaving(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    onCreated(data as string);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="font-display text-lg text-haldi font-700 mb-4">{t('po.newTitle')}</div>

        <label className="block text-xs text-chalkdim mb-1">{t('po.supplier')}</label>
        <select className="input mb-3 shrink-0" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label className="block text-xs text-chalkdim mb-1">{t('po.searchItem')}</label>
        <input className="input mb-2 shrink-0" placeholder={t('cart.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />

        {results.length > 0 && (
          <div className="card divide-y divide-chalk/10 mb-2 max-h-32 overflow-y-auto shrink-0">
            {results.map(it => (
              <button key={it.id} onClick={() => addFromItem(it)} className="w-full text-left p-2 px-3 text-sm hover:bg-board3">
                {it.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 mb-3 shrink-0">
          <input className="input flex-1 text-sm" placeholder={t('po.manualItemPlaceholder')} value={manualName} onChange={e => setManualName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()} />
          <button onClick={addManual} className="btn-secondary text-xs px-3 whitespace-nowrap">{t('po.addManual')}</button>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {lines.length === 0 ? (
            <div className="text-center py-8 text-chalkdim text-sm">{t('cart.empty')}</div>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="card p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-sm font-600">{l.name}</div>
                    <button onClick={() => removeLine(i)} className="text-chalkdim hover:text-mirch text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-chalkdim mb-0.5">{t('cart.qty')}</label>
                      <input type="number" inputMode="decimal" className="input py-1.5 text-sm" value={l.qty} onChange={e => updateLine(i, { qty: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-chalkdim mb-0.5">{t('po.costPrice')}</label>
                      <input type="number" inputMode="decimal" className="input py-1.5 text-sm" value={l.costPrice} onChange={e => updateLine(i, { costPrice: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="text-right font-mono font-700 text-sm mt-2">{fmt(l.qty * l.costPrice)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="block text-xs text-chalkdim mt-3 mb-1 shrink-0">{t('khataDetail.noteOptional')}</label>
        <input className="input mb-3 shrink-0" value={note} onChange={e => setNote(e.target.value)} />

        <div className="pt-3 border-t border-chalk/10 shrink-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-chalkdim">{t('cart.total')}</span>
            <span className="font-mono font-800 text-xl">{fmt(total)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
            <button onClick={submit} disabled={!supplierId || lines.length === 0 || saving} className="btn-primary flex-1">
              {saving ? t('common.loading') : t('po.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
