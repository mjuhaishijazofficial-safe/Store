import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const admin = createAdminClient();

  // Create the user with app_metadata set atomically at creation time.
  // app_metadata (unlike user_metadata/"data") can only ever be written
  // with the service-role key, never by a browser client — that's what
  // makes it safe for the signup trigger to trust for shop attachment.
  // Using createUser (not inviteUserByEmail, whose `data` option only
  // reaches user_metadata) means it's present the instant the row is
  // inserted, so the trigger sees it correctly on its very first read —
  // a follow-up updateUserById() call would be too late, since the
  // trigger already fired on the initial insert.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email.trim(),
    email_confirm: true,
    app_metadata: { invited_shop_id: profile.shop_id }
  });

  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 });

  // No password is set yet — send Supabase's built-in recovery email so
  // they can set one. /reset-password also doubles as the invite-accept
  // landing page.
  const { error: sendErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`
  });

  if (sendErr) return NextResponse.json({ error: sendErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
