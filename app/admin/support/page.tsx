import { createAdminClient } from '@/lib/supabase/server';
import AdminSupportTickets from '@/components/AdminSupportTickets';

export default async function AdminSupportPage() {
  const admin = createAdminClient();
  const { data: tickets } = await admin
    .from('support_tickets')
    .select('id, subject, message, status, assigned_to, created_at, resolved_at, shop_id, shops(name)')
    .order('status', { ascending: true }) // 'open' before 'resolved'
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">Support Tickets</h1>
      <p className="text-chalkdim text-sm mb-5">Dukaandaron ki help requests — assign karein aur resolve karein.</p>
      <AdminSupportTickets tickets={(tickets as any) || []} />
    </div>
  );
}
