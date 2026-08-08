'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { downloadCsv, parseCsv } from '@/lib/csv';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import SaleReceiptModal from '@/components/SaleReceiptModal';
import BarcodeSvg from '@/components/BarcodeSvg';
import PrintBarcodeLabelModal from '@/components/PrintBarcodeLabelModal';
import SaleCartModal from '@/components/SaleCartModal';
import { saveCache, loadCache } from '@/lib/offline-cache';
import { generateInternalBarcode, isValidEan13 } from '@/lib/barcode';
import { useSectionGuard } from '@/lib/use-section-guard';

type Item = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  stock: number;
  min_stock: number;
  price: number;
  cost_price: number;
  barcode: string | null;
  expiry_date: string | null;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function InventoryPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName } = useShop();
  useSectionGuard('inventory');
  const { showToast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [moveItem, setMoveItem] = useState<Item | null>(null);
  const [moveType, setMoveType] = useState<'purchase' | 'sale'>('purchase');
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showingStale, setShowingStale] = useState(false);
  const [receiptTxn, setReceiptTxn] = useState<{ item_name: string; qty: number; unit: string | null; amount: number; created_at: string } | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');
  const [printLabel, setPrintLabel] = useState<{ code: string; name: string } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const [form, setForm] = useState({ name: '', category: '', unit: '', stock: 0, min_stock: 0, price: 0, cost_price: 0, barcode: '', expiry_date: '' });
  const [moveForm, setMoveForm] = useState({ qty: 0, amount: 0 });

  // Box/carton -> pieces helper: stock is always tracked in the item's
  // sellable unit (a "piece"), but stock often arrives in cartons — this
  // is a pure data-entry calculator that fills the same qty/amount
  // fields above, not a separate storage concept, so nothing downstream
  // (record_stock_move, reports, reorder predictions) needs to know
  // boxes exist at all.
  const [boxMode, setBoxMode] = useState(false);
  const [boxCount, setBoxCount] = useState(0);
  const [piecesPerBox, setPiecesPerBox] = useState(1);
  const [costPerBox, setCostPerBox] = useState(0);
  const [updateCostPrice, setUpdateCostPrice] = useState(true);

  useEffect(() => { loadItems(); }, [shopId]);

  const cacheKey = `items:${shopId}`;

  async function loadItems() {
    setLoading(true);
    // resilientFetch (wired into the client in lib/supabase/client.ts)
    // already retries a request that never reached the server, so an
    // `error` here means those retries were exhausted too — worth
    // falling back to whatever was on screen last, rather than an empty
    // "no items" state that looks like the inventory got wiped.
    const { data, error: err } = await supabase.from('items').select('*').eq('shop_id', shopId).order('name');
    if (err) {
      const cached = loadCache<Item[]>(cacheKey);
      if (cached) { setItems(cached); setShowingStale(true); }
      // else: leave whatever was already on screen alone
    } else {
      setItems(data || []);
      setShowingStale(false);
      saveCache(cacheKey, data || []);
    }
    setLoading(false);
  }

  function openAdd(prefillBarcode?: string) {
    setEditing(null);
    setForm({ name: '', category: '', unit: '', stock: 0, min_stock: 0, price: 0, cost_price: 0, barcode: prefillBarcode || '', expiry_date: '' });
    setLookupState('idle');
    setModalOpen(true);
  }

  function openEdit(it: Item) {
    setEditing(it);
    setForm({ name: it.name, category: it.category || '', unit: it.unit || '', stock: it.stock, min_stock: it.min_stock, price: it.price, cost_price: it.cost_price || 0, barcode: it.barcode || '', expiry_date: it.expiry_date || '' });
    setLookupState('idle');
    setModalOpen(true);
  }

  async function handleScanned(code: string) {
    setScannerOpen(false);
    const existing = items.find(i => i.barcode === code);
    if (existing) {
      // Scanning at the counter is almost always "I'm selling this",
      // not "I want to edit its details" — jump straight to Stock Out
      // with quantity ready to type. Edit is one link away inside that
      // modal for the rarer case.
      openMove(existing, 'sale');
      return;
    }

    // A barcode is just an ID number — it never carries a name or price
    // by itself. This is a best-effort lookup against a public product
    // database (Open Food Facts) so a *known* branded product doesn't
    // need its name typed by hand; price is never something any such
    // database can know, that's always the shopkeeper's own to set.
    openAdd(code);
    setLookupState('loading');
    try {
      const res = await fetch(`/api/products/lookup?barcode=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.found) {
        setForm(f => ({ ...f, name: data.name || f.name, category: data.category || f.category }));
        setLookupState('found');
      } else {
        setLookupState('not_found');
      }
    } catch {
      setLookupState('not_found');
    }
  }

  async function saveItem() {
    if (!form.name.trim() || !shopId) return;
    // Empty string vs null matters here: the barcode unique index only
    // excludes NULLs, so two items saved with an empty string would
    // collide on it. expiry_date is a `date` column — Postgres rejects
    // an empty string outright, it has to be null.
    const payload = { ...form, barcode: form.barcode.trim() || null, expiry_date: form.expiry_date || null };
    const { error: err } = editing
      ? await supabase.from('items').update(payload).eq('id', editing.id)
      : await supabase.from('items').insert({ ...payload, shop_id: shopId });

    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    await loadItems();
  }

  async function deleteItem() {
    if (!editing) return;
    const { error: err } = await supabase.from('items').delete().eq('id', editing.id);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    await loadItems();
  }

  function openMove(it: Item, type: 'purchase' | 'sale') {
    setMoveItem(it);
    setMoveType(type);
    setMoveForm({ qty: 0, amount: 0 });
    setBoxMode(false);
    setBoxCount(0);
    setPiecesPerBox(1);
    setCostPerBox(0);
    setUpdateCostPrice(true);
    setMoveOpen(true);
  }

  function recalcFromBox(nextBoxCount: number, nextPiecesPerBox: number, nextCostPerBox: number) {
    setMoveForm({ qty: nextBoxCount * nextPiecesPerBox, amount: nextBoxCount * nextCostPerBox });
  }

  async function confirmMove() {
    if (!moveItem || !shopId || moveForm.qty <= 0) return;

    // Sale amount used to be hardcoded to 0 here — every cash sale
    // recorded through Stock Out landed in `transactions` with no
    // revenue at all, which meant Monthly Sales / Weekly Profit on the
    // Overview and the Reports page were structurally stuck at ₨0
    // regardless of how much a shop actually sold (khata/credit sales
    // are a separate table and were never affected by this bug).
    // Same default the purchase side already used (qty × the item's
    // listed price) now applies to sale too — moveForm.amount is
    // editable in the UI below, for a discount or for the rarer
    // "used, not sold" case where the real amount is 0.
    const amount = moveForm.amount || moveForm.qty * moveItem.price;

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

    if (err) { showToast(t('common.error'), 'error'); return; }

    // Box mode computed a per-piece cost (cost per box / pieces per box)
    // — offer it as the item's new reference cost_price. Not atomic with
    // the stock move above (it's a secondary reference field, not core
    // ledger data), so a failure here doesn't need to roll anything back.
    if (moveType === 'purchase' && boxMode && updateCostPrice && piecesPerBox > 0) {
      await supabase.from('items').update({ cost_price: costPerBox / piecesPerBox }).eq('id', moveItem.id);
    }

    setMoveOpen(false);
    await loadItems();

    // Offer a receipt right at the moment of sale — the natural point
    // to hand one to a customer, not something to dig for afterward in
    // History. Purchases and zero-amount stock-outs (personal use,
    // spoilage) have nothing worth printing.
    if (moveType === 'sale' && amount > 0) {
      setReceiptTxn({ item_name: moveItem.name, qty: moveForm.qty, unit: moveItem.unit, amount, created_at: new Date().toISOString() });
    }
  }

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  function exportCsv() {
    downloadCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      items.map(it => ({
        name: it.name,
        category: it.category || '',
        stock: it.stock,
        unit: it.unit || '',
        min_stock: it.min_stock,
        selling_price: it.price,
        cost_price: it.cost_price,
        barcode: it.barcode || '',
        expiry_date: it.expiry_date || ''
      }))
    );
  }

  // Same column names exportCsv writes (selling_price, not price) so a
  // file round-trips: export, edit in Excel, re-import. Inserted one row
  // at a time rather than a single bulk insert — a barcode collision on
  // one row would fail the whole batch in one SQL statement, and the
  // point of import is that a handful of bad rows in a 200-item sheet
  // shouldn't block the other 195 from landing.
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !shopId) return;

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      showToast(t('inventory.importEmpty'), 'error');
      return;
    }

    setImporting(true);
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      const name = (row.name || '').trim();
      if (!name) { failed++; continue; }
      const payload = {
        shop_id: shopId,
        name,
        category: row.category?.trim() || null,
        unit: row.unit?.trim() || null,
        stock: Number(row.stock) || 0,
        min_stock: Number(row.min_stock) || 0,
        price: Number(row.selling_price ?? row.price) || 0,
        cost_price: Number(row.cost_price) || 0,
        barcode: row.barcode?.trim() || null,
        expiry_date: row.expiry_date?.trim() || null
      };
      const { error: err } = await supabase.from('items').insert(payload);
      if (err) failed++; else ok++;
    }
    setImporting(false);
    await loadItems();

    if (ok > 0 && failed === 0) {
      showToast(t('inventory.importDone').replace('{n}', String(ok)), 'success');
    } else if (ok > 0 && failed > 0) {
      showToast(t('inventory.importPartial').replace('{ok}', String(ok)).replace('{fail}', String(failed)), 'error');
    } else {
      showToast(t('inventory.importFailed'), 'error');
    }
  }

  return (
    <div>
      {/* A real customer visit is almost never one item — this is the
          primary "ring up a sale" path; the per-item Stock Out button
          further down stays for quick single-item corrections. */}
      <button onClick={() => setCartOpen(true)} className="btn-primary w-full mb-3 text-base py-3">{t('cart.newSale')}</button>

      <div className="flex gap-2 mb-2">
        <input className="input flex-1" placeholder={t('inventory.search')} value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={() => setScannerOpen(true)} className="btn-secondary whitespace-nowrap">{t('inventory.scan')}</button>
        <button onClick={() => openAdd()} className="btn-primary whitespace-nowrap">{t('inventory.addNew')}</button>
      </div>

      <div className="flex gap-4 mb-4">
        {items.length > 0 && (
          <button onClick={exportCsv} className="text-chalkdim text-xs underline">{t('common.exportCsv')}</button>
        )}
        <label className="text-chalkdim text-xs underline cursor-pointer">
          {importing ? t('inventory.importing') : t('inventory.importCsv')}
          <input type="file" accept=".csv" className="hidden" onChange={handleImportFile} disabled={importing} />
        </label>
      </div>

      {showingStale && <div className="text-haldi text-xs mb-3">{t('offline.stale')}</div>}

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
          const daysToExpiry = it.expiry_date ? Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / 86400000) : null;
          const expiringSoon = daysToExpiry != null && daysToExpiry <= 30;
          return (
            <div key={it.id} className={`card p-4 ${low || expiringSoon ? 'border-mirch' : ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-700">{it.name}</div>
                  <div className="text-xs text-chalkdim">
                    {it.category || '—'}
                    {it.barcode && isValidEan13(it.barcode) && (
                      <button onClick={() => setPrintLabel({ code: it.barcode!, name: it.name })} className="ml-2 text-chalkdim hover:text-haldi underline">
                        {t('inventory.printLabel')}
                      </button>
                    )}
                  </div>
                </div>
                <div className={`font-mono font-700 text-right ${low ? 'text-mirch' : ''}`}>
                  {it.stock} <span className="block text-[10px] font-normal text-chalkdim">{it.unit}</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-chalkdim mt-2">
                <span>{t('inventory.alertLevel')}: {it.min_stock}</span>
                <span>{fmt(it.price)} / {it.unit}</span>
              </div>
              {expiringSoon && (
                <div className="text-[11px] text-mirch mt-1">
                  {daysToExpiry! < 0 ? `${t('reorder.expiringTitle')} — ${Math.abs(daysToExpiry!)} ${t('reorder.daysAgo')}` : `${t('reorder.expiringTitle')} — ${daysToExpiry} ${t('reorder.expiryDaysLeft')}`}
                </div>
              )}
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
            {lookupState === 'loading' && <div className="text-chalkdim text-xs mb-3">{t('inventory.scanLookingUp')}</div>}
            {lookupState === 'found' && <div className="text-dhania text-xs mb-3">{t('inventory.scanFoundHint')}</div>}
            {lookupState === 'not_found' && <div className="text-chalkdim text-xs mb-3">{t('inventory.scanNotFoundHint')}</div>}
            <label className="block text-xs text-chalkdim mb-1">{t('inventory.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('inventory.category')}</label>
            <input className="input mb-3" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.stock')}</label>
                <input type="number" inputMode="decimal" className="input" value={form.stock} onChange={e => setForm({ ...form, stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.unit')}</label>
                <input className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={t('inventory.unitPlaceholder')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.alertLevel')}</label>
                <input type="number" inputMode="decimal" className="input" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs text-chalkdim mb-1">{t('inventory.sellingPrice')}</label>
                <input type="number" inputMode="decimal" className="input" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-chalkdim mb-1">{t('inventory.costPrice')}</label>
              <input type="number" inputMode="decimal" className="input" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })} />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-chalkdim mb-1">{t('inventory.barcode')}</label>
              <div className="flex gap-2">
                <input className="input flex-1" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, barcode: generateInternalBarcode() })}
                  className="btn-secondary whitespace-nowrap text-xs px-3"
                >
                  {t('inventory.generateBarcode')}
                </button>
              </div>
              {/* Items that never came with a manufacturer barcode (loose
                  rice, sugar sold by weight, house-brand goods) couldn't
                  be scan-to-sell at all before — this mints one and lets
                  the shopkeeper print + stick a label on it themselves. */}
              {form.barcode && isValidEan13(form.barcode) && (
                <div className="mt-2 flex items-center gap-3">
                  <div className="bg-white p-1 rounded shrink-0">
                    <BarcodeSvg code={form.barcode} width={140} height={50} />
                  </div>
                  <button type="button" onClick={() => setPrintLabel({ code: form.barcode, name: form.name })} className="text-xs text-chalkdim hover:text-haldi underline">
                    {t('inventory.printLabel')}
                  </button>
                </div>
              )}
            </div>
            <div className="mb-5">
              <label className="block text-xs text-chalkdim mb-1">{t('inventory.expiryDate')}</label>
              <input type="date" className="input" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
              <div className="text-[11px] text-chalkdim mt-1">{t('inventory.expiryHint')}</div>
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

            {moveType === 'purchase' && (
              <>
                <label className="flex items-center gap-2 text-xs text-chalkdim mb-3">
                  <input type="checkbox" checked={boxMode} onChange={e => setBoxMode(e.target.checked)} />
                  {t('inventory.boxMode')}
                </label>

                {boxMode && (
                  <div className="card p-3 mb-3 bg-board3">
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <label className="block text-[11px] text-chalkdim mb-1">{t('inventory.boxCount')}</label>
                        <input
                          type="number" inputMode="decimal"
                          className="input"
                          value={boxCount}
                          onChange={e => { const v = Number(e.target.value); setBoxCount(v); recalcFromBox(v, piecesPerBox, costPerBox); }}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-chalkdim mb-1">{t('inventory.piecesPerBox')}</label>
                        <input
                          type="number" inputMode="decimal"
                          className="input"
                          value={piecesPerBox}
                          onChange={e => { const v = Number(e.target.value); setPiecesPerBox(v); recalcFromBox(boxCount, v, costPerBox); }}
                        />
                      </div>
                    </div>
                    <label className="block text-[11px] text-chalkdim mb-1">{t('inventory.costPerBox')}</label>
                    <input
                      type="number" inputMode="decimal"
                      className="input mb-2"
                      value={costPerBox}
                      onChange={e => { const v = Number(e.target.value); setCostPerBox(v); recalcFromBox(boxCount, piecesPerBox, v); }}
                    />
                    {piecesPerBox > 0 && costPerBox > 0 && (
                      <div className="text-[11px] text-dhania mb-2">{t('inventory.costPerPieceCalc')} {fmt(costPerBox / piecesPerBox)}</div>
                    )}
                    <label className="flex items-center gap-2 text-[11px] text-chalkdim">
                      <input type="checkbox" checked={updateCostPrice} onChange={e => setUpdateCostPrice(e.target.checked)} />
                      {t('inventory.updateCostPrice')}
                    </label>
                  </div>
                )}
              </>
            )}

            <label className="block text-xs text-chalkdim mb-1">{t('inventory.quantity')} ({moveItem.unit})</label>
            <input type="number" inputMode="decimal" className="input mb-3" value={moveForm.qty} onChange={e => setMoveForm({ ...moveForm, qty: Number(e.target.value) })} />
            <label className="block text-xs text-chalkdim mb-1">
              {moveType === 'purchase' ? t('inventory.totalAmount') : t('inventory.saleAmount')}
            </label>
            <input
              type="number" inputMode="decimal"
              className="input mb-1"
              value={moveForm.amount || ''}
              placeholder={fmt(moveForm.qty * moveItem.price)}
              onChange={e => setMoveForm({ ...moveForm, amount: Number(e.target.value) })}
            />
            {moveType === 'sale' && <div className="text-[11px] text-chalkdim mb-3">{t('inventory.saleAmountHint')}</div>}
            {moveType === 'purchase' && <div className="mb-3" />}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setMoveOpen(false)} className="btn-secondary flex-1">{t('inventory.cancel')}</button>
              <button onClick={confirmMove} className="btn-primary flex-1">{t('inventory.confirm')}</button>
            </div>
            <button
              type="button"
              onClick={() => { setMoveOpen(false); openEdit(moveItem); }}
              className="text-chalkdim text-xs underline mt-3 block text-center w-full"
            >
              {t('inventory.editInstead')}
            </button>
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScannerModal onDetected={handleScanned} onClose={() => setScannerOpen(false)} />
      )}

      {receiptTxn && (
        <SaleReceiptModal shopName={shopName || 'Dukaan'} txn={receiptTxn} onClose={() => setReceiptTxn(null)} />
      )}

      {printLabel && (
        <PrintBarcodeLabelModal code={printLabel.code} itemName={printLabel.name} onClose={() => setPrintLabel(null)} />
      )}

      {cartOpen && (
        <SaleCartModal
          items={items}
          shopName={shopName || 'Dukaan'}
          onClose={() => setCartOpen(false)}
          onDone={loadItems}
        />
      )}
    </div>
  );
}
