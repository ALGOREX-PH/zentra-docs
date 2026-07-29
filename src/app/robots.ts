import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // `/api/*` serves JSON to the app itself — there is nothing there for a
    // crawler to index, and the admin and feedback handlers should never show
    // up in results.
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
