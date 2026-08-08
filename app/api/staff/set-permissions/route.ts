import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { ALL_SECTIONS } from '@/lib/permissions';

const VALID_KEYS = new Set(ALL_SECTIONS.map(s => s.key));

export async function POST(req: Request) {
  const { staffId, allowedSections } = await req.json().catch(() => ({}));
  if (!staffId || typeof staffId !== 'string') {
    return NextResponse.json({ error: 'staffId required' }, { status: 400 });
  }
  // null is valid (means "unrestricted") — anything else must be an
  // array of known section keys, never arbitrary strings written
  // straight into a text[] column from client input.
  if (allowedSections !== null) {
    if (!Array.isArray(allowedSections) || allowedSections.some((s: unknown) => typeof s !== 'string' || !VALID_KEYS.has(s as any))) {
      return NextResponse.json({ error: 'invalid sections' }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  // Same reasoning as set-salary: profiles has no client-reachable
  // UPDATE policy at all (role lives on the same row), so this goes
  // through the service-role client, re-validated server-side.
  const admin = createAdminClient();

  const { data: target } = await admin.from('profiles').select('shop_id, role').eq('id', staffId).single();
  if (!target || target.shop_id !== profile.shop_id || target.role !== 'staff') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { error: err } = await admin.from('profiles').update({ allowed_sections: allowedSections }).eq('id', staffId);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
