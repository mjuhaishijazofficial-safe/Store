'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { downloadCsv, parseCsv } from '@/lib/csv';
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
  const { shopId, role, branchId } = useShop();
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
  const [duplicateOf, setDuplicateOf] = useState<Customer | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  // Bulk import (spec §25-J): parsed rows sit in a preview the Owner
  // must confirm before anything is written — never insert straight off
  // a file select, since a mis-mapped column would otherwise silently
  // create wrong opening balances for every customer at once.
  const [importPreview, setImportPreview] = useState<{ name: string; phone: string; opening_balance: number }[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  // Figma match — "Add Credit"/"Record Payment" at the top of the list
  // itself, not buried behind opening a customer's own detail page
  // first. Reuses record_khata_entry (no item_id — this isn't linked to
  // a specific inventory line), same RPC the customer detail page's own
  // "Naya Udhaar Entry"/"Payment Wasool Hui" already call.
  const [quickEntry, setQuickEntry] = useState<'credit' | 'payment' | null>(null);
  const [quickCustomerId, setQuickCustomerId] = useState('');
  const [quickCustomerSearch, setQuickCustomerSearch] = useState('');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [savingQuickEntry, setSavingQuickEntry] = useState(false);

  useEffect(() => { loadAll(); }, [shopId]);

  const cacheKey = `khata:${shopId}`;
  type CachedKhata = { customers: Customer[]; balances: Record<string, number>; topCustomers: typeof topCustomers };

  async function loadAll() {
    setLoading(true);

    // khata_balances aggregates in Postgres (grouped sum) instead of
    // pulling every ledger row across every customer to sum in JS —
    // this is what keeps the list fast no matter how many customers or
    // how much history a shop has.
    // Manager sees their own branch's customers (spec §17/§20) — the
    // balance/top-customer RPCs stay shop-wide for now (a small,
    // disclosed gap: they're aggregates, not a list of records, lower
    // risk than showing customer rows across branches).
    let custQuery = supabase.from('customers').select('*').eq('shop_id', shopId);
    if (role === 'manager' && branchId) custQuery = custQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
    const [{ data: custs, error: custErr }, { data: bals, error: balErr }, { data: top }] = await Promise.all([
      custQuery.order('name'),
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
    setDuplicateOf(null);
    setModalOpen(true);
  }

  // Spec §33 edge case: suggest the existing customer instead of
  // silently creating a second "Ali Traders" — same name (case/space
  // insensitive) is the signal, not an exact string match, since that's
  // how a shopkeeper would actually recognize a duplicate.
  function findDuplicate(name: string) {
    const q = name.trim().toLowerCase();
    return customers.find(c => c.name.trim().toLowerCase() === q) || null;
  }

  async function saveCustomer(force = false) {
    // Guards against a duplicate insert from a double-tap or slow
    // connection encouraging a second tap — nothing previously stopped
    // "Save"/"Add Anyway" from firing more than once while the first
    // request was still in flight.
    if (!form.name.trim() || savingCustomer) return;
    if (!force) {
      const dup = findDuplicate(form.name);
      if (dup) { setDuplicateOf(dup); return; }
    }
    setSavingCustomer(true);
    const { error: err } = await supabase.from('customers').insert({
      shop_id: shopId,
      branch_id: branchId,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      credit_limit: form.credit_limit ? Number(form.credit_limit) : null
    });
    setSavingCustomer(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setModalOpen(false);
    setDuplicateOf(null);
    await loadAll();
  }

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .filter(c => {
      if (statusFilter === 'all') return true;
      const bal = balances[c.id] || 0;
      return statusFilter === 'unpaid' ? bal > 0 : bal <= 0;
    })
    .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));

  function openQuickEntry(kind: 'credit' | 'payment') {
    setQuickEntry(kind);
    setQuickCustomerId('');
    setQuickCustomerSearch('');
    setQuickAmount('');
    setQuickNote('');
  }

  const quickCustomerResults = quickCustomerSearch.trim()
    ? customers.filter(c => c.name.toLowerCase().includes(quickCustomerSearch.trim().toLowerCase())).slice(0, 8)
    : [];

  async function saveQuickEntry() {
    const amount = Number(quickAmount);
    if (!quickCustomerId || !amount || amount <= 0 || savingQuickEntry) return;
    setSavingQuickEntry(true);
    const { error: err } = await supabase.rpc('record_khata_entry', {
      p_customer_id: quickCustomerId,
      p_type: quickEntry === 'credit' ? 'purchase' : 'payment',
      p_item_id: null,
      p_item_name: null,
      p_qty: null,
      p_amount: amount,
      p_note: quickNote.trim() || null
    });
    setSavingQuickEntry(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    setQuickEntry(null);
    showToast(t('settings.saved'), 'success');
    await loadAll();
  }

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

  // Purane register/Excel se switch karne walon ke liye (spec §25-J) —
  // parses into a preview only, nothing written until confirmImport.
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    file.text().then(text => {
      const rows = parseCsv(text);
      const preview = rows
        .map(row => ({
          name: (row.name || '').trim(),
          phone: (row.phone || '').trim(),
          opening_balance: Number(row.opening_balance || row.balance) || 0
        }))
        .filter(r => r.name);
      if (preview.length === 0) {
        showToast(t('khata.importEmpty'), 'error');
        return;
      }
      setImportPreview(preview);
    });
  }

  async function confirmImport() {
    if (!importPreview || !shopId) return;
    setImporting(true);
    let ok = 0;
    let failed = 0;
    for (const row of importPreview) {
      const { data: created, error: custErr } = await supabase
        .from('customers')
        .insert({ shop_id: shopId, branch_id: branchId, name: row.name, phone: row.phone || null })
        .select('id')
        .single();
      if (custErr || !created) { failed++; continue; }

      // Balance itself is never a stored column (see khata_balances RPC)
      // — an opening balance is just the customer's first ledger entry.
      // Positive = they owe (purchase), negative = they're paid ahead
      // (payment), same sign convention khata_balances already sums.
      if (row.opening_balance !== 0) {
        await supabase.from('khata_entries').insert({
          shop_id: shopId,
          customer_id: created.id,
          type: row.opening_balance > 0 ? 'purchase' : 'payment',
          amount: Math.abs(row.opening_balance),
          note: t('khata.importedOpeningBalance')
        });
      }
      ok++;
    }
    setImporting(false);
    setImportPreview(null);
    await loadAll();

    if (ok > 0 && failed === 0) showToast(t('inventory.importDone').replace('{n}', String(ok)), 'success');
    else if (ok > 0 && failed > 0) showToast(t('inventory.importPartial').replace('{ok}', String(ok)).replace('{fail}', String(failed)), 'error');
    else showToast(t('inventory.importFailed'), 'error');
  }

  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const AVATAR_COLORS = ['#0B5E56', '#B8791A', '#7A2E1D', '#1E7A4C', '#8A6747'];
  const avatarColor = (id: string) => AVATAR_COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

  return (
    <div>
      {/* Figma match — Add Credit / Record Payment lead the Khata list */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button onClick={() => openQuickEntry('credit')} className="btn-primary text-sm py-2.5">{t('khata.addCredit')}</button>
        <button onClick={() => openQuickEntry('payment')} className="btn-secondary text-sm py-2.5">{t('khata.recordPayment')}</button>
      </div>

      <div className="flex gap-2 mb-2">
        <input className="input flex-1" placeholder={t('khata.search')} value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={openAdd} className="btn-secondary whitespace-nowrap">{t('khata.addCustomer')}</button>
      </div>

      <div className="flex gap-2 mb-3">
        {(['all', 'unpaid', 'paid'] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)} className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${statusFilter === f ? 'border-haldi text-haldi font-700' : 'border-chalk/15 text-chalkdim'}`}>
            {f === 'all' ? t('khata.filterAll') : f === 'unpaid' ? t('khata.filterUnpaid') : t('khata.filterPaid')}
          </button>
        ))}
      </div>

      <div className="flex gap-4 mb-4">
        {customers.length > 0 && (
          <button onClick={exportCsv} className="text-chalkdim text-xs underline">{t('common.exportCsv')}</button>
        )}
        <label className="text-chalkdim text-xs underline cursor-pointer">
          {t('khata.importCsv')}
          <input type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
        </label>
      </div>

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
            <Link key={c.id} href={`/dashboard/khata/${c.id}`} className={`card p-4 flex justify-between items-center gap-3 ${over ? 'border-mirch' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-700 shrink-0" style={{ background: avatarColor(c.id) }}>{initials(c.name)}</span>
                <div className="min-w-0">
                  <div className="font-700 truncate">{c.name}</div>
                  <div className="text-xs text-chalkdim truncate">{c.phone || '—'}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                {/* Spec §33 edge case: never rely on the +/- sign alone —
                    label which direction the balance runs, same as the
                    Customer Detail page already does. */}
                <div className={`font-mono font-700 ${bal > 0 ? 'text-mirch' : bal < 0 ? 'text-dhania' : 'text-chalkdim'}`}>{fmt(Math.abs(bal))}</div>
                <div className="text-[10px] text-chalkdim uppercase">{bal > 0 ? t('khata.filterUnpaid') : bal < 0 ? t('khataDetail.advanceBalance') : t('khata.filterPaid')}</div>
                {over && <div className="text-[10px] text-mirch">{t('khata.overLimit')}</div>}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Quick Add Credit / Record Payment — customer picker + amount */}
      {quickEntry && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => !savingQuickEntry && setQuickEntry(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">{quickEntry === 'credit' ? t('khata.addCredit') : t('khata.recordPayment')}</div>

            {quickCustomerId ? (
              <div className="card p-3 mb-3 flex justify-between items-center">
                <span className="text-sm font-600">{customers.find(c => c.id === quickCustomerId)?.name}</span>
                <button onClick={() => setQuickCustomerId('')} className="text-chalkdim hover:text-mirch text-xs">✕</button>
              </div>
            ) : (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('khata.search')}</label>
                <input className="input mb-1" value={quickCustomerSearch} onChange={e => setQuickCustomerSearch(e.target.value)} />
                {quickCustomerResults.length > 0 && (
                  <div className="card divide-y divide-chalk/10 mb-3 max-h-32 overflow-y-auto">
                    {quickCustomerResults.map(c => (
                      <button key={c.id} onClick={() => { setQuickCustomerId(c.id); setQuickCustomerSearch(''); }} className="w-full text-left p-2.5 px-3 text-sm hover:bg-board3">
                        {c.name}{c.phone ? ` · ${c.phone}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <label className="block text-xs text-chalkdim mb-1 mt-3">{t('khataDetail.amount')}</label>
            <input type="number" inputMode="decimal" className="input mb-3" value={quickAmount} onChange={e => setQuickAmount(e.target.value)} />
            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.noteOptional')}</label>
            <input className="input mb-5" value={quickNote} onChange={e => setQuickNote(e.target.value)} />

            <div className="flex gap-2">
              <button onClick={() => setQuickEntry(null)} disabled={savingQuickEntry} className="btn-secondary flex-1">{t('khata.cancel')}</button>
              <button onClick={saveQuickEntry} disabled={savingQuickEntry || !quickCustomerId || !quickAmount} className="btn-primary flex-1">
                {savingQuickEntry ? t('settings.saving') : t('khataDetail.save')}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <input type="number" inputMode="decimal" className="input mb-3" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />

            {duplicateOf && (
              <div className="card p-3 mb-3 bg-board3">
                <p className="text-xs text-haldi mb-2">{t('khata.duplicateWarning')}</p>
                <div className="flex gap-2">
                  <Link href={`/dashboard/khata/${duplicateOf.id}`} className="btn-secondary flex-1 text-center text-xs py-2">
                    {t('khata.duplicateUseExisting')}
                  </Link>
                  <button onClick={() => saveCustomer(true)} disabled={savingCustomer} className="btn-secondary flex-1 text-xs py-2">
                    {savingCustomer ? t('settings.saving') : t('khata.duplicateAddAnyway')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} disabled={savingCustomer} className="btn-secondary flex-1">{t('khata.cancel')}</button>
              <button onClick={() => saveCustomer(false)} disabled={savingCustomer} className="btn-primary flex-1">{savingCustomer ? t('settings.saving') : t('khata.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Import preview (spec §25-J) — nothing is written until confirmed */}
      {importPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => !importing && setImportPreview(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-1">{t('khata.importPreviewTitle')}</div>
            <p className="text-chalkdim text-xs mb-3">{t('khata.importPreviewCount').replace('{n}', String(importPreview.length))}</p>
            <div className="flex-1 overflow-y-auto -mx-1 px-1 mb-3">
              <div className="card divide-y divide-chalk/10">
                {importPreview.map((r, i) => (
                  <div key={i} className="p-2.5 px-3 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-600">{r.name}</div>
                      <div className="text-xs text-chalkdim">{r.phone || '—'}</div>
                    </div>
                    <div className={`font-mono text-xs ${r.opening_balance > 0 ? 'text-mirch' : r.opening_balance < 0 ? 'text-dhania' : 'text-chalkdim'}`}>{fmt(r.opening_balance)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setImportPreview(null)} disabled={importing} className="btn-secondary flex-1">{t('khata.cancel')}</button>
              <button onClick={confirmImport} disabled={importing} className="btn-primary flex-1">{importing ? t('inventory.importing') : t('khata.importConfirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
