// Per-staff section access — competitor gap (DigiKhata: "staff can be
// granted view-only, edit, or delete rights, you decide who sees what").
// Scoped down from a full view/edit/delete matrix to a single "can this
// staff member open this section at all" whitelist: a small shop's real
// need is usually "the new counter guy shouldn't see Reports or
// Expenses," not a 21-cell permission grid. Enforced at the page level
// (redirect if not allowed) and hidden from the nav — not at the RLS
// layer, so this deters casual access rather than defending against a
// staff member deliberately hitting the API directly. That matches the
// trust model already in place: every shop-scoped table's RLS already
// grants staff the same read/write as the owner once they're in the
// shop at all (see customers/suppliers/khata_entries policies in
// schema.sql) — this is UI/workflow gating on top of that, not a
// replacement for it.

import type { DictKey } from './i18n';

export type Section = 'inventory' | 'reorder' | 'khata' | 'suppliers' | 'history' | 'reports' | 'expenses';

export const ALL_SECTIONS: { key: Section; labelKey: DictKey }[] = [
  { key: 'inventory', labelKey: 'nav.inventory' },
  { key: 'reorder', labelKey: 'nav.reorder' },
  { key: 'khata', labelKey: 'nav.khata' },
  { key: 'suppliers', labelKey: 'nav.suppliers' },
  { key: 'history', labelKey: 'nav.history' },
  { key: 'reports', labelKey: 'overview.dailyReport' },
  { key: 'expenses', labelKey: 'nav.expenses' }
];

// Cashier's P0 default (Master Handoff Spec §17): Billing/POS + Inventory
// (view) + Khata (own entries) only — Suppliers/Stock-in/Reorder/Reports/
// Expenses/History don't render in nav unless an owner explicitly widens
// allowed_sections for that one cashier. This is what a freshly-invited
// cashier (allowed_sections still null, the column's default) gets out of
// the box — narrower than the old blanket "null = unrestricted" staff
// default, which the spec never gave a Cashier. Billing/POS itself isn't
// in this list at all — see app/dashboard/layout.tsx — because the spec
// never section-gates it; every role gets it unconditionally.
const CASHIER_DEFAULT_SECTIONS: Section[] = ['inventory', 'khata'];

// Owner always has every section. Manager defaults to every section too
// (§17: Inventory/Khata/Suppliers/Reports) — what narrows a Manager's
// view is branch scoping (each page's own query, see profiles.branch_id
// in supabase/schema.sql), not section-hiding. A cashier with
// allowedSections === null (the column's default) falls back to
// CASHIER_DEFAULT_SECTIONS instead of "everything". Any role can still
// be widened/narrowed further via an explicit whitelist.
export function hasSection(role: 'owner' | 'manager' | 'cashier', allowedSections: string[] | null, section: Section): boolean {
  if (role === 'owner') return true;
  if (allowedSections !== null) return allowedSections.includes(section);
  return role === 'manager' || (CASHIER_DEFAULT_SECTIONS as string[]).includes(section);
}
