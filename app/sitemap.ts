import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;
  const now = new Date();

  // Only the public pages — the dashboard is behind auth and every route
  // under it is one shop's private data, so there's nothing there to index.
  return [
    { url: base, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 }
  ];
}
