'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import CartReceiptModal from '@/components/CartReceiptModal';
import { saveCache, loadCache } from '@/lib/offline-cache';
import { useOnlineStatus } from '@/lib/use-online-status';

// POS / Billing Counter (Master Handoff Spec §15) — the fast,
// barcode-scan-first checkout screen every role uses (Owner, Cashier —
// this app is a 2-role model, see supabase/schema.sql §13). Distinct
// from the Inventory page's own SaleCartModal quick-sale (cash-only,
// meant for a single-item correction), this is the dedicated counter
// screen: scan or search → cart → discount (Owner only, spec §17) →
// payment method (Cash/EasyPaisa/JazzCash/Khata) → Bill Complete.

type Item = { id: string; name: string; unit: string | null; stock: number; price: number; barcode: string | null };
type Customer = { id: string; name: string; phone: string | null };
type CartLine = { itemId: string; name: string; unit: string | null; stock: number; qty: number; price: number };
type PaymentMethod = 'cash' | 'easypaisa' | 'jazzcash' | 'khata';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function BillingPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName, role, receiptPhone, receiptFooter, cashierDiscountCapPercent, locked, fbrEnabled, taxRatePercent } = useShop();
  const { showToast } = useToast();
  const isOwner = role === 'owner';

  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleRef, setSaleRef] = useState(() => crypto.randomUUID());

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [receiptLines, setReceiptLines] = useState<{ item_name: string; qty: number; unit: string | null; amount: number }[] | null>(null);
  const online = useOnlineStatus();

  // Spec §33 edge case: "internet chala jaye bill ke beech mein" — a
  // full page reload (not just a connectivity blip, which resilientFetch
  // already retries under the hood — see lib/resilient-fetch.ts) wipes
  // every bit of React state including this cart. This is the
  // lightweight complement to that: the in-progress bill is mirrored to
  // localStorage as it's built, and restored the moment this screen
  // remounts, so a crash/reload/lost-tab mid-bill doesn't lose it. Not a
  // full offline write-queue (spec §28 is a separate, bigger initiative
  // — this app is explicitly single-device-per-shop today) — checkout
  // itself still needs a live connection, it just can't forget what was
  // being billed while one comes back.
  const pendingBillKey = `pending-bill:${shopId}`;
  const restoredRef = useRef(false);

  useEffect(() => { loadAll(); }, [shopId]);

  useEffect(() => {
    if (restoredRef.current || !shopId) return;
    restoredRef.current = true;
    const pending = loadCache<{ cart: CartLine[]; discount: number; method: PaymentMethod; customerId: string }>(pendingBillKey);
    if (pending && pending.cart.length > 0) {
      setCart(pending.cart);
      setDiscount(pending.discount || 0);
      setMethod(pending.method || 'cash');
      setCustomerId(pending.customerId || '');
      showToast(t('pos.restoredBill'), 'success');
    }
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    if (cart.length === 0) { saveCache(pendingBillKey, null); return; }
    saveCache(pendingBillKey, { cart, discount, method, customerId });
  }, [cart, discount, method, customerId, shopId]);

  async function loadAll() {
    setLoading(true);
    const [{ data: itemRows }, { data: custRows }] = await Promise.all([
      supabase.from('items').select('id, name, unit, stock, price, barcode').eq('shop_id', shopId).order('name'),
      supabase.from('customers').select('id, name, phone').eq('shop_id', shopId).order('name')
    ]);
    setItems(itemRows || []);
    setCustomers(custRows || []);
    setLoading(false);
  }

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(i => i.name.toLowerCase().includes(q) || (i.barcode && i.barcode.includes(q))).slice(0, 20);
  }, [search, items]);

  const customerResults = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return [];
    return customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))).slice(0, 10);
  }, [customerSearch, customers]);

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  // Spec §17/§33: a Cashier's discount is capped at an Owner-set % of
  // the bill (0 = none at all); Owner has no cap. maxDiscount below
  // drives both the input clamp and the exact spec-worded block message.
  const maxDiscount = isOwner ? Infinity : subtotal * (cashierDiscountCapPercent / 100);
  const canDiscount = isOwner || cashierDiscountCapPercent > 0;
  // Discount never drives a line's amount negative — the same floor
  // record_stock_move already applies to stock itself.
  const total = Math.max(0, subtotal - Math.min(discount, maxDiscount));
  // FBR hook (spec §25-F) — display/receipt only, on top of `total`;
  // the amount each line RPC records for revenue stays pre-tax (see
  // `factor` in checkout() below), tax collected isn't shop profit.
  const taxAmount = fbrEnabled ? total * (taxRatePercent / 100) : 0;
  const payableTotal = total + taxAmount;
  const selectedCustomer = customers.find(c => c.id === customerId);

  function addItem(it: Item) {
    // Cashier can't bill an item with zero stock at all (spec §33 edge
    // case) — Owner still can, with the same warning shown inline below.
    if (it.stock <= 0 && !isOwner) {
      setCheckoutError(t('pos.stockZeroBlocked'));
      return;
    }
    setCart(prev => {
      const existing = prev.find(l => l.itemId === it.id);
      if (existing) return prev.map(l => l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { itemId: it.id, name: it.name, unit: it.unit, stock: it.stock, qty: 1, price: it.price }];
    });
    setSearch('');
  }

  function handleScanned(code: string) {
    setScannerOpen(false);
    const found = items.find(i => i.barcode === code);
    if (found) addItem(found);
    else setCheckoutError(t('cart.scanNotInInventory'));
  }

  function updateLine(itemId: string, patch: Partial<CartLine>) {
    setCart(prev => prev.map(l => l.itemId === itemId ? { ...l, ...patch } : l));
  }

  function removeLine(itemId: string) {
    setCart(prev => prev.filter(l => l.itemId !== itemId));
  }

  function resetBill() {
    setCart([]);
    setDiscount(0);
    setMethod('cash');
    setCustomerId('');
    setCustomerSearch('');
    setCheckoutError('');
    setSaleRef(crypto.randomUUID());
  }

  async function checkout() {
    if (cart.length === 0) return;
    if (method === 'khata' && !customerId) {
      setCheckoutError(t('pos.selectCustomerRequired'));
      return;
    }

    setCheckingOut(true);
    setCheckoutError('');

    // Discounted total is spread across lines proportionally so each
    // line's own recorded amount (what every report/RPC in this app
    // sums from) still adds up to the discounted total, not the
    // pre-discount subtotal.
    const factor = subtotal > 0 ? total / subtotal : 1;

    const succeeded: CartLine[] = [];
    const remaining: CartLine[] = [];
    for (const line of cart) {
      const amount = line.qty * line.price * factor;
      try {
        // Khata: record_khata_entry both logs the udhaar and deducts
        // stock in one call — calling record_stock_move too would
        // double-deduct. Everything else: record_stock_move logs the
        // sale + deducts stock, same call the Inventory page's own
        // quick-sale (SaleCartModal) already uses, grouped under one
        // sale_ref per this bill.
        const { error: err } = method === 'khata'
          ? await supabase.rpc('record_khata_entry', {
              p_customer_id: customerId,
              p_type: 'purchase',
              p_item_id: line.itemId,
              p_item_name: line.name,
              p_qty: line.qty,
              p_amount: amount,
              p_note: null
            })
          : await supabase.rpc('record_stock_move', {
              p_item_id: line.itemId,
              p_type: 'sale',
              p_qty: line.qty,
              p_amount: amount,
              p_sale_ref: saleRef
            });
        if (err) remaining.push(line); else succeeded.push(line);
      } catch {
        // resilientFetch (lib/resilient-fetch.ts) already retried this
        // through a genuine connectivity blip and gave up — a thrown
        // exception here means the connection is really down, not a
        // one-off. The line stays in `remaining`/the cart (and thus in
        // the localStorage snapshot above) rather than being lost.
        remaining.push(line);
      }
    }

    setCheckingOut(false);
    setCart(remaining);
    if (succeeded.length > 0) await loadAll();

    if (remaining.length > 0) {
      setCheckoutError(remaining.length === cart.length && !online ? t('pos.offlineHint') : t('cart.partialFailure').replace('{n}', String(remaining.length)));
    }
    if (succeeded.length > 0) {
      setReceiptLines(succeeded.map(l => ({ item_name: l.name, qty: l.qty, unit: l.unit, amount: l.qty * l.price * factor })));
    }
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>;

  if (items.length === 0) {
    return (
      <div className="text-center py-14 text-chalkdim text-sm max-w-sm mx-auto">
        <div className="font-display text-haldi text-base mb-1">{t('pos.noItemsTitle')}</div>
        {t('pos.noItemsBody')}
      </div>
    );
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-4">{t('pos.title')}</h1>

      <button onClick={() => setScannerOpen(true)} className="btn-primary w-full mb-2 text-base py-3">{t('pos.scanArea')}</button>
      <input className="input mb-2" placeholder={t('pos.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />

      {results.length > 0 && (
        <div className="card divide-y divide-chalk/10 mb-4 max-h-40 overflow-y-auto">
          {results.map(it => (
            <button key={it.id} onClick={() => addItem(it)} className="w-full text-left p-2.5 px-3 flex justify-between items-center hover:bg-board3">
              <span className="text-sm">{it.name}</span>
              <span className={`text-xs ${it.stock <= 0 ? 'text-mirch' : 'text-chalkdim'}`}>
                {it.stock <= 0 ? t('pos.stockZero') : `${fmt(it.price)} · ${it.stock} ${it.unit || ''}`}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="text-xs text-chalkdim uppercase tracking-wide mb-2">{t('pos.currentBill')}</div>

      {cart.length === 0 ? (
        <div className="text-center py-10 text-chalkdim text-sm mb-4">{t('pos.emptyBill')}</div>
      ) : (
        <div className="space-y-2 mb-4">
          {cart.map(l => {
            const overStock = l.qty > l.stock;
            return (
              <div key={l.itemId} className="card p-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="text-sm font-600">{l.name}</div>
                  <button onClick={() => removeLine(l.itemId)} className="text-chalkdim hover:text-mirch text-xs">✕</button>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => updateLine(l.itemId, { qty: Math.max(1, l.qty - 1) })} className="w-7 h-7 rounded-lg border border-chalk/15 text-sm">−</button>
                  <input
                    type="number" inputMode="decimal"
                    className={`input py-1 text-sm text-center w-16 ${overStock ? 'border-mirch' : ''}`}
                    value={l.qty}
                    onChange={e => updateLine(l.itemId, { qty: Number(e.target.value) })}
                  />
                  <button onClick={() => updateLine(l.itemId, { qty: l.qty + 1 })} className="w-7 h-7 rounded-lg border border-chalk/15 text-sm">+</button>
                  <span className="text-xs text-chalkdim ml-1">{l.unit}</span>
                  <span className="font-mono font-700 text-sm ml-auto">{fmt(l.qty * l.price)}</span>
                </div>
                {overStock && <div className="text-[11px] text-mirch">{t('cart.overStock')} ({l.stock} {l.unit})</div>}
              </div>
            );
          })}
        </div>
      )}

      {cart.length > 0 && (
        <>
          {/* Discount — Owner: unlimited. Cashier: capped at an Owner-set
              % of the bill (Settings > Cashier Discount Limit), 0 by
              default (spec §17: a cashier's own discount needs Owner
              approval unless explicitly opened up). Typing over the cap
              clamps back down to it with the spec's own wording (§33),
              rather than silently accepting a bigger discount. */}
          <div className="mb-3">
            <label className="block text-xs text-chalkdim mb-1">{t('pos.discount')}</label>
            {canDiscount ? (
              <input
                type="number" inputMode="decimal" className="input"
                value={discount || ''}
                onChange={e => {
                  const v = Math.max(0, Number(e.target.value));
                  if (!isOwner && v > maxDiscount) {
                    setDiscount(Math.floor(maxDiscount));
                    setCheckoutError(t('pos.discountCapped').replace('{cap}', String(cashierDiscountCapPercent)));
                  } else {
                    setDiscount(v);
                  }
                }}
                placeholder="0"
              />
            ) : (
              <div className="text-xs text-chalkdim">{t('pos.discountOwnerOnly')}</div>
            )}
          </div>

          <div className="card p-4 mb-3">
            {discount > 0 && (
              <div className="flex justify-between text-xs text-chalkdim mb-1">
                <span>{t('pos.subtotal')}</span>
                <span className="font-mono">{fmt(subtotal)}</span>
              </div>
            )}
            {taxAmount > 0 && (
              <div className="flex justify-between text-xs text-chalkdim mb-1">
                <span>{t('receipt.tax').replace('{rate}', String(taxRatePercent))}</span>
                <span className="font-mono">{fmt(taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm text-chalkdim">{t('pos.total')}</span>
              <span className="font-mono font-800 text-xl text-dhania">{fmt(payableTotal)}</span>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-chalkdim mb-2">{t('pos.paymentMethod')}</label>
            <div className="grid grid-cols-4 gap-2">
              {([
                ['cash', t('pos.cash')],
                ['easypaisa', t('pos.easypaisa')],
                ['jazzcash', t('pos.jazzcash')],
                ['khata', t('pos.khata')]
              ] as [PaymentMethod, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`text-xs py-2 rounded-lg border text-center ${method === m ? 'border-haldi text-haldi font-700' : 'border-chalk/15 text-chalkdim'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {method === 'khata' && (
            <div className="mb-3">
              {selectedCustomer ? (
                <div className="card p-3 flex justify-between items-center">
                  <span className="text-sm font-600">{selectedCustomer.name}</span>
                  <button onClick={() => setCustomerId('')} className="text-xs text-chalkdim hover:text-mirch">✕</button>
                </div>
              ) : (
                <>
                  <input className="input mb-1" placeholder={t('pos.selectCustomer')} value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                  {customerResults.length > 0 && (
                    <div className="card divide-y divide-chalk/10 max-h-32 overflow-y-auto">
                      {customerResults.map(c => (
                        <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }} className="w-full text-left p-2.5 px-3 text-sm hover:bg-board3">
                          {c.name}{c.phone ? ` · ${c.phone}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {checkoutError && <div className="text-mirch text-xs mb-3">{checkoutError}</div>}
          {locked && <div className="text-haldi text-xs mb-3">{t('lock.viewOnly')}</div>}

          <button onClick={checkout} disabled={checkingOut || locked} className="btn-primary w-full text-base py-3">
            {checkingOut ? t('common.loading') : t('pos.billComplete')}
          </button>
        </>
      )}

      {cart.length === 0 && (
        <button onClick={resetBill} className="text-chalkdim text-xs underline block mx-auto mt-2">{t('pos.newBill')}</button>
      )}

      {scannerOpen && <BarcodeScannerModal onDetected={handleScanned} onClose={() => setScannerOpen(false)} />}

      {receiptLines && (
        <CartReceiptModal
          shopName={shopName || 'Dukaan'}
          lines={receiptLines}
          createdAt={new Date().toISOString()}
          phone={receiptPhone}
          footer={receiptFooter}
          taxRatePercent={fbrEnabled ? taxRatePercent : undefined}
          onClose={() => { setReceiptLines(null); resetBill(); }}
        />
      )}
    </div>
  );
}
