import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `siteUrl` is computed once at module load from up to three sources, so every
 * case stubs the environment and re-imports the module fresh.
 */
async function loadSiteUrl() {
  vi.resetModules();
  return (await import('@/lib/site')).siteUrl;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('siteUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over everything else', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://zentra.example');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'ignored.vercel.app');
    expect(await loadSiteUrl()).toBe('https://zentra.example');
  });

  it('falls back to the Vercel production URL, prefixed with https', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'zentra-docs.vercel.app');
    expect(await loadSiteUrl()).toBe('https://zentra-docs.vercel.app');
  });

  it('falls back to the placeholder domain when nothing is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined);
    expect(await loadSiteUrl()).toBe('https://docs.zentra.dev');
  });

  it('strips a trailing slash from the explicit origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000/');
    expect(await loadSiteUrl()).toBe('http://localhost:3000');
  });

  it('keeps an origin without a trailing slash untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect(await loadSiteUrl()).toBe('http://localhost:3000');
  });
});
