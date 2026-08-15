'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';

// Small persistent "Eagle" launcher — visible from anywhere in the
// dashboard (not just Khata), tapping it opens the full-screen voice
// page (app/dashboard/voice). Hidden while already on that page (no
// point launching what's already open) and on print (no-print, same
// convention as every other floating chrome in this app).
export default function VoiceLauncherButton() {
  const { t } = useLang();
  const pathname = usePathname();
  if (pathname?.startsWith('/dashboard/voice')) return null;

  return (
    <Link
      href="/dashboard/voice"
      title={t('voice.launcherTitle')}
      className="fixed z-30 bottom-20 lg:bottom-6 right-4 w-12 h-12 rounded-full gradient-brand shadow-glow flex items-center justify-center text-2xl no-print"
    >
      🦅
    </Link>
  );
}
