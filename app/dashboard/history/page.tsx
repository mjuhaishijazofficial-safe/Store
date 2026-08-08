'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
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
  useSectionGuard('history');
  const [logs, setLogs] = useState<Log[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [receiptTxn, setReceiptTxn] = useState<Log | null>(null);
  const [receiptGroup, setReceiptGroup] = useState<Log[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
            return (
              <div key={g.key} className="card p-3 px-4 flex justify-between items-center">
                <div>
                  <div className="font-600 text-sm">{l.item_name} — {l.qty} {l.unit}</div>
                  <div className="text-xs text-chalkdim mt-0.5">{l.type === 'purchase' ? t('history.purchaseIn') : t('history.saleOut')} • {when}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`font-mono font-700 text-sm ${l.type === 'purchase' ? 'text-mirch' : 'text-dhania'}`}>
                    {l.amount ? sign + fmt(l.amount) : ''}
                  </div>
                  {l.type === 'sale' && l.amount > 0 && (
                    <button onClick={() => setReceiptTxn(l)} className="text-chalkdim text-xs hover:text-haldi underline shrink-0">
                      {t('receipt.print')}
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
    </div>
  );
}
