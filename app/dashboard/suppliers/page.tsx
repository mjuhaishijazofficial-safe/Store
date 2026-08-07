'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { ledgerBalancesById } from '@/lib/ledger';

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function SuppliersPage() {
  const supabase = createClient();
  const { t } = useLang();
  const [shopId, setShopId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', phone: '' });

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
    setShopId(profile?.shop_id || null);
    await loadAll(profile?.shop_id);
  }

  async function loadAll(sid?: string | null) {
    const id = sid || shopId;
    if (!id) return;
    setLoading(true);

    const [{ data: sups }, { data: entries }] = await Promise.all([
      supabase.from('suppliers').select('*').eq('shop_id', id).order('name'),
      supabase.from('supplier_entries').select('supplier_id, type, amount').eq('shop_id', id)
    ]);

    setSuppliers(sups || []);
    setBalances(ledgerBalancesById(entries || [], 'supplier_id'));
    setLoading(false);
  }

  function openAdd() {
    setForm({ name: '', phone: '' });
    setError('');
    setModalOpen(true);
  }

  async function saveSupplier() {
    if (!form.name.trim() || !shopId) return;
    const { error: err } = await supabase.from('suppliers').insert({
      shop_id: shopId,
      name: form.name.trim(),
      phone: form.phone.trim() || null
    });
    if (err) { setError(t('common.error')); return; }
    setModalOpen(false);
    await loadAll();
  }

  const filtered = suppliers
    .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder={t('suppliers.search')} value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={openAdd} className="btn-primary whitespace-nowrap">{t('suppliers.addSupplier')}</button>
      </div>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('suppliers.loading')}</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-haldi text-base mb-1">{t('suppliers.emptyTitle')}</div>
          {t('suppliers.emptyBody')}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(s => {
          const bal = balances[s.id] || 0;
          return (
            <Link key={s.id} href={`/dashboard/suppliers/${s.id}`} className="card p-4 flex justify-between items-center">
              <div>
                <div className="font-700">{s.name}</div>
                <div className="text-xs text-chalkdim">{s.phone || '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-chalkdim uppercase">{t('suppliers.youOwe')}</div>
                <div className={`font-mono font-700 ${bal > 0 ? 'text-mirch' : 'text-chalkdim'}`}>{fmt(bal)}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Add Supplier Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('suppliers.newSupplierTitle')}</div>
            {error && <div className="text-mirch text-sm mb-3 bg-mirch/10 p-3 rounded-lg">{error}</div>}
            <label className="block text-xs text-chalkdim mb-1">{t('suppliers.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('suppliers.phone')}</label>
            <input className="input mb-5" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('suppliers.cancel')}</button>
              <button onClick={saveSupplier} className="btn-primary flex-1">{t('suppliers.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
