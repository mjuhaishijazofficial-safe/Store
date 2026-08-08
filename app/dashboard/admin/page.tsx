import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import AdminPaymentClaims from '@/components/AdminPaymentClaims';
import AdminShopManagement from '@/components/AdminShopManagement';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Not a role check — every other gate in this app is scoped to "my
  // shop" via RLS, but this page reads/writes across every shop, so it
  // has to be the one place that isn't RLS-scoped at all. Locked down
  // to a single person by email instead, re-checked again server-side
  // in every /api/admin/* route (never trust this redirect alone).
  if (!isAdmin(user?.email)) redirect('/dashboard');

  const admin = createAdminClient();

  const [{ data: claims }, { data: shops }, { data: owners }, { data: recentActions }] = await Promise.all([
    admin
      .from('payment_claims')
      .select('id, method, amount, status, created_at, shop_id, shops(name, subscription_status)')
      .order('created_at', { ascending: false }),
    admin
      .from('shops')
      .select('id, name, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false }),
    // shops.owner_id references auth.users, not profiles, directly — no
    // FK Postgrest can auto-join on. profiles.shop_id -> shops.id is the
    // real link, so this fetches the owner's email/name per shop and
    // gets matched up client-side instead.
    admin.from('profiles').select('shop_id, email, full_name').eq('role', 'owner'),
    admin.from('admin_actions').select('id, shop_id, action, detail, performed_by, created_at').order('created_at', { ascending: false }).limit(20)
  ]);

  const ownerByShop = new Map((owners || []).map((o: any) => [o.shop_id, o]));
  const shopsWithOwner = (shops || []).map((s: any) => ({ ...s, owner: ownerByShop.get(s.id) || null }));

  const total = shopsWithOwner.length;
  const trialing = shopsWithOwner.filter((s: any) => s.subscription_status === 'trialing').length;
  const active = shopsWithOwner.filter((s: any) => s.subscription_status === 'active').length;
  const problem = shopsWithOwner.filter((s: any) => s.subscription_status === 'past_due' || s.subscription_status === 'canceled' || s.subscription_status === 'suspended').length;
  const mrr = active * 999;

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">Admin</h1>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Total Shops', value: total, color: '' },
          { label: 'Trialing', value: trialing, color: 'text-haldi' },
          { label: 'Active (paying)', value: active, color: 'text-dhania' },
          { label: 'Past Due/Canceled', value: problem, color: 'text-mirch' },
          { label: 'MRR', value: '₨' + mrr.toLocaleString('en-IN'), color: 'text-dhania' }
        ].map(m => (
          <div key={m.label} className="card p-4">
            <div className="text-[10px] text-chalkdim uppercase tracking-wide mb-1">{m.label}</div>
            <div className={`font-mono font-700 text-lg ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      <AdminShopManagement shops={shopsWithOwner} />

      <div className="mt-10">
        <h2 className="font-display text-lg font-700 mb-3">Payment Claims</h2>
        <AdminPaymentClaims claims={(claims || []) as any} />
      </div>

      {recentActions && recentActions.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-base font-700 mb-3 text-chalkdim">Recent Admin Actions</h2>
          <div className="card divide-y divide-chalk/10">
            {recentActions.map((a: any) => (
              <div key={a.id} className="p-3 px-4 text-xs flex justify-between items-center">
                <div>
                  <span className="font-600">{a.action}</span>
                  {a.detail && <span className="text-chalkdim"> — {a.detail}</span>}
                </div>
                <div className="text-chalkdim shrink-0 ml-3">{new Date(a.created_at).toLocaleString('en-GB')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
