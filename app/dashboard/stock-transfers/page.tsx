'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';

// Stock Transfer (spec §25-E) — only reachable once a shop has 2+
// branches (see app/dashboard/layout.tsx's nav gate). Confirming is the
// one moment stock actually moves; see confirm_stock_transfer in
// supabase/schema.sql for how it matches/creates the item at the
// destination branch.
type Branch = { id: string; name: string };
type Item = { id: string; name: string; unit: string | null; stock: number; branch_id: string | null };
type Line = { itemId: string; name: string; unit: string | null; qty: number };
type Transfer = {
  id: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  note: string | null;
  created_at: string;
  source_branch_id: string;
  destination_branch_id: string;
  stock_transfer_items: { item_name: string; qty: number }[];
};

export default function StockTransfersPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, role, branchId, branches } = useShop();
  const { showToast } = useToast();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [sourceBranchId, setSourceBranchId] = useState('');
  const [destBranchId, setDestBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  const branchName = (id: string) => branches.find(b => b.id === id)?.name || '—';

  useEffect(() => { load(); }, [shopId]);

  async function load() {
    setLoading(true);
    const [{ data: tRows }, { data: iRows }] = await Promise.all([
      supabase.from('stock_transfers').select('id, status, note, created_at, source_branch_id, destination_branch_id, stock_transfer_items(item_name, qty)').eq('shop_id', shopId).order('created_at', { ascending: false }),
      supabase.from('items').select('id, name, unit, stock, branch_id').eq('shop_id', shopId)
    ]);
    setTransfers((tRows as any) || []);
    setItems(iRows || []);
    setLoading(false);
  }

  function openNew() {
    setSourceBranchId(branchId || branches[0]?.id || '');
    setDestBranchId('');
    setSearch('');
    setLines([]);
    setModalOpen(true);
  }

  // null branch_id means "the shop's main branch" (see supabase/schema.sql
  // §15) — only surfaced as a transfer source when the source picker
  // itself is the main branch.
  const sourceItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const mainBranchId = branches[0]?.id;
    return items
      .filter(i => i.branch_id === sourceBranchId || (!i.branch_id && sourceBranchId === mainBranchId))
      .filter(i => !q || i.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [items, sourceBranchId, search, branches]);

  function addLine(it: Item) {
    setLines(prev => prev.some(l => l.itemId === it.id) ? prev : [...prev, { itemId: it.id, name: it.name, unit: it.unit, qty: 1 }]);
    setSearch('');
  }

  function updateLine(i: number, qty: number) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty } : l));
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!sourceBranchId || !destBranchId || sourceBranchId === destBranchId || lines.length === 0) return;
    setSaving(true);
    const { error: err } = await supabase.rpc('initiate_stock_transfer', {
      p_source_branch_id: sourceBranchId,
      p_destination_branch_id: destBranchId,
      p_items: lines.map(l => ({ item_id: l.itemId, item_name: l.name, qty: l.qty }))
    });
    setSaving(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    await load();
  }

  async function confirm(id: string) {
    setBusyId(id);
    const { error: err } = await supabase.rpc('confirm_stock_transfer', { p_transfer_id: id });
    setBusyId(null);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await load();
  }

  async function cancel(id: string) {
    setBusyId(id);
    const { error: err } = await supabase.rpc('cancel_stock_transfer', { p_transfer_id: id });
    setBusyId(null);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await load();
  }

  const statusLabel = { pending: t('stockTransfer.statusPending'), confirmed: t('stockTransfer.statusConfirmed'), cancelled: t('stockTransfer.statusCancelled') };
  const statusColor = { pending: 'text-haldi border-haldi/40', confirmed: 'text-dhania border-dhania/40', cancelled: 'text-chalkdim border-chalk/20' };

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">{t('stockTransfer.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{t('stockTransfer.subtitle')}</p>

      <button onClick={openNew} className="btn-primary w-full mb-5">{t('stockTransfer.newTitle')}</button>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}
      {!loading && transfers.length === 0 && <div className="text-center py-14 text-chalkdim text-sm">{t('stockTransfer.empty')}</div>}

      <div className="space-y-2">
        {transfers.map(tr => {
          // A Manager can only confirm a transfer landing at their own
          // branch — Owner (branchId null, org-wide) can confirm any.
          const canConfirm = tr.status === 'pending' && (role === 'owner' || branchId === tr.destination_branch_id);
          const canCancel = tr.status === 'pending' && (role === 'owner' || branchId === tr.source_branch_id);
          return (
            <div key={tr.id} className="card p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="text-sm font-600">{branchName(tr.source_branch_id)} → {branchName(tr.destination_branch_id)}</div>
                <span className={`text-[10px] uppercase border rounded px-1.5 py-0.5 ${statusColor[tr.status]}`}>{statusLabel[tr.status]}</span>
              </div>
              <div className="text-xs text-chalkdim mb-3">{tr.stock_transfer_items.length} {t('stockTransfer.items')} — {tr.stock_transfer_items.map(l => `${l.item_name} (${l.qty})`).join(', ')}</div>
              {(canConfirm || canCancel) && (
                <div className="flex gap-2">
                  {canConfirm && <button onClick={() => confirm(tr.id)} disabled={busyId === tr.id} className="btn-primary flex-1 text-xs py-2">{t('stockTransfer.confirm')}</button>}
                  {canCancel && <button onClick={() => cancel(tr.id)} disabled={busyId === tr.id} className="btn-secondary flex-1 text-xs py-2">{t('stockTransfer.cancel')}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('stockTransfer.newTitle')}</div>

            <div className="grid grid-cols-2 gap-3 mb-3 shrink-0">
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('stockTransfer.source')}</label>
                <select className="input" value={sourceBranchId} onChange={e => setSourceBranchId(e.target.value)}>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('stockTransfer.destination')}</label>
                <select className="input" value={destBranchId} onChange={e => setDestBranchId(e.target.value)}>
                  <option value="">—</option>
                  {branches.filter(b => b.id !== sourceBranchId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>

            <input className="input mb-2 shrink-0" placeholder={t('cart.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
            {search && sourceItems.length > 0 && (
              <div className="card divide-y divide-chalk/10 mb-3 max-h-32 overflow-y-auto shrink-0">
                {sourceItems.map(it => (
                  <button key={it.id} onClick={() => addLine(it)} className="w-full text-left p-2 px-3 text-sm hover:bg-board3 flex justify-between">
                    <span>{it.name}</span>
                    <span className="text-xs text-chalkdim">{it.stock} {it.unit}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {lines.length === 0 ? (
                <div className="text-center py-8 text-chalkdim text-sm">{t('cart.empty')}</div>
              ) : (
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={l.itemId} className="card p-3 flex justify-between items-center">
                      <span className="text-sm">{l.name}</span>
                      <div className="flex items-center gap-2">
                        <input type="number" inputMode="decimal" className="input py-1 text-sm w-16 text-center" value={l.qty} onChange={e => updateLine(i, Number(e.target.value))} />
                        <span className="text-xs text-chalkdim">{l.unit}</span>
                        <button onClick={() => removeLine(i)} className="text-chalkdim hover:text-mirch text-xs">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-3 pt-3 border-t border-chalk/10 shrink-0">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
              <button onClick={submit} disabled={!destBranchId || sourceBranchId === destBranchId || lines.length === 0 || saving} className="btn-primary flex-1">
                {saving ? t('common.loading') : t('stockTransfer.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
