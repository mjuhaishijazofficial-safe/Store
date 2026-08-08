'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { SUPPORT_WHATSAPP_NUMBER } from '@/lib/constants';

type Details = {
  easypaisaNumber: string;
  easypaisaTitle: string;
  meezanTitle: string;
  meezanAccount: string;
  meezanIban: string;
  meezanBranch: string;
};

const AMOUNT = 999;

function Row({ label, value }: { label: string; value: string }) {
  const { showToast } = useToast();
  const { t } = useLang();

  async function copy() {
    await navigator.clipboard.writeText(value);
    showToast(t('billing.copied'), 'success');
  }

  return (
    <div className="flex justify-between items-center py-2">
      <div>
        <div className="text-[10px] text-chalkdim uppercase tracking-wide">{label}</div>
        <div className="font-mono text-sm font-700">{value}</div>
      </div>
      <button onClick={copy} className="text-[11px] text-haldi underline shrink-0 ml-3">{t('billing.copy')}</button>
    </div>
  );
}

export default function ManualPayment({ details, pending }: { details: Details; pending: boolean }) {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName } = useShop();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function markPaid(method: 'easypaisa' | 'bank') {
    setBusy(true);
    const { error: err } = await supabase.from('payment_claims').insert({
      shop_id: shopId,
      method,
      amount: AMOUNT
    });
    setBusy(false);
    if (err) { showToast(t('common.error'), 'error'); return; }

    const methodLabel = method === 'easypaisa' ? 'EasyPaisa' : 'Bank Transfer (Meezan)';
    const msg = `Payment bhej di hai — ${methodLabel}, ₨${AMOUNT}\nDukaan: ${shopName}\nScreenshot yahin bhej raha/rahi hun.`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
    showToast(t('billing.claimSubmitted'), 'success');
  }

  if (pending) {
    return (
      <div className="card p-5 border-haldi">
        <div className="font-display font-700 text-haldi mb-1">{t('billing.pendingTitle')}</div>
        <div className="text-sm text-chalkdim">{t('billing.pendingBody')}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm text-chalkdim mb-4">{t('billing.manualIntro')}</div>

      <div className="card p-4 mb-3">
        <div className="font-display font-700 text-haldi mb-2">{t('billing.easypaisa')}</div>
        <div className="divide-y divide-chalk/10">
          <Row label={t('billing.accountNumber')} value={details.easypaisaNumber} />
          <Row label={t('billing.accountTitle')} value={details.easypaisaTitle} />
        </div>
        <button onClick={() => markPaid('easypaisa')} disabled={busy} className="btn-primary w-full mt-3">
          {t('billing.ivePaidVia')} EasyPaisa
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="font-display font-700 text-haldi mb-2">{t('billing.bankTransfer')}</div>
        <div className="divide-y divide-chalk/10">
          <Row label={t('billing.accountTitle')} value={details.meezanTitle} />
          <Row label={t('billing.accountNumber')} value={details.meezanAccount} />
          <Row label={t('billing.iban')} value={details.meezanIban} />
          {details.meezanBranch && <Row label={t('billing.branch')} value={details.meezanBranch} />}
        </div>
        <button onClick={() => markPaid('bank')} disabled={busy} className="btn-primary w-full mt-3">
          {t('billing.ivePaidVia')} Meezan Bank
        </button>
      </div>

      <div className="text-[11px] text-chalkdim">{t('billing.verifyNote')}</div>
    </div>
  );
}
