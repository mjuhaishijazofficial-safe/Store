'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';

export default function SettingsPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, role } = useShop();
  const isOwner = role === 'owner';
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

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
    if (err) { setError(t('common.error')); return; }
    setError('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
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
      {saved && <div className="text-dhania text-sm mt-3">{t('settings.saved')}</div>}
      {error && <div className="text-mirch text-sm mt-3">{error}</div>}
    </div>
  );
}
