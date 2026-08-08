import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SignOutButton from '@/components/SignOutButton';
import LanguageToggle from '@/components/LanguageToggle';
import ThemeToggle from '@/components/ThemeToggle';
import DashboardNav from '@/components/DashboardNav';
import { StoreIcon } from '@/components/icons';
import { getServerT } from '@/lib/i18n-server';
import { ShopProvider } from '@/lib/shop-context';
import { isAdmin } from '@/lib/admin';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('shop_id, full_name, role, shops(name, subscription_status, trial_ends_at)')
    .eq('id', user.id)
    .single();

  // No profile row (signup trigger hasn't landed yet, or the row was
  // otherwise removed) means there's no shop_id to scope anything to —
  // nothing downstream can render safely without it.
  if (!profile) redirect('/login');

  const shop: any = profile.shops;
  const isOwner = profile.role === 'owner';
  const trialExpired =
    shop?.subscription_status === 'trialing' &&
    new Date(shop?.trial_ends_at) < new Date();
  const locked = shop?.subscription_status === 'canceled' || shop?.subscription_status === 'past_due' || trialExpired;

  const t = await getServerT();

  // Admin badge: how many payment_claims are still waiting on a look.
  // The WhatsApp ping when someone taps "I've Paid" is real-time, but
  // it's easy to lose a message in a busy chat — this makes the count
  // visible every time the operator opens the dashboard for anything
  // else, not just when they remember to check /dashboard/admin.
  let adminPendingCount = 0;
  if (isAdmin(user.email)) {
    const admin = createAdminClient();
    const { count } = await admin
      .from('payment_claims')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    adminPendingCount = count || 0;
  }

  const nav = [
    { href: '/dashboard', label: t('nav.overview') },
    { href: '/dashboard/inventory', label: t('nav.inventory') },
    { href: '/dashboard/reorder', label: t('nav.reorder') },
    { href: '/dashboard/khata', label: t('nav.khata') },
    { href: '/dashboard/suppliers', label: t('nav.suppliers') },
    { href: '/dashboard/history', label: t('nav.history') },
    // billing/settings/staff are owner-only — staff never even see the tabs
    ...(isOwner ? [
      { href: '/dashboard/staff', label: t('nav.staff') },
      { href: '/dashboard/billing', label: t('nav.billing') },
      { href: '/dashboard/settings', label: t('nav.settings') }
    ] : []),
    // Not a shop role — this is the one link only the SaaS operator
    // (matched by ADMIN_EMAIL) ever sees, regardless of which shop
    // they're logged into or what role they hold in it.
    ...(isAdmin(user.email) ? [{ href: '/dashboard/admin', label: t('nav.admin'), badge: adminPendingCount }] : [])
  ];

  return (
    <ShopProvider value={{ shopId: profile.shop_id, role: profile.role as 'owner' | 'staff', shopName: shop?.name || '' }}>
      <div className="min-h-screen">
        <header className="border-b border-chalk/10">
          <div className="max-w-4xl mx-auto px-5 py-4 flex items-center flex-wrap gap-x-3 gap-y-2 justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-haldi/15 text-haldi flex items-center justify-center shrink-0">
                <StoreIcon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-xl sm:text-2xl font-800 text-haldi leading-tight truncate">{shop?.name || 'Dukaan ERP'}</div>
                <div className="text-[11px] text-chalkdim tracking-wide mt-0.5 whitespace-nowrap">{t('header.subtitle')}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <ThemeToggle />
              <LanguageToggle />
              <SignOutButton />
            </div>
          </div>
          <DashboardNav items={nav} />
        </header>

        <main className="max-w-4xl mx-auto px-5 py-6">
          {locked && (
            <div className="card p-5 mb-6 border-mirch">
              <div className="font-display text-lg text-mirch font-700 mb-1">{t('lock.title')}</div>
              <div className="text-chalkdim text-sm mb-3">{t('lock.body')}</div>
              <Link href="/dashboard/billing" className="btn-primary inline-block">{t('lock.cta')}</Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </ShopProvider>
  );
}
