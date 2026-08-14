import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { planId, name, price, features } = await req.json().catch(() => ({}));
  if (!planId || !name || typeof price !== 'number' || price < 0) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  if (!Array.isArray(features) || features.some((f: unknown) => typeof f !== 'string')) {
    return NextResponse.json({ error: 'invalid features' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: err } = await admin.from('plans').update({ name, price, features }).eq('id', planId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
