import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const admin = createAdminClient();

  // Grab every member's auth id BEFORE the shop is gone — deleting the
  // shop row cascades (on delete cascade) through items, transactions,
  // customers, khata_entries, suppliers, supplier_entries, and profiles
  // automatically, but it does NOT touch auth.users (that FK points the
  // other way: auth.users -> profiles, not profiles -> auth.users), so
  // staff and the owner would be left with a login that has no shop and
  // no profile — a half-deleted account, not what "delete my account"
  // (promised in the Privacy Policy) means.
  const { data: members } = await admin
    .from('profiles')
    .select('id')
    .eq('shop_id', profile.shop_id);

  const { error: deleteShopErr } = await admin.from('shops').delete().eq('id', profile.shop_id);
  if (deleteShopErr) {
    return NextResponse.json({ error: deleteShopErr.message }, { status: 400 });
  }

  for (const member of members || []) {
    // Best-effort — the shop's data is already gone at this point either
    // way, so a failure here (e.g. a staff member already deleted
    // themselves in a race) shouldn't block the response.
    await admin.auth.admin.deleteUser(member.id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
