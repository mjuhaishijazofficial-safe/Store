'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useShop } from './shop-context';
import { hasSection, Section } from './permissions';

// Nav already hides sections a staff member isn't granted, but hiding a
// link doesn't stop someone typing the URL directly or following an old
// bookmark — this is the page-level half of that gate. Bounces to
// Overview rather than showing an error page, since "you don't have
// this" isn't something worth a dedicated screen.
export function useSectionGuard(section: Section) {
  const { role, allowedSections } = useShop();
  const router = useRouter();

  useEffect(() => {
    if (!hasSection(role, allowedSections, section)) {
      router.replace('/dashboard');
    }
  }, [role, allowedSections, section, router]);
}
