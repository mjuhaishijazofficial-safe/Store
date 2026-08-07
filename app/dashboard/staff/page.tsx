import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n-server';
import InviteStaffForm from '@/components/InviteStaffForm';

export default async function StaffPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user!.id).single();

  if (profile?.role !== 'owner') redirect('/dashboard');

  const { data: staff } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('shop_id', profile.shop_id)
    .order('created_at');

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-xl font-700 mb-5">{t('staff.title')}</h1>

      <div className="space-y-2 mb-6">
        {(staff || []).map((s: any) => (
          <div key={s.id} className="card p-3 px-4 flex justify-between items-center">
            <div>
              <div className="font-600 text-sm">{s.full_name || s.email || '—'}</div>
              {s.full_name && <div className="text-xs text-chalkdim">{s.email}</div>}
            </div>
            <div className="text-xs px-2 py-1 rounded-full bg-board3 text-chalkdim">
              {s.role === 'owner' ? t('staff.roleOwner') : t('staff.roleStaff')}
            </div>
          </div>
        ))}
      </div>

      <InviteStaffForm />
    </div>
  );
}
