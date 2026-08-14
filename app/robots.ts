import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL;

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Everything behind auth is per-shop data, not content — no reason
      // for a crawler to hit it, and the API routes are POST-only anyway.
      disallow: ['/dashboard/', '/admin/', '/api/']
    },
    sitemap: `${base}/sitemap.xml`
  };
}
