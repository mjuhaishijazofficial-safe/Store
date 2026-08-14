'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { usePalette } from '@/lib/palette-context';
import AppLockSettings from '@/components/AppLockSettings';
import { downloadJson } from '@/lib/csv';

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();
  const { shopId, role } = useShop();
  const { showToast } = useToast();
  const { palette, setPalette } = usePalette();
  const isOwner = role === 'owner';
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(0);
  const [receiptPhone, setReceiptPhone] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [discountCap, setDiscountCap] = useState(0);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { init(); }, [shopId]);

  async function init() {
    if (isOwner) {
      const { data: shop } = await supabase.from('shops').select('name, budget, receipt_phone, receipt_footer, cashier_discount_cap_percent').eq('id', shopId).single();
      setName(shop?.name || '');
      setBudget(shop?.budget || 0);
      setReceiptPhone(shop?.receipt_phone || '');
      setReceiptFooter(shop?.receipt_footer || '');
      setDiscountCap(shop?.cashier_discount_cap_percent || 0);
    }
    setLoading(false);
  }

  async function save() {
    const { error: err } = await supabase.from('shops').update({ name, budget }).eq('id', shopId);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
  }

  async function saveDiscountCap() {
    const { error: err } = await supabase.from('shops').update({ cashier_discount_cap_percent: discountCap }).eq('id', shopId);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
  }

  async function saveReceiptBranding() {
    const { error: err } = await supabase.from('shops').update({
      receipt_phone: receiptPhone.trim() || null,
      receipt_footer: receiptFooter.trim() || null
    }).eq('id', shopId);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
  }

  async function exportAllData() {
    setExporting(true);
    try {
      const res = await fetch('/api/export/full');
      if (!res.ok) { showToast(t('common.error'), 'error'); return; }
      const data = await res.json();
      downloadJson(`dukaan-export-${new Date().toISOString().slice(0, 10)}.json`, data);
      // localStorage marker for the "last export" reminder elsewhere —
      // purely a UX nudge, never read for anything security/data-related.
      localStorage.setItem('dukaan:lastExportAt', new Date().toISOString());
    } catch {
      showToast(t('common.error'), 'error');
    }
    setExporting(false);
  }

  async function confirmDelete() {
    if (deleteConfirmText.trim() !== name.trim()) return;
    setDeleting(true);
    setDeleteError('');

    const res = await fetch('/api/account/delete', { method: 'POST' });

    if (!res.ok) {
      setDeleting(false);
      setDeleteError(t('settings.deleteFailed'));
      return;
    }

    // The shop (and this owner's own auth user) are gone server-side —
    // sign out client-side too so no stale session lingers, then send
    // them to the landing page.
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  if (loading) return null;

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">{t('settings.title')}</h1>

      {!isOwner && <div className="text-chalkdim text-sm mb-5">{t('staff.ownerOnly')}</div>}

      {isOwner && (
        <>
          <Link href="/dashboard/settings/subscription" className="card p-4 mb-6 flex items-center justify-between hover:border-haldi">
            <span className="font-600 text-sm">{t('billing.title')}</span>
            <span className="text-chalkdim text-xs">›</span>
          </Link>

          <label className="block text-xs text-chalkdim mb-1">{t('settings.shopName')}</label>
          <input className="input mb-4" value={name} onChange={e => setName(e.target.value)} />

          <label className="block text-xs text-chalkdim mb-1">{t('settings.totalBudget')}</label>
          <input type="number" inputMode="decimal" className="input mb-5" value={budget} onChange={e => setBudget(Number(e.target.value))} />

          <button onClick={save} className="btn-primary">{t('settings.save')}</button>

          <div className="mt-10 pt-6 border-t border-chalk/10">
            <div className="text-xs text-chalkdim uppercase tracking-wide font-700 mb-1">{t('settings.appearance')}</div>
            <div className="text-chalkdim text-xs mb-3">{t('settings.appearanceHint')}</div>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setPalette('navy')}
                className={`card p-3 flex flex-col items-center gap-1.5 text-center ${palette === 'navy' ? 'border-haldi' : ''}`}
              >
                <span className="text-lg leading-none">🔵</span>
                <span className="text-xs font-600">Teal Ledger</span>
                <span className="text-[10px] text-chalkdim">{t('settings.defaultPalette')}</span>
              </button>
              <button
                onClick={() => setPalette('sabz')}
                className={`card p-3 flex flex-col items-center gap-1.5 text-center ${palette === 'sabz' ? 'border-haldi' : ''}`}
              >
                <span className="text-lg leading-none">🟢</span>
                <span className="text-xs font-600">Sada Sabz</span>
              </button>
              <button
                onClick={() => setPalette('spice')}
                className={`card p-3 flex flex-col items-center gap-1.5 text-center ${palette === 'spice' ? 'border-haldi' : ''}`}
              >
                <span className="text-lg leading-none">🟠</span>
                <span className="text-xs font-600">Saffron Bazaar</span>
              </button>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-chalk/10">
            <div className="text-xs text-chalkdim uppercase tracking-wide font-700 mb-1">{t('settings.cashierDiscountCap')}</div>
            <div className="text-chalkdim text-xs mb-3">{t('settings.cashierDiscountCapHint')}</div>
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" min={0} max={100} className="input flex-1" value={discountCap || ''} onChange={e => setDiscountCap(Math.max(0, Math.min(100, Number(e.target.value))))} placeholder="0" />
              <button onClick={saveDiscountCap} className="btn-secondary whitespace-nowrap">{t('settings.save')}</button>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-chalk/10">
            <div className="text-xs text-chalkdim uppercase tracking-wide font-700 mb-1">{t('settings.receiptBranding')}</div>
            <div className="text-chalkdim text-xs mb-3">{t('settings.receiptBrandingHint')}</div>

            <label className="block text-xs text-chalkdim mb-1">{t('settings.receiptPhone')}</label>
            <input className="input mb-3" value={receiptPhone} onChange={e => setReceiptPhone(e.target.value)} placeholder="03xx-xxxxxxx" />

            <label className="block text-xs text-chalkdim mb-1">{t('settings.receiptFooter')}</label>
            <input className="input mb-3" value={receiptFooter} onChange={e => setReceiptFooter(e.target.value)} placeholder={t('receipt.thanks')} />

            <button onClick={saveReceiptBranding} className="btn-secondary w-full">{t('settings.save')}</button>
          </div>
        </>
      )}

      {/* App Lock is a per-device PIN, useful to owner and staff alike
          on a shared counter phone — not gated to owner like the rest
          of this page. */}
      <AppLockSettings />

      {isOwner && (
        <div className="mt-10 pt-6 border-t border-chalk/10">
          <div className="text-xs text-chalkdim uppercase tracking-wide font-700 mb-1">{t('settings.dataBackup')}</div>
          <div className="text-chalkdim text-xs mb-3">{t('settings.dataBackupHint')}</div>
          <button onClick={exportAllData} disabled={exporting} className="btn-secondary w-full">
            {exporting ? t('settings.exporting') : t('settings.exportAllData')}
          </button>
        </div>
      )}

      {isOwner && (
        <div className="mt-10 pt-6 border-t border-mirch/30">
          <div className="text-xs text-mirch uppercase tracking-wide font-700 mb-3">{t('settings.dangerZone')}</div>
          <div className="card p-4 border-mirch/40">
            <div className="font-700 text-sm mb-1">{t('settings.deleteAccountTitle')}</div>
            <div className="text-chalkdim text-xs mb-3">{t('settings.deleteAccountBody')}</div>
            <button
              onClick={() => { setDeleteOpen(true); setDeleteConfirmText(''); setDeleteError(''); }}
              className="text-mirch text-sm font-700 border border-mirch rounded-lg px-4 py-2 w-full hover:bg-mirch/10"
            >
              {t('settings.deleteAccountBtn')}
            </button>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => !deleting && setDeleteOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl border-mirch/40" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-mirch font-700 mb-2">{t('settings.deleteConfirmTitle')}</div>
            <p className="text-chalkdim text-sm mb-3">{t('settings.deleteAccountBody')}</p>
            <label className="block text-xs text-chalkdim mb-1">{t('settings.deleteConfirmBody')} <strong>{name}</strong></label>
            <input
              className="input mb-3"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={t('settings.deleteConfirmPlaceholder')}
            />
            {deleteError && <div className="text-mirch text-sm mb-3">{deleteError}</div>}
            <div className="flex gap-2">
              <button onClick={() => setDeleteOpen(false)} disabled={deleting} className="btn-secondary flex-1">{t('khata.cancel')}</button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmText.trim() !== name.trim()}
                className="flex-1 rounded-lg font-700 text-white bg-mirch disabled:opacity-40 px-4 py-2.5"
              >
                {deleting ? t('settings.deleting') : t('settings.deleteAccountBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
