import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// Reassigns which branch a Manager/Cashier is scoped to (spec §20) —
// same service-role pattern as set-salary/set-permissions, since
// profiles has no client-reachable UPDATE policy at all.
export async function POST(req: Request) {
  const { staffId, branchId } = await req.json().catch(() => ({}));
  if (!staffId || typeof staffId !== 'string') {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: target } = await admin.from('profiles').select('shop_id, role').eq('id', staffId).single();
  if (!target || target.shop_id !== profile.shop_id || target.role === 'owner') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (branchId) {
    const { data: branch } = await admin.from('branches').select('id').eq('id', branchId).eq('shop_id', profile.shop_id).single();
    if (!branch) return NextResponse.json({ error: 'branch not found' }, { status: 404 });
  }

  const { error: err } = await admin.from('profiles').update({ branch_id: branchId || null }).eq('id', staffId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
