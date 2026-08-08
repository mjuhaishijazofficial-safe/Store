'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n-context';

export default function SignOutButton() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button onClick={signOut} className="text-sm text-chalkdim hover:text-chalk whitespace-nowrap">
      {t('nav.signout')}
    </button>
  );
}
