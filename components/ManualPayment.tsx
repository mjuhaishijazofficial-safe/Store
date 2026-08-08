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

  function legacyCopy() {
    // navigator.clipboard is missing (or silently a no-op) on plenty
    // of in-app browsers — WhatsApp's own webview included — and on
    // any non-HTTPS context. This textarea+execCommand trick is the
    // old but still universally supported fallback for those. iOS
    // Safari specifically ignores a plain .select() on a detached
    // textarea, so setSelectionRange is needed too, not just select().
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  }

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        showToast(t('billing.copied'), 'success');
        return;
      }
    } catch {
      // fall through to the legacy method below
    }

    if (legacyCopy()) {
      showToast(t('billing.copied'), 'success');
    } else {
      showToast(t('common.error'), 'error');
    }
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
  const [busyMethod, setBusyMethod] = useState<'easypaisa' | 'bank' | null>(null);

  async function markPaid(method: 'easypaisa' | 'bank') {
    if (busyMethod) return;
    setBusyMethod(method);

    // Open the tab synchronously, in direct response to the click —
    // mobile browsers only allow window.open without popup-blocking
    // when it happens inside the same tick as the user gesture. Doing
    // this *after* the awaited insert below (the old code) meant the
    // tap looked like it did nothing on phones, so people tapped the
    // other button too, thinking the first one hadn't registered.
    const win = window.open('', '_blank');

    const { error: err } = await supabase.from('payment_claims').insert({
      shop_id: shopId,
      method,
      amount: AMOUNT
    });

    setBusyMethod(null);
    if (err) { win?.close(); showToast(t('common.error'), 'error'); return; }

    const methodLabel = method === 'easypaisa' ? 'EasyPaisa' : 'Bank Transfer (Meezan)';
    const msg = `Payment bhej di hai — ${methodLabel}, ₨${AMOUNT}\nDukaan: ${shopName}\nScreenshot yahin bhej raha/rahi hun.`;
    const url = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    if (win) win.location.href = url;
    else window.location.href = url; // popup fully blocked — fall back to navigating this tab
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
        <button onClick={() => markPaid('easypaisa')} disabled={!!busyMethod} className="btn-primary w-full mt-3">
          {busyMethod === 'easypaisa' ? t('billing.loading') : `${t('billing.ivePaidVia')} EasyPaisa`}
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
        <button onClick={() => markPaid('bank')} disabled={!!busyMethod} className="btn-primary w-full mt-3">
          {busyMethod === 'bank' ? t('billing.loading') : `${t('billing.ivePaidVia')} Meezan Bank`}
        </button>
      </div>

      <div className="text-[11px] text-chalkdim">{t('billing.verifyNote')}</div>
    </div>
  );
}
