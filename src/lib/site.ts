/**
 * Canonical site origin. Final domain is still TBD (docs PRD §19.1), so it's
 * overridable per environment — set NEXT_PUBLIC_SITE_URL, or rely on Vercel's
 * production URL. The default is a placeholder for local builds.
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://docs.zentra.dev')
).replace(/\/$/, '');
