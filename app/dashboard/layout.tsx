import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import DashboardSidebar from '@/components/DashboardSidebar';
import ConnectionBanner from '@/components/ConnectionBanner';
import AppLockGate from '@/components/AppLockGate';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import { getServerT } from '@/lib/i18n-server';
import { ShopProvider } from '@/lib/shop-context';
import { isAdmin } from '@/lib/admin';
import { hasSection } from '@/lib/permissions';
import type { Metadata } from 'next';

// robots.txt already disallows /dashboard, but that only asks crawlers
// not to fetch it — a URL discovered elsewhere can still end up indexed
// as a bare link. This header is the part that actually keeps every
// shop's private pages out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('shop_id, full_name, role, allowed_sections, shops(name, subscription_status, trial_ends_at, receipt_phone, receipt_footer)')
    .eq('id', user.id)
    .single();

  // No profile row (signup trigger hasn't landed yet, or the row was
  // otherwise removed) means there's no shop_id to scope anything to —
  // nothing downstream can render safely without it.
  if (!profile) redirect('/login');

  const shop: any = profile.shops;
  const isOwner = profile.role === 'owner';
  const allowedSections = (profile.allowed_sections as string[] | null) ?? null;
  const trialExpired =
    shop?.subscription_status === 'trialing' &&
    new Date(shop?.trial_ends_at) < new Date();
  const locked = shop?.subscription_status === 'canceled' || shop?.subscription_status === 'past_due' || shop?.subscription_status === 'suspended' || trialExpired;

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

  // Sections a staff member hasn't been granted don't even appear in the
  // nav — see lib/permissions.ts for what this does and doesn't defend
  // against (UI/workflow gating, not an RLS-level restriction).
  const nav = [
    { href: '/dashboard', label: t('nav.overview') },
    ...(hasSection(profile.role, allowedSections, 'inventory') ? [{ href: '/dashboard/inventory', label: t('nav.inventory') }] : []),
    ...(hasSection(profile.role, allowedSections, 'reorder') ? [{ href: '/dashboard/reorder', label: t('nav.reorder') }] : []),
    ...(hasSection(profile.role, allowedSections, 'khata') ? [{ href: '/dashboard/khata', label: t('nav.khata') }] : []),
    ...(hasSection(profile.role, allowedSections, 'suppliers') ? [
      { href: '/dashboard/suppliers', label: t('nav.suppliers') },
      { href: '/dashboard/purchase-orders', label: t('nav.purchaseOrders') }
    ] : []),
    ...(hasSection(profile.role, allowedSections, 'history') ? [{ href: '/dashboard/history', label: t('nav.history') }] : []),
    ...(hasSection(profile.role, allowedSections, 'expenses') ? [{ href: '/dashboard/expenses', label: t('nav.expenses') }] : []),
    // billing/settings/staff/bank-reconciliation are owner-only — staff
    // never even see the tabs. Bank reconciliation isn't in the
    // allowed_sections list at all (see lib/permissions.ts) — it's the
    // shop's real bank statement figures, role-gated like billing, not
    // something a permission toggle should ever be able to hand to staff.
    ...(isOwner ? [
      { href: '/dashboard/staff', label: t('nav.staff') },
      { href: '/dashboard/billing', label: t('nav.billing') },
      { href: '/dashboard/bank-reconciliation', label: t('nav.bankReconciliation') },
      { href: '/dashboard/settings', label: t('nav.settings') }
    ] : []),
    // Not a shop role — this is the one link only the SaaS operator
    // (matched by ADMIN_EMAIL) ever sees, regardless of which shop
    // they're logged into or what role they hold in it.
    ...(isAdmin(user.email) ? [{ href: '/dashboard/admin', label: t('nav.admin'), badge: adminPendingCount }] : [])
  ];

  const trialLabel = shop?.subscription_status === 'trialing' && !trialExpired ? t('billing.statusTrialing') : undefined;

  return (
    <ShopProvider value={{ shopId: profile.shop_id, role: profile.role as 'owner' | 'staff', shopName: shop?.name || '', allowedSections, receiptPhone: shop?.receipt_phone || null, receiptFooter: shop?.receipt_footer || null }}>
      <ConnectionBanner />
      {/* Sidebar + main are flex siblings (not fixed+margin) so the
          sidebar's own collapse toggle reflows main content with no
          state syncing between the server-rendered shell and the
          client-side collapse state living inside DashboardSidebar. */}
      <div className="lg:flex min-h-screen">
        <DashboardSidebar items={nav} shopName={shop?.name || ''} trialLabel={trialLabel} />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 max-w-5xl mx-auto w-full">
          {/* Theme/language toggles live here — top-right of every
              dashboard page's content — rather than in the sidebar
              footer, which now stays just the trial badge + a centered
              Sign Out. */}
          <div className="flex justify-end gap-2 mb-4 no-print">
            <ThemeToggle />
            <LanguageToggle />
          </div>
          {locked && (
            <div className="card p-5 mb-6 border-mirch">
              <div className="font-display text-lg text-mirch font-700 mb-1">{t('lock.title')}</div>
              <div className="text-chalkdim text-sm mb-3">{t('lock.body')}</div>
              <Link href="/dashboard/billing" className="btn-primary inline-block">{t('lock.cta')}</Link>
            </div>
          )}
          <AppLockGate>{children}</AppLockGate>
        </main>
      </div>
    </ShopProvider>
  );
}
