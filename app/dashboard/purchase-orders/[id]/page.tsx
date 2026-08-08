'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import ConfirmDeleteButton from '@/components/ConfirmDeleteButton';

type Status = 'draft' | 'sent' | 'received' | 'cancelled';

type Line = { id: string; item_id: string | null; item_name: string; qty: number; cost_price: number };

type Po = {
  id: string;
  status: Status;
  note: string | null;
  created_at: string;
  received_at: string | null;
  suppliers: { name: string } | null;
};

type SourceItem = { id: string; name: string; unit: string | null; cost_price: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const poId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();
  const { shopId } = useShop();
  const { showToast } = useToast();
  useSectionGuard('suppliers');

  const [po, setPo] = useState<Po | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [items, setItems] = useState<SourceItem[]>([]);
  const [search, setSearch] = useState('');
  const [manualName, setManualName] = useState('');

  useEffect(() => { loadAll(); }, [poId, shopId]);

  async function loadAll() {
    setLoading(true);
    const [{ data: poRow }, { data: lineRows }, { data: itemRows }] = await Promise.all([
      supabase.from('purchase_orders').select('id, status, note, created_at, received_at, suppliers(name)').eq('id', poId).single(),
      supabase.from('purchase_order_items').select('id, item_id, item_name, qty, cost_price').eq('purchase_order_id', poId).order('created_at'),
      supabase.from('items').select('id, name, unit, cost_price').eq('shop_id', shopId).order('name')
    ]);
    setPo((poRow as any) || null);
    setLines(lineRows || []);
    setItems(itemRows || []);
    setLoading(false);
  }

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 10);
  }, [search, items]);

  const total = lines.reduce((s, l) => s + l.qty * l.cost_price, 0);
  const isDraft = po?.status === 'draft';

  const statusLabels: Record<Status, string> = {
    draft: t('po.statusDraft'),
    sent: t('po.statusSent'),
    received: t('po.statusReceived'),
    cancelled: t('po.statusCancelled')
  };

  async function addLine(itemId: string | null, name: string, costPrice: number) {
    if (!shopId) return;
    const { error: err } = await supabase.from('purchase_order_items').insert({
      shop_id: shopId,
      purchase_order_id: poId,
      item_id: itemId,
      item_name: name,
      qty: 1,
      cost_price: costPrice
    });
    if (err) { showToast(t('common.error'), 'error'); return; }
    setSearch('');
    setManualName('');
    await loadAll();
  }

  async function updateLine(lineId: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...patch } : l));
  }

  async function saveLine(lineId: string) {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const { error: err } = await supabase.from('purchase_order_items').update({ qty: line.qty, cost_price: line.cost_price }).eq('id', lineId);
    if (err) showToast(t('common.error'), 'error');
  }

  async function removeLine(lineId: string) {
    const { error: err } = await supabase.from('purchase_order_items').delete().eq('id', lineId);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
  }

  async function setStatus(status: 'sent' | 'cancelled') {
    setBusy(true);
    const { error: err } = await supabase.from('purchase_orders').update({ status }).eq('id', poId);
    setBusy(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
  }

  async function markReceived() {
    if (lines.length === 0) return;
    setBusy(true);
    const { error: err } = await supabase.rpc('mark_po_received', { p_po_id: poId });
    setBusy(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('po.receivedToast'), 'success');
    await loadAll();
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>;
  if (!po) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.notFound')}</div>;

  return (
    <div className="max-w-md">
      <Link href="/dashboard/purchase-orders" className="text-xs text-chalkdim hover:text-haldi">{t('po.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="font-display text-lg font-700">{po.suppliers?.name || '—'}</div>
            <div className="text-xs text-chalkdim mt-0.5">
              {new Date(po.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div className={`text-[10px] uppercase border rounded px-2 py-1 ${
            po.status === 'draft' ? 'text-chalkdim border-chalk/20' :
            po.status === 'sent' ? 'text-haldi border-haldi/40' :
            po.status === 'received' ? 'text-dhania border-dhania/40' : 'text-mirch border-mirch/40'
          }`}>
            {statusLabels[po.status]}
          </div>
        </div>
        {po.note && <div className="text-xs text-chalkdim mt-2">{po.note}</div>}
        {po.received_at && (
          <div className="text-[11px] text-dhania mt-2">{t('po.receivedOn')} {new Date(po.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        )}
      </div>

      <div className="text-xs text-chalkdim uppercase tracking-wide mb-2">{t('po.items')}</div>
      <div className="space-y-2 mb-4">
        {lines.map(l => (
          <div key={l.id} className="card p-3">
            <div className="flex justify-between items-start mb-2">
              <div className="text-sm font-600">{l.item_name}</div>
              {isDraft && <ConfirmDeleteButton onConfirm={() => removeLine(l.id)} />}
            </div>
            {isDraft ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-chalkdim mb-0.5">{t('cart.qty')}</label>
                  <input
                    type="number" inputMode="decimal" className="input py-1.5 text-sm"
                    value={l.qty}
                    onChange={e => updateLine(l.id, { qty: Number(e.target.value) })}
                    onBlur={() => saveLine(l.id)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-chalkdim mb-0.5">{t('po.costPrice')}</label>
                  <input
                    type="number" inputMode="decimal" className="input py-1.5 text-sm"
                    value={l.cost_price}
                    onChange={e => updateLine(l.id, { cost_price: Number(e.target.value) })}
                    onBlur={() => saveLine(l.id)}
                  />
                </div>
              </div>
            ) : (
              <div className="flex justify-between text-xs text-chalkdim">
                <span>{l.qty} × {fmt(l.cost_price)}</span>
                <span className="font-mono">{fmt(l.qty * l.cost_price)}</span>
              </div>
            )}
          </div>
        ))}

        {lines.length === 0 && <div className="text-center py-6 text-chalkdim text-sm">{t('cart.empty')}</div>}
      </div>

      {isDraft && (
        <div className="mb-5">
          <input className="input mb-2" placeholder={t('cart.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          {results.length > 0 && (
            <div className="card divide-y divide-chalk/10 mb-2 max-h-32 overflow-y-auto">
              {results.map(it => (
                <button key={it.id} onClick={() => addLine(it.id, it.name, it.cost_price)} className="w-full text-left p-2 px-3 text-sm hover:bg-board3">
                  {it.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className="input flex-1 text-sm" placeholder={t('po.manualItemPlaceholder')} value={manualName} onChange={e => setManualName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLine(null, manualName.trim(), 0)} />
            <button onClick={() => addLine(null, manualName.trim(), 0)} disabled={!manualName.trim()} className="btn-secondary text-xs px-3 whitespace-nowrap">{t('po.addManual')}</button>
          </div>
        </div>
      )}

      <div className="card p-4 mb-5 flex justify-between items-center">
        <span className="text-sm text-chalkdim">{t('cart.total')}</span>
        <span className="font-mono font-800 text-xl">{fmt(total)}</span>
      </div>

      {(po.status === 'draft' || po.status === 'sent') && (
        <div className="flex flex-col gap-2">
          <button onClick={markReceived} disabled={busy || lines.length === 0} className="btn-primary w-full">
            {t('po.markReceived')}
          </button>
          <div className="flex gap-2">
            {po.status === 'draft' && (
              <button onClick={() => setStatus('sent')} disabled={busy} className="btn-secondary flex-1">{t('po.markSent')}</button>
            )}
            <button onClick={() => setStatus('cancelled')} disabled={busy} className="flex-1 text-mirch text-sm font-700 border border-mirch/40 rounded-lg px-4 py-2.5">
              {t('po.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
