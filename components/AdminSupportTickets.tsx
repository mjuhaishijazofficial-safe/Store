'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Ticket = {
  id: string;
  subject: string;
  message: string;
  status: 'open' | 'resolved';
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
  shops: { name: string } | null;
};

export default function AdminSupportTickets({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignInput, setAssignInput] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(t: Ticket) {
    setExpanded(prev => prev === t.id ? null : t.id);
    setAssignInput(t.assigned_to || '');
  }

  async function update(ticketId: string, patch: { status?: 'open' | 'resolved'; assignedTo?: string }) {
    setBusy(true);
    await fetch('/api/admin/support/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, ...patch })
    });
    setBusy(false);
    router.refresh();
  }

  if (tickets.length === 0) {
    return <div className="text-center py-14 text-chalkdim text-sm">Koi support ticket abhi tak nahi hai.</div>;
  }

  return (
    <div className="space-y-2">
      {tickets.map(t => (
        <div key={t.id} className={`card p-4 ${t.status === 'open' ? 'border-haldi/40' : ''}`}>
          <button onClick={() => toggle(t)} className="w-full flex justify-between items-start text-left">
            <div>
              <div className="font-700 text-sm">{t.subject}</div>
              <div className="text-xs text-chalkdim mt-0.5">{t.shops?.name || '—'} · {new Date(t.created_at).toLocaleDateString('en-GB')}</div>
            </div>
            <span className={`text-[10px] uppercase border rounded px-1.5 py-0.5 shrink-0 ${t.status === 'open' ? 'text-haldi border-haldi/40' : 'text-dhania border-dhania/40'}`}>
              {t.status}
            </span>
          </button>

          {expanded === t.id && (
            <div className="mt-3 pt-3 border-t border-chalk/10">
              <p className="text-sm mb-3 whitespace-pre-wrap">{t.message}</p>

              <label className="block text-xs text-chalkdim mb-1">Assign To</label>
              <div className="flex gap-2 mb-3">
                <input className="input flex-1 text-sm" value={assignInput} onChange={e => setAssignInput(e.target.value)} placeholder="Team member ka naam" />
                <button onClick={() => update(t.id, { assignedTo: assignInput })} disabled={busy} className="btn-secondary text-xs px-3">Save</button>
              </div>

              <button
                onClick={() => update(t.id, { status: t.status === 'open' ? 'resolved' : 'open' })}
                disabled={busy}
                className={t.status === 'open' ? 'btn-primary w-full' : 'btn-secondary w-full'}
              >
                {t.status === 'open' ? 'Mark Resolved' : 'Re-open'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
