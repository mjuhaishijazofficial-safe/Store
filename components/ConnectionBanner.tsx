'use client';

import { useOnlineStatus } from '@/lib/use-online-status';
import { useLang } from '@/lib/i18n-context';

export default function ConnectionBanner() {
  const online = useOnlineStatus();
  const { t } = useLang();

  if (online) return null;

  return (
    <div className="no-print bg-mirch text-white text-xs text-center py-1.5 px-3">
      {t('offline.banner')}
    </div>
  );
}
