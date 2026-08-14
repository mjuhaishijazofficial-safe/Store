import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';

// Spec §33 edge case: "2 devices se same staff account login ho (ek
// phone chori, doosra naya)" — Supabase's admin API has no direct
// "revoke every session for this user" call (auth.admin.signOut takes
// a JWT, for signing yourself out, not another user by id — confirmed
// against the Supabase docs before building this). Setting a fresh
// random password is the documented, reliable way to invalidate every
// existing login: the old password (and whatever refresh tokens a
// stolen device is holding) stops working immediately, and a reset
// email lets the real staff member back in on a device they still
// control.
export async function POST(req: Request) {
  const { staffId } = await req.json().catch(() => ({}));
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

  const { data: target } = await admin.from('profiles').select('shop_id, role, email').eq('id', staffId).single();
  if (!target || target.shop_id !== profile.shop_id || target.role === 'owner') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!target.email) return NextResponse.json({ error: 'no email on file' }, { status: 400 });

  // A password neither this owner nor the staff member ever sees —
  // its only job is to make every existing session/refresh token stop
  // working; the reset email below is the real way back in.
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();
  const { error: updErr } = await admin.auth.admin.updateUserById(staffId, { password: randomPassword });
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  const { error: sendErr } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${requireEnv('NEXT_PUBLIC_APP_URL')}/reset-password`
  });
  // Sessions are already revoked regardless of whether this email goes
  // out — that's the security-relevant part and it already happened.
  // A failed email just means the owner should tell them to use
  // "Password bhool gaye?" on /login themselves instead.
  if (sendErr) console.error('[logout-all-devices] reset email failed', { staffId, sendErr });

  return NextResponse.json({ ok: true });
}
