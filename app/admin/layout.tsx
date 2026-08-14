import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import SignOutButton from '@/components/SignOutButton';
import type { Metadata } from 'next';

// Super Admin surface (Master Spec §27) — deliberately its own layout,
// not nested under app/dashboard: that layout requires a `profiles` row
// (shop membership) to render at all, which coupled "runs the SaaS" to
// "also owns a shop" for no real reason. This checks isAdmin() directly
// against the logged-in user's email, independent of any shop.
//
// Still shares the same /login page and Supabase auth as every shop
// account (spec §27 pictures a fully separate login/subdomain,
// admin.dukaanerp.com) — that's the one piece left as a known gap: an
// admin-only account with no shop of its own has to navigate to /admin
// directly after signing in (no smart post-login redirect yet), since
// /login's redirect still assumes /dashboard. Every admin action itself
// is already fully gated server-side in each /api/admin/* route
// regardless of how this page was reached.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect('/login');

  return (
    <div className="min-h-screen">
      <div className="border-b border-chalk/10 px-4 sm:px-6 py-3 flex justify-between items-center">
        <span className="font-display font-700 text-haldi">Dukaan ERP — Admin</span>
        <SignOutButton />
      </div>
      <main className="px-4 sm:px-6 py-6 max-w-5xl mx-auto w-full">{children}</main>
    </div>
  );
}
