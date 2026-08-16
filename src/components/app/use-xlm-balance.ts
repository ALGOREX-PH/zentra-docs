'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getXlmBalance } from '@/lib/stellar/account';
import { describeError } from '@/lib/stellar/errors';
import { LIVE_POLL_MS } from '@/config/app';

/**
 * What every consumer of the balance read sees. One object, replaced
 * immutably on every change so `useSyncExternalStore` can compare by identity.
 */
export interface XlmBalanceState {
  /**
   * The last successfully read balance. `null` before the first read settles
   * and for an account Horizon has never seen — `loading` and `funded`
   * separate the two. A later failed refresh keeps the last good value; the
   * figure is still real, and `error` says it may be stale.
   */
  balance: string | null;
  /**
   * Whether the account can pay a fee: a settled read found more than 0 XLM.
   * `null` until a read has settled, because neither "still reading" nor "the
   * read failed" is evidence about the account. The one definition both the
   * balance card and the onboarding guide share — previously each derived its
   * own.
   */
  funded: boolean | null;
  /** Whether a read is in flight with nothing settled to show for it yet. */
  loading: boolean;
  /** The last read's failure, human-readable, or null once a read succeeds. */
  error: string | null;
}

const IDLE: XlmBalanceState = { balance: null, funded: null, loading: false, error: null };

/*
 * One store for the whole app, not one per hook instance. The balance card and
 * the onboarding guide sit on the same page watching the same account; as
 * independent hook states they would run two identical Horizon polls and the
 * card's Friendbot funding would be invisible to the guide until its next
 * tick. Module scope makes the read genuinely shared: one poll, and a
 * `refresh()` from any consumer lands in front of every consumer at once.
 * The store follows the single connected wallet — the last address passed to
 * the hook wins, which is the only case this dApp has.
 */
let snapshot: XlmBalanceState = IDLE;
let watchedAddress: string | null = null;
/** Bumped whenever the target changes, so an in-flight read for a previous
 * address (or a superseded refresh) discovers it is stale and commits nothing. */
let readSeq = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify(next: XlmBalanceState) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The funding rule, in one place: `null` (never created) and `'0'` both mean
 * the account cannot pay a fee, so both read as unfunded. */
function fundedFrom(balance: string | null): boolean {
  const amount = balance === null ? 0 : Number(balance);
  return Number.isFinite(amount) && amount > 0;
}

async function read(address: string): Promise<void> {
  const seq = ++readSeq;
  try {
    const balance = await getXlmBalance(address);
    if (seq !== readSeq || address !== watchedAddress) return;
    notify({ balance, funded: fundedFrom(balance), loading: false, error: null });
  } catch (cause) {
    if (seq !== readSeq || address !== watchedAddress) return;
    // The last good figures stay — they are still the most recent truth — with
    // the error alongside so consumers can say the read is failing.
    notify({ ...snapshot, loading: false, error: describeError(cause) });
  }
  // A read settling can open or close the polling condition (funded flipped).
  schedule();
}

/**
 * Whether the interval should be running: someone is watching an address that
 * still cannot transact, and the tab is actually visible. A hidden tab reads
 * nothing — the user cannot see the answer, and a laptop lid closed overnight
 * should not hit Horizon every six seconds until it reopens.
 */
function shouldPoll(): boolean {
  return (
    listeners.size > 0 &&
    watchedAddress !== null &&
    snapshot.funded !== true &&
    typeof document !== 'undefined' &&
    document.visibilityState !== 'hidden'
  );
}

/** Starts or stops the shared interval to match `shouldPoll`. Idempotent, so
 * every state change can call it without bookkeeping. */
function schedule(): void {
  if (shouldPoll()) {
    if (timer === null) {
      timer = setInterval(() => {
        if (watchedAddress !== null) void read(watchedAddress);
      }, LIVE_POLL_MS);
    }
  } else if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function onVisibilityChange(): void {
  schedule();
  // Coming back to a visible tab, the poll may have been paused for hours;
  // answer immediately rather than making the user wait out a full period.
  if (document.visibilityState === 'visible' && watchedAddress !== null && snapshot.funded !== true) {
    void read(watchedAddress);
  }
}

/** Point the store at a (possibly different) account and start its first read. */
function setWatched(address: string | null): void {
  if (address === watchedAddress) return;
  watchedAddress = address;
  readSeq += 1; // orphan any in-flight read for the previous address
  if (address === null) {
    notify(IDLE);
  } else {
    notify({ balance: null, funded: null, loading: true, error: null });
    void read(address);
  }
  schedule();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  listeners.add(listener);
  schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      // Nobody is watching: stop polling and drop the cache, so the next page
      // that mounts a consumer starts from a fresh read instead of showing a
      // figure from however long ago the last consumer unmounted.
      document.removeEventListener('visibilitychange', onVisibilityChange);
      watchedAddress = null;
      readSeq += 1;
      snapshot = IDLE;
      schedule();
    }
  };
}

const getSnapshot = () => snapshot;
// On the server nothing is connected and nothing loads — the idle shape.
const getServerSnapshot = () => IDLE;

/**
 * The one owner of the XLM balance read for the connected account.
 *
 * Every consumer gets the same snapshot from the same poll: reads happen at
 * {@link LIVE_POLL_MS} while the account is unfunded (funding is the only
 * transition the dApp is waiting on), stop once it is funded, pause entirely
 * while the tab is hidden, and survive component unmounts without leaking a
 * timer. `refresh()` forces a read for every consumer at once — it is how the
 * Friendbot flow in the balance card becomes visible to the onboarding guide
 * in the same tick.
 */
export function useXlmBalance(address: string | null): XlmBalanceState & {
  refresh: () => void;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    setWatched(address);
  }, [address]);

  const refresh = useCallback(() => {
    if (watchedAddress === null) return;
    // Mirrors a manual retry: show the read in progress and clear the stale
    // error so the UI reports this attempt, not the last one.
    notify({ ...snapshot, loading: true, error: null });
    void read(watchedAddress);
  }, []);

  // A fresh object each render is fine: callers destructure, and the fields
  // themselves only change identity when the store actually changed.
  return { ...state, refresh };
}
