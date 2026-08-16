import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';
import { source } from '@/lib/source';

/**
 * Every route the `(home)` group serves, in nav order. Kept explicit rather
 * than derived, so a route only appears here once it is meant to be indexed.
 */
const HOME_ROUTES = [
  '',
  '/join',
  '/app',
  '/board',
  '/metrics',
  '/playground',
  '/blog',
  '/roadmap',
  '/pitch',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = HOME_ROUTES.map((p) => ({
    url: `${siteUrl}${p}`,
    changeFrequency: 'weekly' as const,
    priority: p === '' ? 1 : 0.7,
  }));

  const docs = source.getPages().map((page) => ({
    url: `${siteUrl}${page.url}`,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...docs];
}
