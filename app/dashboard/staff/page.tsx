import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n-server';
import InviteStaffForm from '@/components/InviteStaffForm';
import StaffList from '@/components/StaffList';

export default async function StaffPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user!.id).single();

  if (profile?.role !== 'owner') redirect('/dashboard');

  const { data: staff } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, allowed_sections')
    .eq('shop_id', profile.shop_id)
    .order('created_at');

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">{t('staff.title')}</h1>

      <StaffList staff={staff || []} />

      <InviteStaffForm />
    </div>
  );
}
