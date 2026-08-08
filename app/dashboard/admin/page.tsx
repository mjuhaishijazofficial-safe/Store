import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import AdminPaymentClaims from '@/components/AdminPaymentClaims';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Not a role check — every other gate in this app is scoped to "my
  // shop" via RLS, but this page reads/writes across every shop, so it
  // has to be the one place that isn't RLS-scoped at all. Locked down
  // to a single person by email instead, re-checked again server-side
  // in the activate-payment route (never trust this redirect alone).
  if (!isAdmin(user?.email)) redirect('/dashboard');

  const admin = createAdminClient();
  const { data: claims } = await admin
    .from('payment_claims')
    .select('id, method, amount, status, created_at, shop_id, shops(name, subscription_status)')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">Admin — Payment Claims</h1>
      <AdminPaymentClaims claims={(claims || []) as any} />
    </div>
  );
}
