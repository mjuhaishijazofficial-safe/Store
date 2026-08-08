import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // The admin page hides this action from everyone else, but that's a
  // UI convenience, not security — this check is the one that actually
  // matters, since this route can flip any shop's subscription on.
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { claimId } = await req.json().catch(() => ({}));
  if (!claimId) return NextResponse.json({ error: 'claimId required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: claim, error: claimErr } = await admin
    .from('payment_claims')
    .select('id, shop_id')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) return NextResponse.json({ error: 'claim not found' }, { status: 404 });

  const { error: shopErr } = await admin
    .from('shops')
    .update({ subscription_status: 'active' })
    .eq('id', claim.shop_id);
  if (shopErr) return NextResponse.json({ error: shopErr.message }, { status: 400 });

  // Best-effort — the shop is already unlocked at this point either way,
  // so a failure marking the claim itself confirmed shouldn't surface
  // as an error to the admin.
  await admin.from('payment_claims').update({ status: 'confirmed' }).eq('id', claimId);

  return NextResponse.json({ ok: true });
}
