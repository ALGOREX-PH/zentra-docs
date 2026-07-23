'use client';

import { useEffect, useId, useState } from 'react';
import { readApiError } from '@/lib/api/client';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';

interface OnboardCount {
  count: number;
}

/**
 * The public signup counter for the growth campaign.
 *
 * Social proof is the point: a visitor who can see the programme is real and
 * filling up is likelier to finish the form below it. The goal is a target, not
 * a cap — the bar tops out at 100% while the number keeps climbing past it.
 */
export function JoinProgress({ goal = 50 }: { goal?: number }) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const labelId = useId();

  useEffect(() => {
    let cancelled = false;

    fetch('/api/onboard')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiError(res, 'Could not load the signup count.'));
        return (await res.json()) as OnboardCount;
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
          </>
        )}
      </div>
    </HudPanel>
  );
}
