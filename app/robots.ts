import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://dukaanerp.vercel.app';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Everything behind auth is per-shop data, not content — no reason
      // for a crawler to hit it, and the API routes are POST-only anyway.
      disallow: ['/dashboard/', '/api/']
    },
    sitemap: `${base}/sitemap.xml`
  };
}
