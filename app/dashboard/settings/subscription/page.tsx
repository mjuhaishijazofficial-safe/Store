import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import BillingActions from '@/components/BillingActions';
import ManualPayment from '@/components/ManualPayment';
import { getServerT } from '@/lib/i18n-server';

// Moved here from app/dashboard/billing/page.tsx (Master Handoff Spec
// §13 Settings > Subscription/Billing tab) — /dashboard/billing itself
// is now the POS/counter screen (spec §15), which every role uses, so
// the shop's own Dukaan-ERP subscription page needed a route that
// isn't also the word "billing" a cashier sees on the sidebar.
export default async function SubscriptionPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user!.id).single();
  if (profile?.role !== 'owner') redirect('/dashboard');
  const [{ data: shop }, { data: lastClaim }] = await Promise.all([
    supabase
      .from('shops')
      .select('subscription_status, plan, trial_ends_at, stripe_customer_id')
      .eq('id', profile?.shop_id)
      .single(),
    supabase
      .from('payment_claims')
      .select('status')
      .eq('shop_id', profile?.shop_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  const pending = lastClaim?.status === 'pending';

  const statusLabel: Record<string, string> = {
    trialing: t('billing.statusTrialing'),
    active: t('billing.statusActive'),
    past_due: t('billing.statusPastDue'),
    canceled: t('billing.statusCanceled')
  };

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">{t('billing.title')}</h1>

      <div className="card p-5 mb-5">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('billing.currentStatus')}</div>
        <div className="font-display text-lg font-700 text-haldi">{statusLabel[shop?.subscription_status || 'trialing']}</div>
        {shop?.subscription_status === 'trialing' && (
          <div className="text-xs text-chalkdim mt-1">
            {t('billing.trialEnds')} {new Date(shop.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>

      <div className="card p-5 mb-5">
        <div className="font-mono text-3xl font-700 text-haldi mb-1">₨999<span className="text-sm text-chalkdim">{t('billing.perMonth')}</span></div>
        <div className="text-chalkdim text-sm">{t('billing.perShop')}</div>
      </div>

      {shop?.stripe_customer_id ? (
        <BillingActions hasSubscription />
      ) : shop?.subscription_status === 'active' ? (
        <div className="card p-5 text-center text-dhania text-sm">{t('billing.alreadyActive')}</div>
      ) : (
        <ManualPayment
          pending={pending}
          details={{
            easypaisaNumber: process.env.EASYPAISA_NUMBER || '',
            easypaisaTitle: process.env.EASYPAISA_TITLE || '',
            meezanTitle: process.env.MEEZAN_TITLE || '',
            meezanAccount: process.env.MEEZAN_ACCOUNT || '',
            meezanIban: process.env.MEEZAN_IBAN || '',
            meezanBranch: process.env.MEEZAN_BRANCH || ''
          }}
        />
      )}
    </div>
  );
}
