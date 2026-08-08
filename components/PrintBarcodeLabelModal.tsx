'use client';

import { useEffect } from 'react';
import { useLang } from '@/lib/i18n-context';
import BarcodeSvg from '@/components/BarcodeSvg';

// Same visibility-based print mechanism as SaleReceiptModal — one
// element stays visible, everything else hidden, regardless of which
// page this was opened from. A few copies laid out on one small page
// since a shopkeeper printing a label is almost always sticking it on
// more than one unit of the same item.
export default function PrintBarcodeLabelModal({ code, itemName, onClose }: { code: string; itemName?: string; onClose: () => void }) {
  const { t } = useLang();

  useEffect(() => {
    document.body.classList.add('printing-receipt');
    return () => document.body.classList.remove('printing-receipt');
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print p-4" onClick={onClose}>
      <div className="card w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div id="receipt-print-area" className="p-5">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-dashed border-chalk/25 rounded p-2 flex flex-col items-center bg-white">
                {itemName && <div className="text-[10px] text-black font-600 mb-1 truncate w-full text-center">{itemName}</div>}
                <BarcodeSvg code={code} width={130} height={44} />
              </div>
            ))}
          </div>
        </div>

        <div className="no-print flex gap-2 p-4 pt-0">
          <button onClick={onClose} className="btn-secondary flex-1">{t('contact.cancel')}</button>
          <button onClick={() => window.print()} className="btn-primary flex-1">{t('receipt.print')}</button>
        </div>
      </div>
    </div>
  );
}
