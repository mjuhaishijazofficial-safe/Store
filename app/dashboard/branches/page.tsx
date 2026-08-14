'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useRouter } from 'next/navigation';

// Owner-only branch management (spec §20) — a single-branch shop just
// sees its one "Main Branch" row here; adding a second is what turns on
// Stock Transfer + Manager branch-scoping elsewhere in the nav.
type Branch = { id: string; name: string; address: string | null; is_main: boolean };

export default function BranchesPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();
  const { shopId, role } = useShop();
  const { showToast } = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role !== 'owner') { router.replace('/dashboard'); return; }
    load();
  }, [shopId, role]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('branches').select('id, name, address, is_main').eq('shop_id', shopId).order('is_main', { ascending: false });
    setBranches(data || []);
    setLoading(false);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    const { error: err } = await supabase.from('branches').insert({ shop_id: shopId, name: form.name.trim(), address: form.address.trim() || null });
    setSaving(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    setForm({ name: '', address: '' });
    await load();
  }

  if (role !== 'owner') return null;

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">{t('branches.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{t('branches.subtitle')}</p>

      <button onClick={() => setModalOpen(true)} className="btn-primary w-full mb-5">{t('branches.addNew')}</button>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      <div className="space-y-2">
        {branches.map(b => (
          <div key={b.id} className="card p-4 flex justify-between items-center">
            <div>
              <div className="font-700">{b.name}</div>
              {b.address && <div className="text-xs text-chalkdim">{b.address}</div>}
            </div>
            {b.is_main && <span className="text-[10px] uppercase border border-haldi/40 text-haldi rounded px-1.5 py-0.5">{t('branches.main')}</span>}
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('branches.addNew')}</div>
            <label className="block text-xs text-chalkdim mb-1">{t('branches.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('branches.address')}</label>
            <input className="input mb-5" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('branches.cancel')}</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? t('common.loading') : t('branches.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
