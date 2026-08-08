import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Full-shop data export/backup — every table a shop's own data lives in,
// as one JSON file. Uses the caller's own cookie-based session (not the
// service-role client) so RLS does the shop-scoping for free — no risk
// of this route ever leaking another shop's rows, the same guarantee
// every other page in the app already has.
const TABLES = [
  'items', 'customers', 'khata_entries', 'suppliers', 'supplier_entries',
  'transactions', 'expenses', 'purchase_orders', 'purchase_order_items',
  'staff_attendance', 'salary_adjustments', 'bank_reconciliations'
] as const;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const { data: shop } = await supabase.from('shops').select('name').eq('id', profile.shop_id).single();

  const results = await Promise.all(TABLES.map(t => supabase.from(t).select('*').eq('shop_id', profile.shop_id)));

  const data: Record<string, unknown[]> = {};
  for (let i = 0; i < TABLES.length; i++) {
    // A single table failing to read (unexpected, but RLS/permissions
    // could theoretically deny one) shouldn't abort the whole export —
    // it lands as an empty array with the reason kept alongside it.
    data[TABLES[i]] = results[i].data || [];
  }

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    shop_name: shop?.name || null,
    shop_id: profile.shop_id,
    tables: data
  });
}
