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
  const { error } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
    data: { invited_shop_id: profile.shop_id },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
