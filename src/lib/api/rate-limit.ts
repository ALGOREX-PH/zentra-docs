/**
 * Best-effort, in-memory fixed-window rate limiter for API route handlers.
 *
 * The counters live in this process only. Vercel may run several concurrent
 * instances of a function, so the effective global ceiling is roughly
 * `limit × instances`, and an instance that scales to zero forgets everything
 * it was counting. Treat this as a spam and abuse speed bump, not a security
 * control: it will not stop a determined attacker, a distributed flood, or
 * anyone who can rotate source IPs. The next step, when the traffic justifies
 * it, is a shared store such as Redis or Upstash so every instance reads and
 * writes the same window.
 *
 * Zero dependencies and no framework imports, so it can be exercised directly
 * in plain node.
 */

/** Tuning for a single window: how many hits, over how long. */
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

/** Outcome of one `rateLimit` call, including the numbers needed for headers. */
export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms at which the current window expires. */
  resetAt: number;
  /** Seconds the caller should wait before retrying; 0 when `ok`. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Upper bound on tracked keys, so a flood of unique IPs cannot grow the map
 * without limit. Roughly a few hundred kB at capacity.
 */
const MAX_KEYS = 5000;

/**
 * The map hangs off `globalThis` under a registered symbol. Next.js re-evaluates
 * modules on hot reload in dev, and a plain module-level `const` would hand each
 * new evaluation a fresh, empty map — silently resetting every counter.
 */
const STORE_KEY = Symbol.for('zentra.api.rate-limit.store');

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: Map<string, Window>;
};

/** Return the process-wide window map, creating it on first use. */
function getStore(): Map<string, Window> {
  const scope = globalThis as GlobalWithStore;
  let store = scope[STORE_KEY];
  if (!store) {
    store = new Map<string, Window>();
    scope[STORE_KEY] = store;
  }
  return store;
}

/**
 * Drop expired windows, then evict the soonest-to-expire survivors until the
 * map is back under `MAX_KEYS`. Only called when the cap is exceeded, so the
 * O(n) work stays off the common request path. The active key is never evicted.
 */
function prune(store: Map<string, Window>, now: number, activeKey: string): void {
  for (const [key, window] of store) {
    if (key !== activeKey && now >= window.resetAt) {
      store.delete(key);
    }
  }
  if (store.size <= MAX_KEYS) return;

  const oldestFirst = Array.from(store.entries())
    .filter(([key]) => key !== activeKey)
    .sort((a, b) => a[1].resetAt - b[1].resetAt);

  const excess = store.size - MAX_KEYS;
  for (let i = 0; i < excess && i < oldestFirst.length; i += 1) {
    const victim = oldestFirst[i];
    if (victim) store.delete(victim[0]);
  }
}

/** Count one hit against `key` and report whether it fits inside the window. */
export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options;
  const store = getStore();
  const now = Date.now();

  let window = store.get(key);
  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + windowMs };
    store.set(key, window);
  }

  window.count += 1;

  if (store.size > MAX_KEYS) {
    prune(store, now, key);
  }

  const ok = window.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - window.count),
    resetAt: window.resetAt,
    retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000)),
  };
}

/**
 * Derive a stable bucket key for a caller: the scope plus the best available
 * client IP from the usual proxy headers, falling back to `unknown`. The raw
 * header value is never returned or logged.
 */
export function clientKey(request: Request, scope: string): string {
  const headers = request.headers;

  const forwarded = headers.get('x-forwarded-for');
  const firstHop = forwarded?.split(',')[0]?.trim();

  const ip =
    firstHop ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    'unknown';

  return `${scope}:${ip}`;
}

/** Standard `X-RateLimit-*` response headers; reset is epoch seconds. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

/** Clear every tracked window. Exists so unit tests can start from a clean slate. */
export function resetRateLimiter(): void {
  getStore().clear();
}
