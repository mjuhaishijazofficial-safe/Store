'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';

type Entry = { id: string; type: 'purchase' | 'payment'; item_name: string | null; qty: number | null; amount: number; created_at: string };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function CustomerStatementModal({
  customerId,
  customerName,
  customerPhone,
  shopName,
  onClose
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  shopName: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const { t } = useLang();
  const [entries, setEntries] = useState<Entry[] | null>(null);

  // Full history, unpaginated — a statement means everything, not
  // whatever page the on-screen ledger happens to have loaded — and
  // oldest-first, since a statement reads chronologically (deposit
  // book style), the opposite order from the on-screen list which
  // shows the newest activity first.
  useEffect(() => {
    document.body.classList.add('printing-receipt');
    (async () => {
      const { data } = await supabase
        .from('khata_entries')
        .select('id, type, item_name, qty, amount, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true });
      setEntries(data || []);
    })();
    return () => document.body.classList.remove('printing-receipt');
  }, [customerId]);

  let running = 0;
  const rows = (entries || []).map(e => {
    running += e.type === 'purchase' ? e.amount : -e.amount;
    return { ...e, balance: running };
  });
  const finalBalance = rows.length ? rows[rows.length - 1].balance : 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* A real <table> here, deliberately — the on-screen ledger
            moved away from a grid-based table because per-row CSS grids
            never aligned across rows, but a printed statement is
            exactly where a genuine ruled table is the right convention
            (this is one <table> element, so columns align by
            construction, not by hoping every row computes the same
            "auto" widths). */}
        <div id="receipt-print-area" className="p-6">
          <div className="flex justify-between items-start mb-1">
            <div>
              <div className="font-display font-800 text-lg">{shopName}</div>
              <div className="text-xs text-chalkdim">{t('statement.title')}</div>
            </div>
            <div className="text-right text-xs text-chalkdim">
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div className="border-t border-chalk/20 my-3" />
          <div className="mb-4">
            <div className="font-700">{customerName}</div>
            <div className="text-xs text-chalkdim">{customerPhone || '—'}</div>
          </div>

          {entries === null ? (
            <div className="text-center text-chalkdim text-sm py-8">{t('common.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-chalkdim text-sm py-8">{t('khataDetail.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-chalk/20 text-left text-[11px] text-chalkdim uppercase">
                    <th className="py-2 pr-2 font-500">{t('statement.date')}</th>
                    <th className="py-2 pr-2 font-500">{t('khataDetail.colDetail')}</th>
                    <th className="py-2 pr-2 text-right font-500">{t('khataDetail.colGiven')}</th>
                    <th className="py-2 pr-2 text-right font-500">{t('khataDetail.colPaid')}</th>
                    <th className="py-2 text-right font-500">{t('khataDetail.colBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-chalk/10">
                      <td className="py-2 pr-2 text-xs text-chalkdim whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="py-2 pr-2">
                        {r.type === 'purchase' ? (r.item_name || t('khataDetail.itemDefault')) + (r.qty ? ` — ${r.qty}` : '') : t('khataDetail.paymentLabel')}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono text-mirch tabular-nums">{r.type === 'purchase' ? fmt(r.amount) : ''}</td>
                      <td className="py-2 pr-2 text-right font-mono text-dhania tabular-nums">{r.type === 'payment' ? fmt(r.amount) : ''}</td>
                      <td className="py-2 text-right font-mono font-700 tabular-nums">{fmt(Math.abs(r.balance))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t-2 border-chalk/30 mt-4 pt-3 flex justify-between items-center">
            <div className="font-700">{t('statement.finalBalance')}</div>
            <div className={`font-mono font-800 text-lg ${finalBalance > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(Math.abs(finalBalance))}</div>
          </div>
        </div>

        <div className="no-print flex gap-2 p-4 pt-0">
          <button onClick={onClose} className="btn-secondary flex-1">{t('contact.cancel')}</button>
          <button onClick={() => window.print()} className="btn-primary flex-1" disabled={entries === null}>{t('receipt.print')}</button>
        </div>
      </div>
    </div>
  );
}
