'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Plan = { id: string; name: string; price: number; billing_interval: string; features: string[]; is_active: boolean };

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function AdminPlansManagement({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; price: string; features: string }>({ name: '', price: '', features: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function openEdit(p: Plan) {
    setEditing(p.id);
    setForm({ name: p.name, price: String(p.price), features: p.features.join('\n') });
    setErr('');
  }

  async function save(planId: string) {
    setBusy(true);
    setErr('');
    const res = await fetch('/api/admin/plans/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        name: form.name.trim(),
        price: Number(form.price),
        features: form.features.split('\n').map(f => f.trim()).filter(Boolean)
      })
    });
    setBusy(false);
    if (!res.ok) { setErr('Save failed'); return; }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {plans.map(p => (
        <div key={p.id} className="card p-5">
          {editing === p.id ? (
            <>
              <label className="block text-xs text-chalkdim mb-1">Plan Name</label>
              <input className="input mb-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <label className="block text-xs text-chalkdim mb-1">Price (₨/{p.billing_interval})</label>
              <input type="number" className="input mb-3" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
              <label className="block text-xs text-chalkdim mb-1">Features (one per line)</label>
              <textarea className="input mb-3" rows={5} value={form.features} onChange={e => setForm({ ...form, features: e.target.value })} />
              {err && <div className="text-mirch text-xs mb-3">{err}</div>}
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} disabled={busy} className="btn-secondary flex-1">Cancel</button>
                <button onClick={() => save(p.id)} disabled={busy} className="btn-primary flex-1">{busy ? 'Saving...' : 'Save'}</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-display text-lg font-700 text-haldi">{p.name}</div>
                  <div className="font-mono text-2xl font-700">{fmt(p.price)}<span className="text-sm text-chalkdim font-normal">/{p.billing_interval}</span></div>
                </div>
                <button onClick={() => openEdit(p)} className="btn-secondary text-xs px-3 py-1.5">Edit</button>
              </div>
              <ul className="text-sm text-chalkdim space-y-1">
                {p.features.map((f, i) => <li key={i}>✓ {f}</li>)}
              </ul>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
