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
  role: 'owner' | 'staff';
  shopName: string;
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
