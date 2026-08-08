'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Shop = {
  id: string;
  name: string;
  subscription_status: string;
  trial_ends_at: string;
  created_at: string;
  owner: { email: string | null; full_name: string | null } | null;
};

const STATUS_COLOR: Record<string, string> = {
  trialing: 'text-haldi border-haldi/40',
  active: 'text-dhania border-dhania/40',
  past_due: 'text-mirch border-mirch/40',
  canceled: 'text-mirch border-mirch/40',
  suspended: 'text-mirch border-mirch/40'
};

const STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'suspended'];

export default function AdminShopManagement({ shops }: { shops: Shop[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [extendDays, setExtendDays] = useState('7');
  const [newStatus, setNewStatus] = useState('active');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.owner?.email || '').toLowerCase().includes(q) ||
      (s.owner?.full_name || '').toLowerCase().includes(q)
    );
  }, [search, shops]);

  function toggleExpand(id: string) {
    setErr('');
    setExtendDays('7');
    setExpanded(prev => prev === id ? null : id);
  }

  async function extendTrial(shopId: string) {
    setBusy(true);
    setErr('');
    const res = await fetch('/api/admin/extend-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, days: Number(extendDays) })
    });
    setBusy(false);
    if (!res.ok) { setErr('Extend failed — try again.'); return; }
    router.refresh();
  }

  async function setStatus(shopId: string, status: string) {
    setBusy(true);
    setErr('');
    const res = await fetch('/api/admin/set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, status })
    });
    setBusy(false);
    if (!res.ok) { setErr('Update failed — try again.'); return; }
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-700">Shops ({shops.length})</h2>
      </div>
      <input
        className="input mb-3"
        placeholder="Search by shop name or owner email..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {err && <div className="text-mirch text-sm mb-3">{err}</div>}

      <div className="space-y-2">
        {filtered.map(s => {
          const isOpen = expanded === s.id;
          const trialLeft = Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000);
          return (
            <div key={s.id} className="card p-4">
              <button onClick={() => toggleExpand(s.id)} className="w-full flex justify-between items-center text-left">
                <div>
                  <div className="font-700">{s.name}</div>
                  <div className="text-xs text-chalkdim">{s.owner?.email || 'no owner found'}</div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className={`text-[10px] uppercase border rounded px-2 py-0.5 inline-block ${STATUS_COLOR[s.subscription_status] || 'text-chalkdim border-chalk/20'}`}>
                    {s.subscription_status}
                  </div>
                  {s.subscription_status === 'trialing' && (
                    <div className="text-[11px] text-chalkdim mt-1">{trialLeft >= 0 ? `${trialLeft}d left` : `expired ${-trialLeft}d ago`}</div>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-chalk/10 space-y-3">
                  <div>
                    <label className="block text-[11px] text-chalkdim mb-1">Extend trial by</label>
                    <div className="flex gap-2">
                      <input
                        type="number" inputMode="decimal" className="input py-1.5 text-sm w-24"
                        value={extendDays} onChange={e => setExtendDays(e.target.value)}
                      />
                      <span className="text-xs text-chalkdim self-center">days</span>
                      <button onClick={() => extendTrial(s.id)} disabled={busy} className="btn-secondary text-xs px-3 ml-auto">
                        {busy ? 'Working…' : 'Extend'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-chalkdim mb-1">Set subscription status</label>
                    <div className="flex gap-2">
                      <select className="input py-1.5 text-sm flex-1" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                        {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                      <button onClick={() => setStatus(s.id, newStatus)} disabled={busy} className="btn-primary text-xs px-3">
                        {busy ? 'Working…' : 'Apply'}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {s.subscription_status !== 'suspended' ? (
                      <button
                        onClick={() => setStatus(s.id, 'suspended')}
                        disabled={busy}
                        className="flex-1 text-mirch text-xs font-700 border border-mirch/40 rounded-lg px-3 py-2"
                      >
                        Suspend this shop
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(s.id, 'active')}
                        disabled={busy}
                        className="flex-1 text-dhania text-xs font-700 border border-dhania/40 rounded-lg px-3 py-2"
                      >
                        Reactivate (set active)
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-chalkdim text-sm text-center py-8">No shops match.</div>}
      </div>
    </div>
  );
}
