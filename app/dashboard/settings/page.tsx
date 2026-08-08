'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();
  const { shopId, role } = useShop();
  const { showToast } = useToast();
  const isOwner = role === 'owner';
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(0);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => { init(); }, [shopId]);

  async function init() {
    if (isOwner) {
      const { data: shop } = await supabase.from('shops').select('name, budget').eq('id', shopId).single();
      setName(shop?.name || '');
      setBudget(shop?.budget || 0);
    }
    setLoading(false);
  }

  async function save() {
    const { error: err } = await supabase.from('shops').update({ name, budget }).eq('id', shopId);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
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

  if (!isOwner) {
    return <div className="text-chalkdim text-sm py-10 text-center">{t('staff.ownerOnly')}</div>;
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">{t('settings.title')}</h1>

      <label className="block text-xs text-chalkdim mb-1">{t('settings.shopName')}</label>
      <input className="input mb-4" value={name} onChange={e => setName(e.target.value)} />

      <label className="block text-xs text-chalkdim mb-1">{t('settings.totalBudget')}</label>
      <input type="number" className="input mb-5" value={budget} onChange={e => setBudget(Number(e.target.value))} />

      <button onClick={save} className="btn-primary">{t('settings.save')}</button>

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
