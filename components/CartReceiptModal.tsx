'use client';

import { useEffect } from 'react';
import { useLang } from '@/lib/i18n-context';

type ReceiptLine = { item_name: string; qty: number; unit: string | null; amount: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// Same visibility-based print mechanism as SaleReceiptModal, generalized
// to N lines — used for a multi-item cart sale (see SaleCartModal), where
// SaleReceiptModal's single-txn shape doesn't fit.
export default function CartReceiptModal({
  shopName,
  lines,
  createdAt,
  onClose
}: {
  shopName: string;
  lines: ReceiptLine[];
  createdAt: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const d = new Date(createdAt);
  const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const total = lines.reduce((s, l) => s + l.amount, 0);

  useEffect(() => {
    document.body.classList.add('printing-receipt');
    return () => document.body.classList.remove('printing-receipt');
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print" onClick={onClose}>
      <div className="card w-full max-w-xs overflow-hidden" onClick={e => e.stopPropagation()}>
        <div id="receipt-print-area" className="p-6 font-mono">
          <div className="text-center font-display font-800 text-base mb-1">{shopName}</div>
          <div className="text-center text-[11px] text-chalkdim mb-4">{when}</div>
          <div className="border-t border-dashed border-chalk/30 my-2" />
          {lines.map((l, i) => {
            const unitPrice = l.qty > 0 ? l.amount / l.qty : l.amount;
            return (
              <div key={i} className="mb-2">
                <div className="text-sm font-600">{l.item_name}</div>
                <div className="flex justify-between text-xs text-chalkdim">
                  <span>{l.qty} {l.unit} × {fmt(unitPrice)}</span>
                  <span>{fmt(l.amount)}</span>
                </div>
              </div>
            );
          })}
          <div className="border-t border-dashed border-chalk/30 my-2" />
          <div className="flex justify-between font-700 text-base">
            <span>{t('receipt.total')}</span>
            <span>{fmt(total)}</span>
          </div>
          <div className="text-center text-[11px] text-chalkdim mt-5">{t('receipt.thanks')}</div>
        </div>

        <div className="no-print flex gap-2 p-4 pt-0">
          <button onClick={onClose} className="btn-secondary flex-1">{t('contact.cancel')}</button>
          <button onClick={() => window.print()} className="btn-primary flex-1">{t('receipt.print')}</button>
        </div>
      </div>
    </div>
  );
}
