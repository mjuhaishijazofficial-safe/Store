'use client';

import { createContext, useContext } from 'react';

// Every client dashboard page used to open with two sequential round
// trips — auth.getUser() then a profiles select for shop_id — before it
// could even start its real data query. That's on every single
// navigation, and it's exactly what "click hota hai, time lagta hai"
// looks like from the user's side. The server layout (app/dashboard/
// layout.tsx) already fetches this once per request; this just carries
// it down to client components so they don't re-fetch it themselves.

export type ShopInfo = {
  shopId: string;
  role: 'owner' | 'manager' | 'cashier';
  shopName: string;
  allowedSections: string[] | null;
  // Custom receipt branding (Settings → Receipt Branding) — null means
  // "not set," and every receipt-rendering component falls back to its
  // existing default (no phone line, the stock "thank you" message).
  receiptPhone: string | null;
  receiptFooter: string | null;
  // Spec §17/§33 — a Cashier's discount on the Billing/POS screen is
  // capped at this percent of the bill (0 = no discount allowed at
  // all), Owner-set from Settings.
  cashierDiscountCapPercent: number;
  // Spec §33-H: trial expired / payment failed / canceled / suspended —
  // Billing and Inventory go view-only (existing data stays, no new
  // changes) rather than the app just showing a banner with no teeth.
  locked: boolean;
  // Multi-Branch (spec §20/§25-E): null for Owner (org-wide, sees every
  // branch) and for a single-branch shop that's never split into
  // branches. Set for Manager/Cashier once an Owner assigns one —
  // pages filter their own queries by this rather than an RLS-level
  // restriction, same convention as allowedSections above.
  branchId: string | null;
  branches: { id: string; name: string }[];
  // FBR Tax Compliance hook (spec §25-F) — off by default, no effect
  // anywhere in the app unless an Owner turns it on from Settings.
  fbrEnabled: boolean;
  taxRatePercent: number;
  // System Settings feature flag (spec §27) — Super Admin can disable
  // Smart Reorder platform-wide during a rollout; true (default) means
  // no restriction, unchanged from before this existed.
  smartReorderEnabled: boolean;
};

const ShopContext = createContext<ShopInfo | null>(null);

export function ShopProvider({ value, children }: { value: ShopInfo; children: React.ReactNode }) {
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopInfo {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider (are you inside app/dashboard?)');
  return ctx;
}
