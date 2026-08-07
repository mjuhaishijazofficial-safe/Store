import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('shop_id, full_name, shops(name, subscription_status, trial_ends_at)')
    .eq('id', user.id)
    .single();

  const shop: any = profile?.shops;
  const trialExpired =
    shop?.subscription_status === 'trialing' &&
    new Date(shop?.trial_ends_at) < new Date();
  const locked = shop?.subscription_status === 'canceled' || shop?.subscription_status === 'past_due' || trialExpired;

  const nav = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/dashboard/inventory', label: 'Saman' },
    { href: '/dashboard/reorder', label: 'Mangwana Hai' },
    { href: '/dashboard/khata', label: 'Khata' },
    { href: '/dashboard/history', label: 'History' },
    { href: '/dashboard/billing', label: 'Billing' },
    { href: '/dashboard/settings', label: 'Settings' }
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="font-display text-xl font-700 text-haldi">{shop?.name || 'Dukaan ERP'}</div>
          <SignOutButton />
        </div>
        <nav className="max-w-4xl mx-auto px-5 flex gap-1 overflow-x-auto pb-2">
          {nav.map(n => (
            <Link key={n.href} href={n.href} className="text-sm px-3 py-1.5 rounded-full bg-board2 border border-white/10 whitespace-nowrap hover:border-haldi">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6">
        {locked && (
          <div className="card p-5 mb-6 border-mirch">
            <div className="font-display text-lg text-mirch font-700 mb-1">Trial khatam ho gaya</div>
            <div className="text-chalkdim text-sm mb-3">Apna subscription active karein taake dukaan ka data use karte rahein.</div>
            <Link href="/dashboard/billing" className="btn-primary inline-block">Subscribe Karein</Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
