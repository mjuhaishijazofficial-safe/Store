import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { shopId, days } = await req.json().catch(() => ({}));
  const daysNum = Number(days);
  if (!shopId || !Number.isFinite(daysNum) || daysNum <= 0 || daysNum > 90) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: shop, error: shopErr } = await admin.from('shops').select('id, trial_ends_at').eq('id', shopId).single();
  if (shopErr || !shop) return NextResponse.json({ error: 'shop not found' }, { status: 404 });

  // Extend from whichever is later — "now" or the current trial_ends_at
  // — so extending an already-expired trial doesn't leave it still
  // expired (extending from a date in the past by N days can still land
  // in the past), and extending one that's still running just pushes
  // its real end date out.
  const base = new Date(Math.max(new Date(shop.trial_ends_at).getTime(), Date.now()));
  const newEnd = new Date(base.getTime() + daysNum * 86400000);

  const { error: updErr } = await admin.from('shops').update({ trial_ends_at: newEnd.toISOString() }).eq('id', shopId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await admin.from('admin_actions').insert({
    shop_id: shopId,
    action: 'extend_trial',
    detail: `+${daysNum} days (now ends ${newEnd.toISOString().slice(0, 10)})`,
    performed_by: user!.email
  });

  return NextResponse.json({ ok: true, trial_ends_at: newEnd.toISOString() });
}
