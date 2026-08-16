'use client';

import { useEffect, useId, useState } from 'react';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { SIGNUP_GOAL } from '@/config/app';
import { isOnboardCount, readApiError } from '@/lib/api/client';

/**
 * The public signup counter for the growth campaign.
 *
 * Every figure here comes from `GET /api/onboard`, which returns a count and
 * nothing else, and the panel says so — a progress bar is only worth putting in
 * front of someone if they can tell it is measuring something real. There is no
 * seeded floor and no placeholder: a genuine zero is rendered as a zero, worded
 * as an opening rather than as a stall.
 *
 * The goal is a target, not a cap — the bar tops out at 100% while the number
 * keeps climbing past it. It defaults to the campaign-wide constant so this
 * panel and /metrics can never quietly disagree about the target; the prop
 * stays overridable for a surface measuring a different campaign.
 */
export function JoinProgress({ goal = SIGNUP_GOAL }: { goal?: number }) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const labelId = useId();

  useEffect(() => {
    let cancelled = false;

    fetch('/api/onboard')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiError(res, 'Could not load the signup count.'));
        // Asserting the shape would let an edge error page through as a count
        // of `undefined`, which the bar would then render as a NaN width.
        const body: unknown = await res.json();
        if (!isOnboardCount(body)) throw new Error('Could not load the signup count.');
        return body;
      })
      .then((json) => {
        if (!cancelled) setCount(json.count);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const percent = count === null || goal <= 0 ? 0 : Math.min(100, (count / goal) * 100);

  /**
   * How many registrations the target is still short of.
   *
   * Clamped at zero so passing the target reads as passing it rather than as a
   * negative shortfall, and the number is derived from the count rather than
   * tracked separately — there is only ever one figure here, the one the API
   * returned.
   */
  const remaining = count === null ? goal : Math.max(0, goal - count);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="cyan">TESTNET PROGRAMME · PROGRESS</Eyebrow>

        {loading ? (
          <p className="font-mono text-sm text-muted">Loading signups…</p>
        ) : count === null || failed ? (
          // A marketing page should degrade quietly: a missing counter is our
          // problem, not the visitor's, and a red error block would only make
          // the programme look broken.
          <p className="font-mono text-xs text-faint">
            Signup count is unavailable right now — the form below still works.
          </p>
        ) : count === 0 ? (
          // An empty bar next to "0 of 50" reads as a stalled programme. Saying
          // it plainly turns the same fact into the reason to be the first.
          <>
            <p className="font-mono text-sm text-muted">No signups yet — be the first of {goal}.</p>
            <p className="mt-2.5 font-mono text-[11px] text-faint">
              Counted live from the registry. Nothing is seeded, so this is a real zero.
            </p>
          </>
        ) : (
          <>
            <p id={labelId} className="font-mono text-sm text-muted">
              <span className="font-display text-3xl text-text">{count}</span> of {goal} testnet
              users onboarded
            </p>
            <div
              role="progressbar"
              aria-valuenow={count}
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-labelledby={labelId}
              className="mt-3 h-2 w-full border border-fd-border bg-abyss"
            >
              <span
                aria-hidden
                className="block h-full bg-gradient-to-r from-violet to-cyan transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            {/*
              The shortfall spelled out next to where the count came from. A
              visitor deciding whether to bother wants one number — how many are
              still needed — and one reason to believe it, which is that the
              panel is reading the registry rather than telling a story about it.
            */}
            <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[11px]">
              <span className="text-cyan">
                {remaining > 0 ? `${remaining} more to reach ${goal}` : `Target of ${goal} reached`}
              </span>
              <span className="text-faint">Counted live from the registry</span>
            </div>
          </>
        )}
      </div>
    </HudPanel>
  );
}
