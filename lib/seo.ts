// One place that knows the site's own address. Everything that has to
// emit an absolute URL — metadataBase, canonicals, sitemap, robots,
// JSON-LD — reads it from here, so a domain change is a single edit
// (plus the env var) rather than a hunt through the app.
//
// NEXT_PUBLIC_APP_URL must be the real production origin in Vercel:
// canonical tags and the OG image URL are built from it, and a wrong
// value there is the classic cause of a site that renders fine but
// never indexes properly.
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export const SITE_NAME = 'Dukaan ERP';
