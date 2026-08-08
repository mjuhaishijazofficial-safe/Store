import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const { staffId, monthlySalary } = await req.json().catch(() => ({}));
  if (!staffId || typeof staffId !== 'string' || typeof monthlySalary !== 'number' || monthlySalary < 0) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  // profiles has no client-reachable UPDATE policy at all — deliberately,
  // since `role` lives on the same row and a broad "owner can update
  // their shop's profiles" policy would let an owner rewrite it (self-
  // promote a staff member, or worse, downgrade themselves out of their
  // own shop by accident). Going through the service-role client and
  // touching only monthly_salary here keeps that guarantee intact while
  // still letting the owner set a figure the RLS layer can't safely
  // expose a general-purpose update for.
  const admin = createAdminClient();

  const { data: target } = await admin.from('profiles').select('shop_id').eq('id', staffId).single();
  if (!target || target.shop_id !== profile.shop_id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { error: err } = await admin.from('profiles').update({ monthly_salary: monthlySalary }).eq('id', staffId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
