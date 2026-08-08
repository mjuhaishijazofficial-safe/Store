'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Claim = {
  id: string;
  method: string;
  amount: number;
  status: string;
  created_at: string;
  shop_id: string;
  shops: { name: string; subscription_status: string } | null;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function AdminPaymentClaims({ claims }: { claims: Claim[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const pending = claims.filter(c => c.status === 'pending');
  const confirmed = claims.filter(c => c.status !== 'pending');

  async function activate(claimId: string) {
    setBusyId(claimId);
    setErr('');
    const res = await fetch('/api/admin/activate-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId })
    });
    setBusyId(null);
    if (!res.ok) { setErr('Activate failed — try again.'); return; }
    router.refresh();
  }

  return (
    <div>
      <h2 className="font-display text-lg font-700 mb-3">Pending ({pending.length})</h2>
      {err && <div className="text-mirch text-sm mb-3">{err}</div>}
      {pending.length === 0 && <div className="text-chalkdim text-sm mb-8">No pending payment claims.</div>}
      {pending.length > 0 && (
        <div className="space-y-2 mb-8">
          {pending.map(c => (
            <div key={c.id} className="card p-4 flex justify-between items-center border-haldi">
              <div>
                <div className="font-700">{c.shops?.name || 'Unknown shop'}</div>
                <div className="text-xs text-chalkdim">
                  {c.method === 'easypaisa' ? 'EasyPaisa' : 'Bank (Meezan)'} · {fmt(c.amount)} · {new Date(c.created_at).toLocaleString('en-GB')}
                </div>
                <div className="text-[10px] text-chalkdim mt-0.5">current status: {c.shops?.subscription_status || '—'}</div>
              </div>
              <button onClick={() => activate(c.id)} disabled={busyId === c.id} className="btn-primary whitespace-nowrap">
                {busyId === c.id ? 'Activating…' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 className="font-display text-base font-700 mb-3 text-chalkdim">History</h2>
      {confirmed.length === 0 && <div className="text-chalkdim text-sm">Nothing confirmed yet.</div>}
      <div className="space-y-2">
        {confirmed.map(c => (
          <div key={c.id} className="card p-3 flex justify-between items-center text-sm opacity-70">
            <div>
              <div className="font-600">{c.shops?.name || 'Unknown shop'}</div>
              <div className="text-xs text-chalkdim">
                {c.method === 'easypaisa' ? 'EasyPaisa' : 'Bank (Meezan)'} · {fmt(c.amount)} · {new Date(c.created_at).toLocaleString('en-GB')}
              </div>
            </div>
            <span className="text-dhania text-xs font-700 whitespace-nowrap ml-3">✓ Confirmed</span>
          </div>
        ))}
      </div>
    </div>
  );
}
