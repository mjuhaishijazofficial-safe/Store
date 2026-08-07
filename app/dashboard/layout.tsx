import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SignOutButton from '@/components/SignOutButton';
import LanguageToggle from '@/components/LanguageToggle';
import { getServerT } from '@/lib/i18n-server';
import { ShopProvider } from '@/lib/shop-context';

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
    ] : [])
  ];

  return (
    <ShopProvider value={{ shopId: profile.shop_id, role: profile.role as 'owner' | 'staff', shopName: shop?.name || '' }}>
      <div className="min-h-screen">
        <header className="border-b border-chalk/10">
          <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
            <div className="font-display text-xl font-700 text-haldi">{shop?.name || 'Dukaan ERP'}</div>
            <div className="flex items-center gap-4">
              <LanguageToggle />
              <SignOutButton />
            </div>
          </div>
          <nav className="max-w-4xl mx-auto px-5 flex gap-1 overflow-x-auto pb-2">
            {nav.map(n => (
              <Link key={n.href} href={n.href} className="text-sm px-3 py-1.5 rounded-full bg-board2 border border-chalk/10 whitespace-nowrap hover:border-haldi">
                {n.label}
              </Link>
            ))}
          </nav>
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
