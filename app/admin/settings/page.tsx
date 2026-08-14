import { createAdminClient } from '@/lib/supabase/server';
import AdminSystemSettings from '@/components/AdminSystemSettings';

export default async function AdminSettingsPage() {
  const admin = createAdminClient();
  const { data: settings } = await admin.from('platform_settings').select('default_trial_days, maintenance_mode, feature_flags').eq('id', true).single();

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">System Settings</h1>
      <p className="text-chalkdim text-sm mb-5">Poore platform ke liye global settings — har naye/existing shop ko turant affect karti hain.</p>
      <AdminSystemSettings
        defaultTrialDays={settings?.default_trial_days ?? 14}
        maintenanceMode={settings?.maintenance_mode ?? false}
        featureFlags={settings?.feature_flags ?? { smart_reorder: true }}
      />
    </div>
  );
}
