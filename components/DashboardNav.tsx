'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

type NavItem = { href: string; label: string; badge?: number };

export default function DashboardNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // The nav bar lives in the shared dashboard layout, so it never
  // remounts on client-side navigation — its scroll position used to
  // just stay wherever it was left (e.g. scrolled right to reach
  // Settings), even after navigating back to Overview. That reads as
  // "the nav is stuck/broken" since nothing highlighted where you
  // actually were. Scrolling the active tab into view on every route
  // change, plus actually highlighting it, fixes both problems.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <nav className="max-w-4xl mx-auto px-5 flex gap-2.5 overflow-x-auto pb-3">
      {items.map(n => {
        const active = n.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            ref={active ? activeRef : undefined}
            className={`text-sm px-3.5 py-1.5 rounded-full border whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              active ? 'bg-haldi text-board border-haldi font-700' : 'bg-board2 border-chalk/10 hover:border-haldi'
            }`}
          >
            {n.label}
            {!!n.badge && (
              <span className={`text-[10px] leading-none rounded-full px-1.5 py-0.5 font-700 ${
                active ? 'bg-board text-haldi' : 'bg-mirch text-board'
              }`}>
                {n.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
