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
 * The bucket a caller lands in is derived in `clientKey`, and it is derived
 * only from headers the platform sets for itself. A limiter keyed on something
 * the caller chooses is not a limiter at all — it is a counter the attacker
 * resets — so that derivation matters more here than the counting does.
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
 * Headers only the edge in front of us sets, in the order we trust them.
 *
 * Each of these is written by the platform's own proxy and *replaced* rather
 * than appended to, so a value a client sends is overwritten before the request
 * reaches this process. `x-forwarded-for` is deliberately absent from this list
 * — see `clientAddress` for why it is read differently.
 */
const TRUSTED_ADDRESS_HEADERS = ['x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip'];

/** The bucket every request whose caller we cannot identify shares. */
const UNKNOWN_ADDRESS = 'unknown';

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A second, unrelated starting point, so two passes give two 32-bit halves. */
const FNV_SECOND_BASIS = 0x5bf03635;

/**
 * Derive a stable bucket key for a caller: the scope plus a digest of the best
 * client address the *platform* — not the caller — vouches for.
 *
 * This is the second half of ZEN-12. The old derivation took the leftmost hop
 * of `x-forwarded-for`, which is the one furthest from us and therefore the one
 * the client wrote: on any deployment whose proxy appends rather than replaces,
 * a caller could pick their own bucket by sending a fresh value per request and
 * never share a window with themselves. Reading the *rightmost* hop inverts
 * that — it is the entry our own nearest proxy appended, and an attacker can
 * only add entries to the left of it — and the platform's dedicated headers are
 * preferred over the list entirely, because they are replaced wholesale.
 *
 * The address is then folded into a fixed-width digest rather than being
 * concatenated in raw. Three reasons, all of them about the address being
 * hostile input: an 8KB header would otherwise become an 8KB map key and the
 * cap on tracked keys would stop bounding memory; a value containing the `:`
 * separator could shape the key into another scope's namespace; and the digest
 * is what makes this module's standing promise — that the raw header value is
 * never returned or logged — actually true.
 */
export function clientKey(request: Request, scope: string): string {
  return `${scope}:${digest(clientAddress(request))}`;
}

/**
 * The client address this deployment is willing to stand behind.
 *
 * Falls back to `unknown` when nothing identifies the caller, which buckets
 * every such request together — the safe direction, since it throttles harder
 * rather than softer.
 */
function clientAddress(request: Request): string {
  for (const header of TRUSTED_ADDRESS_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) return value;
  }

  // The nearest hop, not the furthest: everything to the left of the last entry
  // was supplied by whoever sent the request, and only the last was written by
  // the proxy that actually accepted the connection.
  const forwarded = request.headers.get('x-forwarded-for');
  const hops = forwarded?.split(',') ?? [];
  const nearest = hops[hops.length - 1]?.trim();

  return nearest || UNKNOWN_ADDRESS;
}

/**
 * Fold `value` into 16 hex characters, cheaply and without a dependency.
 *
 * Two FNV-1a passes from different starting points, concatenated. This is not a
 * cryptographic hash and is not meant to be — nothing here needs preimage
 * resistance, only that distinct addresses land in distinct buckets often
 * enough that a shared bucket is a rounding error rather than a way in. Sixty
 * four bits is far past that for a map holding at most `MAX_KEYS` entries.
 */
function digest(value: string): string {
  const high = fnv1a(value, FNV_OFFSET_BASIS);
  const low = fnv1a(value, FNV_SECOND_BASIS);
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

/** One FNV-1a pass over `value`, seeded at `basis`, as an unsigned 32-bit int. */
function fnv1a(value: string, basis: number): number {
  let hash = basis;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit integer space; a plain `*` would
    // overflow into a float and quietly lose the low bits the hash depends on.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
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
