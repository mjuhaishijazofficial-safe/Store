import { createClient } from '@/lib/supabase/server';
import BillingActions from '@/components/BillingActions';

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const { data: shop } = await supabase
    .from('shops')
    .select('subscription_status, plan, trial_ends_at, stripe_customer_id')
    .eq('id', profile?.shop_id)
    .single();

  const statusLabel: Record<string, string> = {
    trialing: 'Free Trial',
    active: 'Active',
    past_due: 'Payment Due',
    canceled: 'Canceled'
  };

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">Billing</h1>

      <div className="card p-5 mb-5">
        <div className="text-xs text-chalkdim uppercase mb-1">Current Status</div>
        <div className="font-display text-lg font-700 text-haldi">{statusLabel[shop?.subscription_status || 'trialing']}</div>
        {shop?.subscription_status === 'trialing' && (
          <div className="text-xs text-chalkdim mt-1">
            Trial khatam: {new Date(shop.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>

      <div className="card p-5 mb-5">
        <div className="font-mono text-3xl font-700 text-haldi mb-1">₨999<span className="text-sm text-chalkdim">/mahina</span></div>
        <div className="text-chalkdim text-sm">Per dukaan. Cancel kabhi bhi kar sakte hain.</div>
      </div>

      <BillingActions hasSubscription={!!shop?.stripe_customer_id} />
    </div>
  );
}
