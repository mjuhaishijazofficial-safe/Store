import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { ticketId, status, assignedTo } = await req.json().catch(() => ({}));
  if (!ticketId) return NextResponse.json({ error: 'ticketId required' }, { status: 400 });

  const admin = createAdminClient();
  const payload: Record<string, unknown> = {};
  if (status === 'open' || status === 'resolved') {
    payload.status = status;
    payload.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  }
  if (assignedTo !== undefined) payload.assigned_to = (assignedTo || '').trim() || null;

  const { error: err } = await admin.from('support_tickets').update(payload).eq('id', ticketId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
