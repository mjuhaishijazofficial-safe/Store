import type { MetadataRoute } from 'next';

// Installable-to-home-screen support only — deliberately no service
// worker alongside this. A custom service worker would let the app
// shell load instantly on a weak connection too, but Next.js ships a
// new build-hash per deploy, and a hand-rolled SW cache is a well-known
// way to strand a user on stale JS after a release. That's a separate,
// carefully-tested project, not something to bolt on here.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dukaan ERP — Kiryana Store ka Hisaab Kitab',
    short_name: 'Dukaan ERP',
    description: 'Khata, inventory, suppliers aur reports — sab ek app mein.',
    start_url: '/dashboard',
    display: 'standalone',
    // Matches the "Ledger Trust" palette that's now the default brand
    // (see lib/palette.ts) — these only drive the splash screen shown
    // before the app's own CSS paints, so they're fixed to the default
    // palette's light-mode values rather than trying to track whichever
    // palette/theme a returning user last picked (which the manifest,
    // fetched once at install time, has no way to know anyway).
    background_color: '#F4F6F8',
    theme_color: '#0F2A4A',
    icons: [
      // SVG-only: modern Chrome/Edge (Android install prompt) accept an
      // SVG manifest icon directly, no PNG generation pipeline needed.
      // iOS "Add to Home Screen" ignores the manifest icon entirely and
      // uses apple-touch-icon instead, which is unaffected by this.
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
    ]
  };
}
