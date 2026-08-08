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

// Owner always has every section; a staff member with allowedSections
// === null is unrestricted (the default — nothing shrinks silently for
// existing staff just because this feature shipped); otherwise it's an
// explicit whitelist.
export function hasSection(role: 'owner' | 'staff', allowedSections: string[] | null, section: Section): boolean {
  if (role === 'owner') return true;
  if (allowedSections === null) return true;
  return allowedSections.includes(section);
}
