'use client';

import { useEffect } from 'react';
import { useLang } from '@/lib/i18n-context';
import ThermalPrintButton from './ThermalPrintButton';

type ReceiptTxn = {
  item_name: string;
  qty: number;
  unit: string | null;
  amount: number;
  created_at: string;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function SaleReceiptModal({
  shopName, txn, onClose, phone, footer
}: { shopName: string; txn: ReceiptTxn; onClose: () => void; phone?: string | null; footer?: string | null }) {
  const { t } = useLang();
  const d = new Date(txn.created_at);
  const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const unitPrice = txn.qty > 0 ? txn.amount / txn.qty : txn.amount;
  const thanksMsg = footer || t('receipt.thanks');

  // .printing-receipt (paired with the #receipt-print-area rule in
  // globals.css) is what makes window.print() output just the receipt
  // instead of whatever page it was opened from — removed on unmount so
  // it never leaks into an unrelated print later in the session.
  useEffect(() => {
    document.body.classList.add('printing-receipt');
    return () => document.body.classList.remove('printing-receipt');
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print" onClick={onClose}>
      <div className="card w-full max-w-xs overflow-hidden" onClick={e => e.stopPropagation()}>
        <div id="receipt-print-area" className="p-6 font-mono">
          <div className="text-center font-display font-800 text-base mb-1">{shopName}</div>
          {phone && <div className="text-center text-[11px] text-chalkdim">{phone}</div>}
          <div className="text-center text-[11px] text-chalkdim mb-4">{when}</div>
          <div className="border-t border-dashed border-chalk/30 my-2" />
          <div className="text-sm font-600 mb-1">{txn.item_name}</div>
          <div className="flex justify-between text-xs text-chalkdim mb-2">
            <span>{txn.qty} {txn.unit} × {fmt(unitPrice)}</span>
            <span>{fmt(txn.amount)}</span>
          </div>
          <div className="border-t border-dashed border-chalk/30 my-2" />
          <div className="flex justify-between font-700 text-base">
            <span>{t('receipt.total')}</span>
            <span>{fmt(txn.amount)}</span>
          </div>
          <div className="text-center text-[11px] text-chalkdim mt-5">{thanksMsg}</div>
        </div>

        <div className="no-print flex flex-col gap-2 p-4 pt-0">
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">{t('contact.cancel')}</button>
            <button onClick={() => window.print()} className="btn-primary flex-1">{t('receipt.print')}</button>
          </div>
          <ThermalPrintButton shopName={shopName} lines={[{ name: txn.item_name, qty: txn.qty, unit: txn.unit, amount: txn.amount }]} when={when} footer={thanksMsg} />
        </div>
      </div>
    </div>
  );
}
