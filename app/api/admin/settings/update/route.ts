import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { defaultTrialDays, maintenanceMode, featureFlags } = await req.json().catch(() => ({}));
  const admin = createAdminClient();

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof defaultTrialDays === 'number' && defaultTrialDays > 0 && defaultTrialDays <= 90) {
    payload.default_trial_days = defaultTrialDays;
  }
  if (typeof maintenanceMode === 'boolean') payload.maintenance_mode = maintenanceMode;
  if (featureFlags && typeof featureFlags === 'object') payload.feature_flags = featureFlags;

  const { error: err } = await admin.from('platform_settings').update(payload).eq('id', true);
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
