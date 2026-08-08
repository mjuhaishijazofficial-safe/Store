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

  const { error: updErr } = await admin.from('shops').update({ subscription_status: status }).eq('id', shopId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await admin.from('admin_actions').insert({
    shop_id: shopId,
    action: status === 'suspended' ? 'suspend' : shop.subscription_status === 'suspended' ? 'reactivate' : 'set_status',
    detail: `${shop.subscription_status} -> ${status}`,
    performed_by: user!.email
  });

  return NextResponse.json({ ok: true });
}
