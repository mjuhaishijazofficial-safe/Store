'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number | null;
};

type EntryRow = { customer_id: string; type: 'purchase' | 'payment'; amount: number };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataPage() {
  const supabase = createClient();
  const [shopId, setShopId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', phone: '', credit_limit: '' });

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

    const [{ data: custs }, { data: entries }] = await Promise.all([
      supabase.from('customers').select('*').eq('shop_id', id).order('name'),
      supabase.from('khata_entries').select('customer_id, type, amount').eq('shop_id', id)
    ]);

    const bal: Record<string, number> = {};
    (entries as EntryRow[] || []).forEach(e => {
      const delta = e.type === 'purchase' ? e.amount : -e.amount;
      bal[e.customer_id] = (bal[e.customer_id] || 0) + delta;
    });

    setCustomers(custs || []);
    setBalances(bal);
    setLoading(false);
  }

  function openAdd() {
    setForm({ name: '', phone: '', credit_limit: '' });
    setModalOpen(true);
  }

  async function saveCustomer() {
    if (!form.name.trim() || !shopId) return;
    await supabase.from('customers').insert({
      shop_id: shopId,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      credit_limit: form.credit_limit ? Number(form.credit_limit) : null
    });
    setModalOpen(false);
    await loadAll();
  }

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder="Customer dhoondein..." value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={openAdd} className="btn-primary whitespace-nowrap">+ Naya Customer</button>
      </div>

      {loading && <div className="text-chalkdim text-sm text-center py-10">Load ho raha hai...</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-haldi text-base mb-1">Koi customer nahi mila</div>
          "+ Naya Customer" par tap kar ke add karein
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
                <div className={`font-mono font-700 ${bal > 0 ? 'text-mirch' : 'text-chalkdim'}`}>{fmt(bal)}</div>
                {over && <div className="text-[10px] text-mirch">Limit se zyada</div>}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Add Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalOpen(false)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">Naya Customer</div>
            <label className="block text-xs text-chalkdim mb-1">Naam</label>
            <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <label className="block text-xs text-chalkdim mb-1">Phone</label>
            <input className="input mb-3" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            <label className="block text-xs text-chalkdim mb-1">Credit limit (₨) — optional</label>
            <input type="number" className="input mb-5" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={saveCustomer} className="btn-primary flex-1">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
