'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import BarcodeScannerModal from './BarcodeScannerModal';
import CartReceiptModal from './CartReceiptModal';

type SourceItem = { id: string; name: string; unit: string | null; stock: number; price: number; barcode: string | null };
type CartLine = { itemId: string; name: string; unit: string | null; stock: number; qty: number; price: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function SaleCartModal({
  items,
  shopName,
  onClose,
  onDone
}: {
  items: SourceItem[];
  shopName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const { t } = useLang();

  // One id per checkout session, not per attempt — a retry after a
  // partial failure (see checkout()) is still logically the same sale,
  // so its remaining lines should land under the same sale_ref as the
  // lines that already went through.
  const [saleRef] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [receiptLines, setReceiptLines] = useState<{ item_name: string; qty: number; unit: string | null; amount: number }[] | null>(null);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(i => i.name.toLowerCase().includes(q) || (i.barcode && i.barcode.includes(q))).slice(0, 20);
  }, [search, items]);

  const total = cart.reduce((s, l) => s + l.qty * l.price, 0);

  function addItem(it: SourceItem) {
    setCart(prev => {
      const existing = prev.find(l => l.itemId === it.id);
      if (existing) {
        return prev.map(l => l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, { itemId: it.id, name: it.name, unit: it.unit, stock: it.stock, qty: 1, price: it.price }];
    });
    setSearch('');
  }

  function handleScanned(code: string) {
    setScannerOpen(false);
    const found = items.find(i => i.barcode === code);
    if (found) {
      addItem(found);
    } else {
      setCheckoutError(t('cart.scanNotInInventory'));
    }
  }

  function updateLine(itemId: string, patch: Partial<CartLine>) {
    setCart(prev => prev.map(l => l.itemId === itemId ? { ...l, ...patch } : l));
  }

  function removeLine(itemId: string) {
    setCart(prev => prev.filter(l => l.itemId !== itemId));
  }

  async function checkout() {
    if (cart.length === 0) return;
    setCheckingOut(true);
    setCheckoutError('');

    // Each line is its own atomic record_stock_move call (stock update +
    // transaction insert together) — same as a single Stock Out always
    // has been. There's no single wrapping transaction across the whole
    // cart, so a mid-cart failure (one item deleted by another device
    // mid-sale, say) can leave some lines committed and others not. That's
    // handled explicitly below: succeeded lines are removed from the
    // cart and already-printed-worthy, the rest stay so the cashier can
    // fix and retry just those, instead of the whole sale silently
    // failing or double-charging on retry.
    const succeeded: CartLine[] = [];
    const remaining: CartLine[] = [];
    for (const line of cart) {
      const { error: err } = await supabase.rpc('record_stock_move', {
        p_item_id: line.itemId,
        p_type: 'sale',
        p_qty: line.qty,
        p_amount: line.qty * line.price,
        p_sale_ref: saleRef
      });
      if (err) remaining.push(line); else succeeded.push(line);
    }

    setCheckingOut(false);
    setCart(remaining);
    onDone();

    if (remaining.length > 0) {
      setCheckoutError(t('cart.partialFailure').replace('{n}', String(remaining.length)));
    }
    if (succeeded.length > 0) {
      setReceiptLines(succeeded.map(l => ({ item_name: l.name, qty: l.qty, unit: l.unit, amount: l.qty * l.price })));
    }
  }

  if (receiptLines) {
    return (
      <CartReceiptModal
        shopName={shopName || 'Dukaan'}
        lines={receiptLines}
        createdAt={new Date().toISOString()}
        onClose={() => {
          setReceiptLines(null);
          if (cart.length === 0) onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="font-display text-lg text-haldi font-700 mb-4">{t('cart.title')}</div>

        <div className="flex gap-2 mb-2 shrink-0">
          <input
            className="input flex-1"
            placeholder={t('cart.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button onClick={() => setScannerOpen(true)} className="btn-secondary whitespace-nowrap">{t('inventory.scan')}</button>
        </div>

        {results.length > 0 && (
          <div className="card divide-y divide-chalk/10 mb-3 max-h-40 overflow-y-auto shrink-0">
            {results.map(it => (
              <button key={it.id} onClick={() => addItem(it)} className="w-full text-left p-2.5 px-3 flex justify-between items-center hover:bg-board3">
                <span className="text-sm">{it.name}</span>
                <span className="text-xs text-chalkdim">{fmt(it.price)} · {it.stock} {it.unit}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {cart.length === 0 ? (
            <div className="text-center py-10 text-chalkdim text-sm">{t('cart.empty')}</div>
          ) : (
            <div className="space-y-2">
              {cart.map(l => {
                const overStock = l.qty > l.stock;
                return (
                  <div key={l.itemId} className="card p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-sm font-600">{l.name}</div>
                      <button onClick={() => removeLine(l.itemId)} className="text-chalkdim hover:text-mirch text-xs">✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-chalkdim mb-0.5">{t('cart.qty')} ({l.unit})</label>
                        <input
                          type="number" inputMode="decimal"
                          className={`input py-1.5 text-sm ${overStock ? 'border-mirch' : ''}`}
                          value={l.qty}
                          onChange={e => updateLine(l.itemId, { qty: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-chalkdim mb-0.5">{t('cart.unitPrice')}</label>
                        <input
                          type="number" inputMode="decimal"
                          className="input py-1.5 text-sm"
                          value={l.price}
                          onChange={e => updateLine(l.itemId, { price: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      {overStock ? (
                        <span className="text-[11px] text-mirch">{t('cart.overStock')} ({l.stock} {l.unit})</span>
                      ) : <span />}
                      <span className="font-mono font-700 text-sm">{fmt(l.qty * l.price)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {checkoutError && <div className="text-mirch text-xs mt-3 shrink-0">{checkoutError}</div>}

        <div className="pt-3 mt-3 border-t border-chalk/10 shrink-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-chalkdim">{t('cart.total')}</span>
            <span className="font-mono font-800 text-xl text-dhania">{fmt(total)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
            <button onClick={checkout} disabled={cart.length === 0 || checkingOut} className="btn-primary flex-1">
              {checkingOut ? t('common.loading') : t('cart.completeSale')}
            </button>
          </div>
        </div>
      </div>

      {scannerOpen && (
        // Stops a scanner-backdrop click (which only means "dismiss the
        // scanner") from continuing to bubble into this modal's own
        // outer onClick={onClose} and closing the whole cart with it.
        <div onClick={e => e.stopPropagation()}>
          <BarcodeScannerModal onDetected={handleScanned} onClose={() => setScannerOpen(false)} />
        </div>
      )}
    </div>
  );
}
