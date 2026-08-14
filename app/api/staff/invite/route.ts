import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';

export async function POST(req: Request) {
  const { email, role } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  // Defaults to cashier — matches the signup trigger's own fallback if
  // this were ever omitted (see handle_new_user in supabase/schema.sql).
  const invitedRole = role === 'manager' ? 'manager' : 'cashier';

  const supabase = await createClient();
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
    app_metadata: { invited_shop_id: profile.shop_id, invited_role: invitedRole }
  });

  if (createErr) {
    // auth.users emails are unique across the whole Supabase project, not
    // just this shop — this email may belong to a completely different
    // shop (or an old test signup), which is why it won't show up
    // anywhere in this shop's own Staff list even though it's taken.
    // Surface a code the client can translate into a clear explanation
    // instead of relaying Supabase's raw English message verbatim.
    const alreadyExists = /already.*regist|already.*exist/i.test(createErr.message);
    return NextResponse.json(
      { error: alreadyExists ? 'email_taken' : createErr.message },
      { status: 400 }
    );
  }

  // No password is set yet — send Supabase's built-in recovery email so
  // they can set one. /reset-password also doubles as the invite-accept
  // landing page.
  const { error: sendErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${requireEnv('NEXT_PUBLIC_APP_URL')}/reset-password`
  });

  if (sendErr) {
    // The user row above was already created — left as-is, that's a
    // real account with no invite email ever delivered, and worse, an
    // unretryable dead end: trying again just fails with "already
    // exists" since createUser() now sees it, with no way for the
    // owner to know the first attempt silently died on the email step.
    // Deleting it here makes the whole operation atomic from the
    // caller's side — either both steps land, or neither does, and a
    // retry (e.g. once an email-rate-limit clears) starts clean.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json({ error: sendErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
