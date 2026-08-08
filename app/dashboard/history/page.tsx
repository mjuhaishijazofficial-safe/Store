'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import SaleReceiptModal from '@/components/SaleReceiptModal';
import CartReceiptModal from '@/components/CartReceiptModal';
import { useSectionGuard } from '@/lib/use-section-guard';
import { groupHistoryLogs, HistoryLog } from '@/lib/history-grouping';

type Log = HistoryLog;

const PAGE_SIZE = 50;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function HistoryPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName } = useShop();
  const { showToast } = useToast();
  useSectionGuard('history');
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
  const [returningNow, setReturningNow] = useState(false);

  useEffect(() => { init(); }, [shopId]);

  async function init() {
    await loadLogs(true);
    setLoading(false);
  }

  async function loadLogs(reset: boolean) {
    const offset = reset ? 0 : logs.length;
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const newRows = data || [];
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
  }

  // A return moves stock back in (record_stock_move handles that the
  // same way a purchase does) and logs its own transactions row rather
  // than editing the original sale — same "ledger, not undo" convention
  // as every other entry type in this app.
  async function confirmReturn() {
    if (!returnFor || !returnFor.item_id) return;
    const qty = Number(returnQty);
    const amount = Number(returnAmount);
    if (!qty || qty <= 0 || !amount || amount < 0) return;

    setReturningNow(true);
    const { error: err } = await supabase.rpc('record_stock_move', {
      p_item_id: returnFor.item_id,
      p_type: 'return',
      p_qty: qty,
      p_amount: amount
    });
    setReturningNow(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setReturnFor(null);
    showToast(t('history.returnSaved'), 'success');
    await loadLogs(true);
  }

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">{t('history.title')}</h1>

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
            const sign = l.type === 'purchase' ? '+' : '−';
            const color = l.type === 'purchase' ? 'text-mirch' : l.type === 'return' ? 'text-haldi' : 'text-dhania';
            const typeLabel = l.type === 'purchase' ? t('history.purchaseIn') : l.type === 'return' ? t('history.returnLabel') : t('history.saleOut');
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
                  {l.type === 'sale' && l.item_id && (
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
                    <div key={l.id} className="flex justify-between text-xs text-chalkdim">
                      <span>{l.item_name} — {l.qty} {l.unit}</span>
                      <span className="font-mono">{fmt(l.amount)}</span>
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
        <SaleReceiptModal shopName={shopName || 'Dukaan'} txn={receiptTxn} onClose={() => setReceiptTxn(null)} />
      )}

      {receiptGroup && (
        <CartReceiptModal
          shopName={shopName || 'Dukaan'}
          lines={receiptGroup.map(l => ({ item_name: l.item_name, qty: l.qty, unit: l.unit, amount: l.amount }))}
          createdAt={receiptGroup[0].created_at}
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
            <input type="number" inputMode="decimal" className="input mb-5" value={returnAmount} onChange={e => setReturnAmount(e.target.value)} />

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
