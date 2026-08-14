import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const { staffId } = await req.json();
  if (!staffId || typeof staffId !== 'string') {
    return NextResponse.json({ error: 'staffId required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const admin = createAdminClient();

  // Re-check the target server-side rather than trusting the client's
  // idea of who's on the list — must be in this same shop, and must be
  // staff, not another owner (removing an owner isn't what this button
  // is for; that's Settings > Delete Account, which unwinds the whole
  // shop deliberately, not by accident from the Staff list).
  const { data: target } = await admin
    .from('profiles')
    .select('shop_id, role')
    .eq('id', staffId)
    .single();

  if (!target || target.shop_id !== profile.shop_id || target.role === 'owner') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // profiles.id references auth.users(id) on delete cascade, so removing
  // the auth user takes the profile row with it in one step — no
  // separate profiles.delete() needed, and no orphaned login left behind
  // (unlike just deleting the profile, which would leave them with a
  // working password but nowhere to land).
  const { error: err } = await admin.auth.admin.deleteUser(staffId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
