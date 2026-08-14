import { createAdminClient } from '@/lib/supabase/server';
import AdminPlansManagement from '@/components/AdminPlansManagement';

// Plans catalog (spec §27) — this product currently sells exactly one
// flat plan (₨999/month, see supabase/schema.sql §16 for why this
// seeds one real row rather than fabricated tiers), so "which
// businesses are on which plan" collapses to counts by
// subscription_status — the Businesses tab already has the full list
// with search/filter for anything more specific than a count.
export default async function AdminPlansPage() {
  const admin = createAdminClient();

  const [{ data: plans }, { data: shops }] = await Promise.all([
    admin.from('plans').select('id, name, price, billing_interval, features, is_active').order('price'),
    admin.from('shops').select('subscription_status')
  ]);

  const counts: Record<string, number> = {};
  for (const s of shops || []) {
    counts[s.subscription_status] = (counts[s.subscription_status] || 0) + 1;
  }

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">Plans</h1>
      <p className="text-chalkdim text-sm mb-5">Pricing/features edit karein — jo bhi dukaan is plan par active/trialing hai, unko turant naye features milenge.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Trialing', value: counts.trialing || 0, color: 'text-haldi' },
          { label: 'Active (paying)', value: counts.active || 0, color: 'text-dhania' },
          { label: 'Past Due', value: counts.past_due || 0, color: 'text-mirch' },
          { label: 'Suspended/Canceled', value: (counts.suspended || 0) + (counts.canceled || 0), color: 'text-mirch' }
        ].map(m => (
          <div key={m.label} className="card p-4">
            <div className="text-[10px] text-chalkdim uppercase tracking-wide mb-1">{m.label}</div>
            <div className={`font-mono font-700 text-lg ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      <AdminPlansManagement plans={plans || []} />
    </div>
  );
}
