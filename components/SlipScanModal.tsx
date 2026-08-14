'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';

// AI Slip-Scan (Master Handoff Spec §10 / §23) — the "flagship" stock-in
// screen: a photo of a supplier delivery slip → Gemini vision extracts
// item/qty/price rows → owner confirms (editable, Maujood/Naya Item
// badges) → confirmed rows become a fully-received purchase order in
// one shot, reusing create_purchase_order + receive_po_lines exactly
// the way NewPurchaseOrderModal's manual flow already does — same
// atomic stock-update + supplier-khata-update guarantee, no separate
// code path to keep in sync.

type Supplier = { id: string; name: string };
type Row = { name: string; qty: number; unit_price: number; matched_item_id: string | null };
type Step = 'capture' | 'loading' | 'confirm' | 'error';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [, base64] = result.split(',');
      resolve({ data: base64, mediaType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function SlipScanModal({
  suppliers,
  onClose,
  onDone
}: {
  suppliers: Supplier[];
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, branchId } = useShop();
  const { showToast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [step, setStep] = useState<Step>('capture');
  const [errorMsg, setErrorMsg] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [manualName, setManualName] = useState('');

  const total = rows.reduce((s, r) => s + r.qty * r.unit_price, 0);

  async function handleFile(file: File | undefined) {
    if (!file || !supplierId) return;
    setStep('loading');
    try {
      const { data: base64, mediaType } = await fileToBase64(file);
      const res = await fetch('/api/stock-in/slip-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const key = data.error === 'not_configured' ? 'slipScan.notConfigured'
          : data.error === 'unreadable_slip' ? 'slipScan.unreadable'
          : data.error === 'image too large' ? 'slipScan.imageTooLarge'
          : 'slipScan.genericError';
        setErrorMsg(t(key as any));
        setStep('error');
        return;
      }

      setRows((data.items as Row[]) || []);
      setStep('confirm');
    } catch {
      setErrorMsg(t('slipScan.genericError'));
      setStep('error');
    }
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function addManualRow() {
    const name = manualName.trim();
    if (!name) return;
    setRows(prev => [...prev, { name, qty: 1, unit_price: 0, matched_item_id: null }]);
    setManualName('');
  }

  async function confirmAndSave() {
    if (!supplierId || rows.length === 0) return;
    setConfirming(true);

    try {
      // New items (no matched_item_id) need to exist in inventory before
      // a purchase-order line can reference them — same reasoning
      // NewPurchaseOrderModal's manual-line path relies on (item_id
      // null there just means "no restock happens," which isn't what
      // Slip-Scan promises: every confirmed row should land in stock).
      const lineItems: { item_id: string | null; item_name: string; qty: number; cost_price: number }[] = [];
      for (const row of rows) {
        let itemId = row.matched_item_id;
        if (!itemId) {
          const { data: created, error: createErr } = await supabase
            .from('items')
            .insert({
              shop_id: shopId,
              branch_id: branchId,
              name: row.name,
              unit: 'piece',
              stock: 0,
              min_stock: 10,
              // Sale price defaults to cost price — never invented above
              // cost — the owner edits the real margin in Inventory
              // afterwards; this only guarantees nothing sells at a loss
              // silently the moment it's confirmed.
              price: row.unit_price,
              cost_price: row.unit_price
            })
            .select('id')
            .single();
          if (createErr || !created) throw createErr || new Error('item create failed');
          itemId = created.id;
        }
        lineItems.push({ item_id: itemId, item_name: row.name, qty: row.qty, cost_price: row.unit_price });
      }

      const { data: poId, error: poErr } = await supabase.rpc('create_purchase_order', {
        p_supplier_id: supplierId,
        p_items: lineItems,
        p_note: 'AI Slip-Scan'
      });
      if (poErr || !poId) throw poErr || new Error('po create failed');

      // Receives every line in one shot — atomic stock-in + supplier
      // khata update, identical to what "Sab Sahi Hai" promises in the
      // spec (§10).
      const { error: receiveErr } = await supabase.rpc('receive_po_lines', { p_po_id: poId, p_receipts: null });
      if (receiveErr) throw receiveErr;

      onDone();
    } catch {
      showToast(t('common.error'), 'error');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="font-display text-lg text-haldi font-700 mb-4">{t('slipScan.title')}</div>

        {step === 'capture' && (
          <>
            <label className="block text-xs text-chalkdim mb-1">{t('po.supplier')}</label>
            <select className="input mb-4" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <p className="text-chalkdim text-sm mb-5 text-center">{t('slipScan.captureHint')}</p>

            <button
              onClick={() => supplierId ? cameraInputRef.current?.click() : showToast(t('slipScan.supplierFirst'), 'error')}
              className="btn-primary w-full mb-2 text-base py-3"
            >
              {t('slipScan.takePhoto')}
            </button>
            <button
              onClick={() => supplierId ? galleryInputRef.current?.click() : showToast(t('slipScan.supplierFirst'), 'error')}
              className="btn-secondary w-full mb-2"
            >
              {t('slipScan.chooseFromGallery')}
            </button>
            <button onClick={onClose} className="text-chalkdim text-xs underline mt-2 mx-auto block">{t('inventory.cancel')}</button>

            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
          </>
        )}

        {step === 'loading' && (
          <div className="text-center py-14 text-chalkdim text-sm">
            <div className="animate-pulse font-display text-haldi text-base mb-1">{t('slipScan.reading')}</div>
          </div>
        )}

        {step === 'error' && (
          <>
            <div className="text-center py-8 text-mirch text-sm mb-2">{errorMsg}</div>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
              <button onClick={() => setStep('capture')} className="btn-primary flex-1">{t('slipScan.rescan')}</button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="text-xs text-chalkdim mb-3">{t('slipScan.confirmTitle')}</div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="card p-3">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <input
                        className="input py-1 text-sm font-600 flex-1"
                        value={r.name}
                        onChange={e => updateRow(i, { name: e.target.value })}
                      />
                      <button onClick={() => removeRow(i)} className="text-chalkdim hover:text-mirch text-xs shrink-0 mt-1.5">✕</button>
                    </div>
                    <span className={`text-[10px] uppercase inline-block border rounded px-1.5 py-0.5 mb-2 ${r.matched_item_id ? 'text-dhania border-dhania/40' : 'text-haldi border-haldi/40'}`}>
                      {r.matched_item_id ? t('slipScan.matched') : t('slipScan.newItem')}
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-chalkdim mb-0.5">{t('cart.qty')}</label>
                        <input type="number" inputMode="decimal" className="input py-1.5 text-sm" value={r.qty} onChange={e => updateRow(i, { qty: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-chalkdim mb-0.5">{t('po.costPrice')}</label>
                        <input type="number" inputMode="decimal" className="input py-1.5 text-sm" value={r.unit_price} onChange={e => updateRow(i, { unit_price: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div className="text-right font-mono font-700 text-sm mt-2">{fmt(r.qty * r.unit_price)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-3 shrink-0">
              <input className="input flex-1 text-sm" placeholder={t('po.manualItemPlaceholder')} value={manualName} onChange={e => setManualName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManualRow()} />
              <button onClick={addManualRow} className="btn-secondary text-xs px-3 whitespace-nowrap">{t('slipScan.addRow')}</button>
            </div>

            <div className="pt-3 mt-3 border-t border-chalk/10 shrink-0">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-chalkdim">{t('slipScan.total')}</span>
                <span className="font-mono font-800 text-xl text-dhania">{fmt(total)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('capture')} className="btn-secondary flex-1">{t('slipScan.rescan')}</button>
                <button onClick={confirmAndSave} disabled={rows.length === 0 || confirming} className="btn-primary flex-1">
                  {confirming ? t('common.loading') : t('slipScan.confirmBtn')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
