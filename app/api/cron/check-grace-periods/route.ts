import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// Vercel Cron hits this on a schedule (see vercel.json) — the one place
// a shop's grace period (started by app/api/stripe/webhook on a failed
// payment, spec §25-H) actually expires into 'suspended'. Data is never
// deleted by this or anything downstream of it (see app/dashboard/
// layout.tsx's `locked` view-only gate) — suspension only restricts new
// writes.
export async function GET(req: Request) {
  // Vercel signs cron-triggered requests with this header automatically;
  // CRON_SECRET (set in env) keeps this endpoint from being triggered by
  // anyone who just finds the URL.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: expired, error } = await supabase
    .from('shops')
    .update({ subscription_status: 'suspended' })
    .eq('subscription_status', 'past_due')
    .lt('grace_ends_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[cron check-grace-periods] update failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ suspended: expired?.length || 0 });
}
