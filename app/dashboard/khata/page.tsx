'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { downloadCsv } from '@/lib/csv';
import { saveCache, loadCache } from '@/lib/offline-cache';
import { useSectionGuard } from '@/lib/use-section-guard';

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number | null;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataPage() {
  const supabase = createClient();
  const { t } = useLang();
  const { shopId } = useShop();
  const { showToast } = useToast();
  useSectionGuard('khata');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [topCustomers, setTopCustomers] = useState<{ customer_id: string; customer_name: string; total_purchases: number }[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showingStale, setShowingStale] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', credit_limit: '' });

  useEffect(() => { loadAll(); }, [shopId]);

  const cacheKey = `khata:${shopId}`;
  type CachedKhata = { customers: Customer[]; balances: Record<string, number>; topCustomers: typeof topCustomers };

  async function loadAll() {
    setLoading(true);

    // khata_balances aggregates in Postgres (grouped sum) instead of
    // pulling every ledger row across every customer to sum in JS —
    // this is what keeps the list fast no matter how many customers or
    // how much history a shop has.
    const [{ data: custs, error: custErr }, { data: bals, error: balErr }, { data: top }] = await Promise.all([
      supabase.from('customers').select('*').eq('shop_id', shopId).order('name'),
      supabase.rpc('khata_balances', { p_shop_id: shopId }),
      supabase.rpc('khata_top_customers', { p_shop_id: shopId, p_limit: 5 })
    ]);

    // Treated as one unit: a partial failure (e.g. balances loaded but
    // customers didn't) would leave the list showing names with no
    // amounts, which is worse than just falling back to the last known
    // full snapshot of both together.
    if (custErr || balErr) {
      const cached = loadCache<CachedKhata>(cacheKey);
      if (cached) {
        setCustomers(cached.customers);
        setBalances(cached.balances);
        setTopCustomers(cached.topCustomers);
        setShowingStale(true);
      }
      setLoading(false);
      return;
    }

    const balMap: Record<string, number> = {};
    (bals || []).forEach((r: any) => { balMap[r.customer_id] = r.balance; });

    setCustomers(custs || []);
    setBalances(balMap);
    setTopCustomers(top || []);
    setShowingStale(false);
    saveCache(cacheKey, { customers: custs || [], balances: balMap, topCustomers: top || [] });
    setLoading(false);
  }

  function openAdd() {
    setForm({ name: '', phone: '', credit_limit: '' });
    setModalOpen(true);
  }

  async function saveCustomer() {
    if (!form.name.trim()) return;
    const { error: err } = await supabase.from('customers').insert({
      shop_id: shopId,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      credit_limit: form.credit_limit ? Number(form.credit_limit) : null
    });
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    await loadAll();
  }

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));

  function exportCsv() {
    downloadCsv(
      `khata-${new Date().toISOString().slice(0, 10)}.csv`,
      customers.map(c => ({
        name: c.name,
        phone: c.phone || '',
        balance: balances[c.id] || 0,
        credit_limit: c.credit_limit ?? ''
      }))
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input className="input flex-1" placeholder={t('khata.search')} value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={openAdd} className="btn-primary whitespace-nowrap">{t('khata.addCustomer')}</button>
      </div>

      {customers.length > 0 && (
        <button onClick={exportCsv} className="text-chalkdim text-xs underline mb-4 block">{t('common.exportCsv')}</button>
      )}

      {!loading && topCustomers.length > 0 && (
        <>
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-2">{t('khata.topCustomers')}</div>
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {topCustomers.map((c, i) => (
            <Link
              key={c.customer_id}
              href={`/dashboard/khata/${c.customer_id}`}
              className="card px-3 py-2 flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <span className="text-haldi font-mono font-700 text-xs">#{i + 1}</span>
              <div>
                <div className="text-xs font-700">{c.customer_name}</div>
                <div className="text-[10px] text-chalkdim font-mono">{fmt(c.total_purchases)}</div>
              </div>
            </Link>
          ))}
        </div>
        </>
      )}

      {showingStale && <div className="text-haldi text-xs mb-3">{t('offline.stale')}</div>}

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('khata.loading')}</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-haldi text-base mb-1">{t('khata.emptyTitle')}</div>
          {t('khata.emptyBody')}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(c => {
          const bal = balances[c.id] || 0;
          const over = c.credit_limit != null && bal > c.credit_limit;
          return (
            <Link key={c.id} href={`/dashboard/khata/${c.id}`} className={`card p-4 flex justify-between items-center ${over ? 'border-mirch' : ''}`}>
              <div>
                <div className="font-700">{c.name}</div>
                <div className="text-xs text-chalkdim">{c.phone || '—'}</div>
              </div>
              <div className="text-right">
                <div className={`font-mono font-700 ${bal > 0 ? 'text-mirch' : bal < 0 ? 'text-dhania' : 'text-chalkdim'}`}>{fmt(Math.abs(bal))}</div>
                {bal < 0 && <div className="text-[10px] text-dhania">{t('khataDetail.advanceBalance')}</div>}
                {over && <div className="text-[10px] text-mirch">{t('khata.overLimit')}</div>}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Add Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('khata.newCustomerTitle')}</div>
            <label className="block text-xs text-chalkdim mb-1">{t('khata.name')}</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">{t('khata.phone')}</label>
            <input className="input mb-3" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            <label className="block text-xs text-chalkdim mb-1">{t('khata.creditLimit')}</label>
            <input type="number" inputMode="decimal" className="input mb-5" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">{t('khata.cancel')}</button>
              <button onClick={saveCustomer} className="btn-primary flex-1">{t('khata.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
