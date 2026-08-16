'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import SaleReceiptModal from '@/components/SaleReceiptModal';
import CartReceiptModal from '@/components/CartReceiptModal';
import { useSectionGuard } from '@/lib/use-section-guard';
import { groupHistoryLogs, HistoryLog, isStockInReason, HistoryReason } from '@/lib/history-grouping';

type Log = HistoryLog;

const PAGE_SIZE = 50;

const REASON_OPTIONS: HistoryReason[] = ['sale', 'purchase', 'return', 'transfer_in', 'transfer_out', 'adjustment', 'slip_scan'];

const REASON_LABELS: Record<HistoryReason, (t: (key: any) => string) => string> = {
  purchase: t => t('history.purchaseIn'),
  sale: t => t('history.saleOut'),
  return: t => t('history.returnLabel'),
  transfer_in: t => t('history.transferIn'),
  transfer_out: t => t('history.transferOut'),
  adjustment: t => t('history.adjustmentLabel'),
  slip_scan: t => t('history.slipScanLabel')
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function HistoryPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName, role, receiptPhone, receiptFooter } = useShop();
  const { showToast } = useToast();
  useSectionGuard('history');
  // Return-approve is Owner-only (spec §17/§25-B — a Cashier can't
  // self-approve a return, fraud/misuse prevention).
  const isOwner = role === 'owner';
  const [logs, setLogs] = useState<Log[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [receiptTxn, setReceiptTxn] = useState<Log | null>(null);
  const [receiptGroup, setReceiptGroup] = useState<Log[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [returnFor, setReturnFor] = useState<Log | null>(null);
  const [returnQty, setReturnQty] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returningNow, setReturningNow] = useState(false);

  // Filters (spec: History filterable by item/branch/date/reason). Branch
  // filter only renders when the shop actually has more than one branch
  // — nothing to filter by otherwise. 'all' means unfiltered for every
  // field, matching the RLS-scoped default the page always used to show.
  const [itemOptions, setItemOptions] = useState<{ id: string; name: string }[]>([]);
  const [branchOptions, setBranchOptions] = useState<{ id: string; name: string }[]>([]);
  const [filterItem, setFilterItem] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterReason, setFilterReason] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  useEffect(() => { init(); }, [shopId]);
  // Any filter change re-queries from scratch — same as a fresh page load.
  useEffect(() => { if (shopId) loadLogs(true); }, [filterItem, filterBranch, filterReason, filterFrom, filterTo]);

  async function init() {
    const [{ data: itemRows }, { data: branchRows }] = await Promise.all([
      supabase.from('items').select('id, name').eq('shop_id', shopId).order('name'),
      supabase.from('branches').select('id, name').eq('shop_id', shopId).order('is_main', { ascending: false })
    ]);
    setItemOptions(itemRows || []);
    setBranchOptions(branchRows || []);
    await loadLogs(true);
    setLoading(false);
  }

  // History now reads from stock_movements — the same ledger every
  // stock-affecting flow (sale, return, purchase, slip-scan, transfer,
  // manual adjustment) writes to via record_stock_movement, so this list
  // is guaranteed consistent with actual stock changes instead of being
  // its own separate read of `transactions` that could drift from it.
  // Rows backed by a `transactions` entry (everything except transfers —
  // see confirm_stock_transfer in supabase/schema.sql) are enriched with
  // that row's amount/customer_id/sale_ref so receipts, Khata-aware
  // returns and cart-sale grouping keep working exactly as before.
  async function loadLogs(reset: boolean) {
    const offset = reset ? 0 : logs.length;
    let query = supabase
      .from('stock_movements')
      .select('id, item_id, branch_id, quantity_change, reason, reference_type, reference_id, created_at, items(name, unit)')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filterItem !== 'all') query = query.eq('item_id', filterItem);
    if (filterBranch !== 'all') query = query.eq('branch_id', filterBranch);
    if (filterReason !== 'all') query = query.eq('reason', filterReason);
    if (filterFrom) query = query.gte('created_at', filterFrom);
    if (filterTo) query = query.lte('created_at', `${filterTo}T23:59:59`);

    const { data } = await query;
    const movements = data || [];

    const txnIds = movements.filter(m => m.reference_type === 'transaction' && m.reference_id).map(m => m.reference_id as string);
    let txnById = new Map<string, { amount: number; customer_id: string | null; sale_ref: string | null }>();
    if (txnIds.length > 0) {
      const { data: txns } = await supabase.from('transactions').select('id, amount, customer_id, sale_ref').in('id', txnIds);
      txnById = new Map((txns || []).map(tx => [tx.id, tx]));
    }

    const newRows: Log[] = movements.map((m: any) => {
      const txn = m.reference_type === 'transaction' ? txnById.get(m.reference_id) : null;
      return {
        id: m.id,
        item_id: m.item_id,
        item_name: m.items?.name || '—',
        qty: Math.abs(m.quantity_change),
        unit: m.items?.unit || null,
        type: m.reason as HistoryReason,
        amount: txn?.amount || 0,
        created_at: m.created_at,
        sale_ref: txn?.sale_ref || null,
        customer_id: txn?.customer_id || null
      };
    });

    setLogs(reset ? newRows : prev => [...prev, ...newRows]);
    setHasMore(newRows.length === PAGE_SIZE);
  }

  async function loadMore() {
    setLoadingMore(true);
    await loadLogs(false);
    setLoadingMore(false);
  }

  function openReturn(l: Log) {
    setReturnFor(l);
    setReturnQty(String(l.qty));
    setReturnAmount(String(l.amount));
    setReturnReason('');
  }

  // A return moves stock back in and logs its own transactions row
  // rather than editing the original sale — same "ledger, not undo"
  // convention as every other entry type in this app. A row with
  // customer_id set came from a Khata-mode sale (see record_khata_entry
  // in supabase/schema.sql) — reversing it through record_khata_entry
  // instead of record_stock_move also credits the amount back off that
  // customer's owed balance (spec §25-B: "refund amount cash/khata mein
  // adjust ho"), not just the stock.
  async function confirmReturn() {
    if (!returnFor || !returnFor.item_id) return;
    const qty = Number(returnQty);
    const amount = Number(returnAmount);
    if (!qty || qty <= 0 || !amount || amount < 0) return;

    setReturningNow(true);
    const { error: err } = returnFor.customer_id
      ? await supabase.rpc('record_khata_entry', {
          p_customer_id: returnFor.customer_id,
          p_type: 'return',
          p_item_id: returnFor.item_id,
          p_item_name: returnFor.item_name,
          p_qty: qty,
          p_amount: amount,
          p_note: returnReason.trim() || null,
          // Required — omitting it makes PostgREST unable to pick
          // between record_khata_entry's two live overloads and fail
          // every khata-mode return with an ambiguous-function error.
          p_payment_method: 'cash'
        })
      : await supabase.rpc('record_stock_move', {
          p_item_id: returnFor.item_id,
          p_type: 'return',
          p_qty: qty,
          p_amount: amount,
          p_note: returnReason.trim() || null
        });
    setReturningNow(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setReturnFor(null);
    showToast(t('history.returnSaved'), 'success');
    await loadLogs(true);
  }

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-3">{t('history.title')}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <select className="input text-xs" value={filterItem} onChange={e => setFilterItem(e.target.value)}>
          <option value="all">{t('history.filterItem')}: {t('history.filterAll')}</option>
          {itemOptions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {branchOptions.length > 1 && (
          <select className="input text-xs" value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="all">{t('history.filterBranch')}: {t('history.filterAll')}</option>
            {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select className="input text-xs" value={filterReason} onChange={e => setFilterReason(e.target.value)}>
          <option value="all">{t('history.filterReason')}: {t('history.filterAll')}</option>
          {REASON_OPTIONS.map(r => <option key={r} value={r}>{REASON_LABELS[r](t)}</option>)}
        </select>
        <div className="flex gap-1 col-span-2 sm:col-span-1">
          <input type="date" className="input text-xs" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} title={t('history.filterFrom')} />
          <input type="date" className="input text-xs" value={filterTo} onChange={e => setFilterTo(e.target.value)} title={t('history.filterTo')} />
        </div>
      </div>
      {(filterItem !== 'all' || filterBranch !== 'all' || filterReason !== 'all' || filterFrom || filterTo) && (
        <button
          onClick={() => { setFilterItem('all'); setFilterBranch('all'); setFilterReason('all'); setFilterFrom(''); setFilterTo(''); }}
          className="text-chalkdim text-xs underline mb-4 -mt-2 block"
        >
          {t('history.filterClear')}
        </button>
      )}

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      {!loading && logs.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('history.empty')}</div>
      )}

      <div className="space-y-2">
        {groupHistoryLogs(logs).map(g => {
          // Single-row group: exactly the old flat row, unchanged.
          if (g.rows.length === 1) {
            const l = g.rows[0];
            const d = new Date(l.created_at);
            const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const stockIn = isStockInReason(l.type);
            const sign = stockIn ? '+' : '−';
            const color = l.type === 'purchase' || l.type === 'slip_scan' ? 'text-mirch' : l.type === 'return' || l.type === 'transfer_in' ? 'text-haldi' : 'text-dhania';
            const typeLabel = REASON_LABELS[l.type](t);
            return (
              <div key={g.key} className="card p-3 px-4 flex justify-between items-center">
                <div>
                  <div className="font-600 text-sm">{l.item_name} — {l.qty} {l.unit}</div>
                  <div className="text-xs text-chalkdim mt-0.5">{typeLabel} • {when}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`font-mono font-700 text-sm ${color}`}>
                    {l.amount ? sign + fmt(l.amount) : ''}
                  </div>
                  {l.type === 'sale' && l.amount > 0 && (
                    <button onClick={() => setReceiptTxn(l)} className="text-chalkdim text-xs hover:text-haldi underline shrink-0">
                      {t('receipt.print')}
                    </button>
                  )}
                  {l.type === 'sale' && l.item_id && isOwner && (
                    <button onClick={() => openReturn(l)} className="text-chalkdim text-xs hover:text-haldi underline shrink-0">
                      {t('history.returnAction')}
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // Multi-row group: one cart sale (see SaleCartModal / sale_ref)
          // shown as a single "bill" — expand to see the line items.
          const isOpen = expanded.has(g.key);
          const first = g.rows[0];
          const d = new Date(first.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          const groupTotal = g.rows.reduce((s, r) => s + (r.amount || 0), 0);
          return (
            <div key={g.key} className="card p-3 px-4">
              <button
                className="w-full flex justify-between items-center text-left"
                onClick={() => setExpanded(prev => {
                  const next = new Set(prev);
                  next.has(g.key) ? next.delete(g.key) : next.add(g.key);
                  return next;
                })}
              >
                <div>
                  <div className="font-600 text-sm">{t('history.cartSale').replace('{n}', String(g.rows.length))}</div>
                  <div className="text-xs text-chalkdim mt-0.5">{t('history.saleOut')} • {when}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono font-700 text-sm text-dhania">−{fmt(groupTotal)}</div>
                  <span className="text-chalkdim text-xs">{isOpen ? '▲' : '▼'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="mt-2 pt-2 border-t border-chalk/10 space-y-1.5">
                  {g.rows.map(l => (
                    <div key={l.id} className="flex justify-between items-center text-xs text-chalkdim gap-2">
                      <span>{l.item_name} — {l.qty} {l.unit}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="font-mono">{fmt(l.amount)}</span>
                        {/* Return per line item (spec §25-B: "poora bill
                            ya sirf kuch items") — a cart sale has no
                            single-row return button above, this is it. */}
                        {l.type === 'sale' && l.item_id && isOwner && (
                          <button onClick={() => openReturn(l)} className="hover:text-haldi underline">{t('history.returnAction')}</button>
                        )}
                      </span>
                    </div>
                  ))}
                  <button onClick={() => setReceiptGroup(g.rows)} className="text-chalkdim text-xs hover:text-haldi underline mt-1">
                    {t('receipt.print')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('common.loading') : t('common.loadMore')}
        </button>
      )}

      {receiptTxn && (
        <SaleReceiptModal shopName={shopName || 'Dukaan'} txn={receiptTxn} onClose={() => setReceiptTxn(null)} phone={receiptPhone} footer={receiptFooter} />
      )}

      {receiptGroup && (
        <CartReceiptModal
          shopName={shopName || 'Dukaan'}
          lines={receiptGroup.map(l => ({ item_name: l.item_name, qty: l.qty, unit: l.unit, amount: l.amount }))}
          createdAt={receiptGroup[0].created_at}
          phone={receiptPhone}
          footer={receiptFooter}
          onClose={() => setReceiptGroup(null)}
        />
      )}

      {returnFor && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setReturnFor(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-1">{t('history.returnAction')}</div>
            <p className="text-chalkdim text-xs mb-4">{returnFor.item_name}</p>

            <label className="block text-xs text-chalkdim mb-1">{t('cart.qty')} ({returnFor.unit})</label>
            <input type="number" inputMode="decimal" className="input mb-3" value={returnQty} onChange={e => setReturnQty(e.target.value)} />

            <label className="block text-xs text-chalkdim mb-1">{t('history.refundAmount')}</label>
            <input type="number" inputMode="decimal" className="input mb-1" value={returnAmount} onChange={e => setReturnAmount(e.target.value)} />
            {returnFor.customer_id && <p className="text-[11px] text-chalkdim mb-3">{t('history.returnKhataHint')}</p>}

            <label className="block text-xs text-chalkdim mb-1">{t('history.returnReason')}</label>
            <input className="input mb-5" value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder={t('khataDetail.noteOptional')} />

            <div className="flex gap-2">
              <button onClick={() => setReturnFor(null)} className="btn-secondary flex-1">{t('contact.cancel')}</button>
              <button onClick={confirmReturn} disabled={returningNow} className="btn-primary flex-1">
                {returningNow ? t('common.loading') : t('history.returnAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
