import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

const VALID_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'suspended']);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { shopId, status } = await req.json().catch(() => ({}));
  if (!shopId || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: shop, error: shopErr } = await admin.from('shops').select('id, subscription_status').eq('id', shopId).single();
  if (shopErr || !shop) return NextResponse.json({ error: 'shop not found' }, { status: 404 });

  // Clearing grace_ends_at whenever an admin manually restores 'active'
  // matters beyond just tidiness: app/api/stripe/webhook's
  // invoice.payment_failed handler reuses an existing grace_ends_at
  // rather than pushing it out again ("don't extend an already-running
  // grace period on a second failed retry") — if a stale one survives
  // here, the NEXT unrelated failed payment months later would inherit
  // an already-past timestamp and get suspended with zero days of
  // warning instead of the real 4-day grace period.
  const { error: updErr } = await admin.from('shops').update({
    subscription_status: status,
    ...(status === 'active' ? { grace_ends_at: null } : {})
  }).eq('id', shopId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await admin.from('admin_actions').insert({
    shop_id: shopId,
    action: status === 'suspended' ? 'suspend' : shop.subscription_status === 'suspended' ? 'reactivate' : 'set_status',
    detail: `${shop.subscription_status} -> ${status}`,
    performed_by: user!.email
  });

  return NextResponse.json({ ok: true });
}
