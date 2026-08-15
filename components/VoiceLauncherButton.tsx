'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';

// Small persistent "Eagle" launcher — sits top-right of every dashboard
// page alongside Theme/Language (see app/dashboard/layout.tsx), tapping
// it opens the full-screen voice page (app/dashboard/voice). Hidden
// while already on that page (no point launching what's already open).
export default function VoiceLauncherButton() {
  const { t } = useLang();
  const pathname = usePathname();
  if (pathname?.startsWith('/dashboard/voice')) return null;

  return (
    <Link
      href="/dashboard/voice"
      title={t('voice.launcherTitle')}
      className="w-9 h-9 rounded-full gradient-brand shadow-glow flex items-center justify-center text-lg shrink-0"
    >
      🦅
    </Link>
  );
}
