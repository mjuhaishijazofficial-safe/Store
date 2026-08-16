'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { downloadCsv } from '@/lib/csv';
import { useSectionGuard } from '@/lib/use-section-guard';
import { WalletIcon } from '@/components/icons';

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
  const { shopId } = useShop();
  const { showToast } = useToast();
  useSectionGuard('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [savingSupplier, setSavingSupplier] = useState(false);

  useEffect(() => { loadAll(); }, [shopId]);

  async function loadAll() {
    setLoading(true);

    // supplier_balances aggregates in Postgres instead of pulling every
    // ledger row to sum in JS — same scaling reason as khata_balances.
    const [{ data: sups }, { data: bals }] = await Promise.all([
      supabase.from('suppliers').select('*').eq('shop_id', shopId).order('name'),
      supabase.rpc('supplier_balances', { p_shop_id: shopId })
    ]);

    const balMap: Record<string, number> = {};
    (bals || []).forEach((r: any) => { balMap[r.supplier_id] = r.balance; });

    setSuppliers(sups || []);
    setBalances(balMap);
    setLoading(false);
  }

  function openAdd() {
    setForm({ name: '', phone: '' });
    setModalOpen(true);
  }

  async function saveSupplier() {
    // savingSupplier guards against a double-tap double-inserting the
    // same supplier — same duplicate-insert bug already found and fixed
    // for Khata customers and Inventory items earlier.
    if (!form.name.trim() || savingSupplier) return;
    setSavingSupplier(true);
    const { error: err } = await supabase.from('suppliers').insert({
      shop_id: shopId,
      name: form.name.trim(),
      phone: form.phone.trim() || null
    });
    setSavingSupplier(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    showToast(t('settings.saved'), 'success');
    await loadAll();
  }

  const filtered = suppliers
    .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));

  function exportCsv() {
    downloadCsv(
      `suppliers-${new Date().toISOString().slice(0, 10)}.csv`,
      suppliers.map(s => ({
        name: s.name,
        phone: s.phone || '',
        you_owe: balances[s.id] || 0
      }))
    );
  }

  const totalPayable = Object.values(balances).reduce((s, b) => s + Math.max(0, b), 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="font-display text-xl font-700">{t('nav.suppliers')}</h1>
        <button onClick={openAdd} className="btn-primary text-sm px-4 py-2">{t('suppliers.addSupplier')}</button>
      </div>

      {/* Figma stat row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card p-3 text-center"><div className="font-mono font-700 text-lg text-mirch">{fmt(totalPayable)}</div><div className="text-[10px] text-chalkdim mt-0.5">{t('suppliers.totalPayable')}</div></div>
        <div className="card p-3 text-center"><div className="font-mono font-700 text-lg">{suppliers.length}</div><div className="text-[10px] text-chalkdim mt-0.5">{t('suppliers.totalSuppliers')}</div></div>
      </div>

      <div className="flex gap-2 mb-2">
        <input className="input flex-1" placeholder={t('suppliers.search')} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="flex items-center gap-4 mb-4">
        {suppliers.length > 0 && (
          <button onClick={exportCsv} className="text-chalkdim text-xs underline">{t('common.exportCsv')}</button>
        )}
        <Link href="/dashboard/purchase-orders" className="text-chalkdim text-xs underline">{t('nav.purchaseOrders')}</Link>
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
            <Link key={s.id} href={`/dashboard/suppliers/${s.id}`} className="card p-4 flex justify-between items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-mirch/15 text-mirch flex items-center justify-center shrink-0"><WalletIcon className="w-4 h-4" /></div>
                <div className="min-w-0">
                  <div className="font-700 truncate">{s.name}</div>
                  <div className="text-xs text-chalkdim truncate">{s.phone || '—'}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-mono font-700 ${bal > 0 ? 'text-mirch' : 'text-chalkdim'}`}>{fmt(bal)}</div>
                <div className={`text-[10px] uppercase ${bal > 0 ? 'text-mirch' : 'text-dhania'}`}>{bal > 0 ? t('khata.filterUnpaid') : t('suppliers.cleared')}</div>
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
            <label className="block text-xs text-chalkdim mb-1">{t('suppliers.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('suppliers.phone')}</label>
            <input className="input mb-5" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('suppliers.cancel')}</button>
              <button onClick={saveSupplier} disabled={savingSupplier} className="btn-primary flex-1">{savingSupplier ? t('khataDetail.loading') : t('suppliers.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
