'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n-context';
import SignOutButton from './SignOutButton';
import {
  StoreIcon, ChartIcon, CartIcon, ReceiptIcon, WalletIcon, CashIcon, ClockIcon,
  TrendDownIcon, WarningIcon, PersonIcon, GearIcon, MenuIcon, CollapseIcon
} from './icons';

type NavItem = { href: string; label: string; badge?: number };

// One icon per section, matched by href prefix — a handful of these
// intentionally repeat an icon from an unrelated section (Billing and
// Bank Reconciliation both read as "money"); the label is still what
// actually identifies the item, the icon is a scan aid, not a unique key.
function iconFor(href: string) {
  if (href === '/dashboard') return StoreIcon;
  if (href.includes('/inventory')) return CartIcon;
  if (href.includes('/reorder')) return WarningIcon;
  if (href.includes('/khata')) return ReceiptIcon;
  if (href.includes('/purchase-orders')) return CashIcon;
  if (href.includes('/suppliers')) return WalletIcon;
  if (href.includes('/history')) return ClockIcon;
  if (href.includes('/expenses')) return TrendDownIcon;
  if (href.includes('/staff')) return PersonIcon;
  if (href.includes('/billing') || href.includes('/bank-reconciliation')) return WalletIcon;
  if (href.includes('/settings')) return GearIcon;
  if (href.includes('/admin')) return WarningIcon;
  return ChartIcon;
}

export default function DashboardSidebar({ items, shopName, trialLabel }: { items: NavItem[]; shopName: string; trialLabel?: string }) {
  const pathname = usePathname();
  const { t } = useLang();
  // Tablet (768–1023px) defaults to icon-only; desktop (1024px+) starts
  // expanded. Read once at mount (client-only — window isn't available
  // during the server render, so that pass always defaults to expanded,
  // which is a harmless one-frame difference on tablet, not a layout bug).
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  function isActive(href: string) {
    return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
  }

  function NavList({ onNavigate, iconOnly }: { onNavigate?: () => void; iconOnly: boolean }) {
    return (
      // min-h-0 overrides flexbox's default min-height:auto on a flex
      // child — without it, a flex item with overflow-y-auto refuses to
      // shrink below its content size, so instead of the nav list
      // scrolling on its own, the whole <aside> (which is h-screen)
      // overflows past the viewport and forces a page-level scrollbar,
      // pushing Settings/Admin out past the bottom, overlapping the
      // footer. This is the classic flexbox-scroll pitfall.
      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        {items.map(n => {
          const active = isActive(n.href);
          const Icon = iconFor(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              title={iconOnly ? n.label : undefined}
              className={`flex items-center gap-3 mx-2 my-0.5 rounded-lg text-sm min-h-[44px] px-3 border-l-2 ${
                active
                  ? 'bg-haldi/15 text-haldi font-700 border-haldi'
                  : 'text-chalkdim border-transparent hover:bg-board3 hover:text-chalk'
              } ${iconOnly ? 'justify-center' : ''}`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!iconOnly && <span className="truncate flex-1">{n.label}</span>}
              {!!n.badge && (
                <span className={`text-[10px] leading-none rounded-full px-1.5 py-0.5 font-700 bg-mirch text-board shrink-0 ${iconOnly ? 'absolute translate-x-3 -translate-y-3' : ''}`}>
                  {n.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  function Header({ iconOnly }: { iconOnly: boolean }) {
    return (
      <div className={`flex items-center gap-2.5 p-4 border-b border-chalk/10 ${iconOnly ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 rounded-xl gradient-brand shadow-glow text-board flex items-center justify-center shrink-0">
          <StoreIcon className="w-5 h-5" />
        </div>
        {!iconOnly && <div className="font-display font-800 text-haldi truncate">{shopName || 'Dukaan ERP'}</div>}
      </div>
    );
  }

  function Footer({ iconOnly }: { iconOnly: boolean }) {
    // Theme/language toggles moved to the top-right of the main content
    // area (see layout.tsx) — this stays just the trial badge + a
    // centered Sign Out, no longer needing the justify-between split
    // that used to make room for the toggles on the left.
    return (
      <div className="border-t border-chalk/10 p-3 space-y-2">
        {trialLabel && (
          <div className={`rounded-lg bg-haldi/15 text-haldi text-xs font-700 text-center py-2 ${iconOnly ? 'px-1' : 'px-3'}`}>
            {iconOnly ? '⏳' : trialLabel}
          </div>
        )}
        <div className="flex justify-center">
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile top bar — hamburger opens the drawer version of this
          same sidebar content below 1024px. */}
      <div className="lg:hidden flex items-center justify-between px-3 py-2 border-b border-chalk/10 no-print">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label={t('nav.menu')}
          className="w-11 h-11 flex items-center justify-center -ml-1 shrink-0"
        >
          <MenuIcon className="w-6 h-6" />
        </button>
        <div className="font-display font-800 text-haldi truncate">{shopName || 'Dukaan ERP'}</div>
        <div className="w-11 shrink-0" />
      </div>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex no-print">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] h-full bg-board2 flex flex-col">
            <Header iconOnly={false} />
            <NavList onNavigate={() => setMobileOpen(false)} iconOnly={false} />
            <Footer iconOnly={false} />
          </aside>
        </div>
      )}

      {/* Desktop/tablet sidebar — a normal flex sibling of <main> (see
          layout.tsx), not fixed-positioned, so collapsing it reflows the
          content next to it with zero manual margin syncing. */}
      <aside className={`relative hidden lg:flex flex-col shrink-0 h-screen sticky top-0 border-r border-chalk/10 bg-board2 no-print transition-[width] duration-150 ${collapsed ? 'w-[72px]' : 'w-[220px]'}`}>
        <Header iconOnly={collapsed} />
        <NavList iconOnly={collapsed} />
        <Footer iconOnly={collapsed} />
        <button
          onClick={() => setCollapsed(c => !c)}
          className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-board2 border border-chalk/15 flex items-center justify-center text-chalkdim hover:text-haldi"
          aria-label={t('nav.collapse')}
        >
          <CollapseIcon className={`w-3.5 h-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </aside>
    </>
  );
}
