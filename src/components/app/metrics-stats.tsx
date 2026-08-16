'use client';

import { type ReactNode, useEffect, useId, useState } from 'react';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { SIGNUP_GOAL } from '@/config/app';
import { contractsConfigured } from '@/config/contract';
import { activeProfile } from '@/config/network';
import { isOnboardCount, readApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { getCount, getLatestLedger, getRecent } from '@/lib/stellar/action-log';
import { getFeedbackAuthors, getFeedbackCount } from '@/lib/stellar/feedback';

/**
 * How many recent entries each contract is asked for when counting distinct
 * wallets.
 *
 * Both contracts expose `get_recent(limit)` rather than a set of authors, and
 * each clamps `limit` to its own `MAX_RECENT` of 20 — asking for more returns
 * no more. So the distinct-wallet count is derived from a window, and once the
 * on-chain totals exceed that window it is a lower bound, reported as such
 * rather than silently under-counting.
 */
const SAMPLE = 20;

/*
 * `SIGNUP_GOAL` and `isOnboardCount` come from the shared modules rather than
 * being declared here: /join renders the same goal and narrows the same
 * response, and two private copies is how the two panels drift apart. The
 * goal stays a constant, never a prop — it is a fixed external requirement
 * (`docs/users/README.md`), and a caller able to lower it could make any
 * count look like it had arrived.
 */

/**
 * The moment of a read, in UTC to the second.
 *
 * Deliberately not locale-formatted. A screenshot of this panel is read by
 * somebody in another timezone with no way to ask which one rendered it, and an
 * ambiguous timestamp evidences nothing.
 */
function formatReadAt(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * The adoption panel: registry signups beside live on-chain usage read straight
 * from the Soroban contracts — total interactions across the action-log and
 * feedback contracts, the distinct wallets behind them, and the network.
 *
 * Two sources, two populations, deliberately never merged. The signup registry
 * is a Postgres table read through `GET /api/onboard` and says only that somebody
 * registered; the wallet and interaction figures are contract reads and say that
 * somebody transacted. Nobody proves ownership of the address they typed into a
 * form, so the two numbers are not interchangeable and neither is derived from
 * the other — which is precisely the substitution a reviewer makes if the panel
 * does not label each figure with what it measures.
 *
 * Every figure is a live read. A source that fails renders its own failure rather
 * than a zero or a last-known value: a plausible-looking stand-in inside a panel
 * whose entire purpose is proof is worse than an empty cell.
 */
export function MetricsStats({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [interactions, setInteractions] = useState<number | null>(null);
  const [wallets, setWallets] = useState<number | null>(null);
  const [partial, setPartial] = useState(false);
  const [ledger, setLedger] = useState<number | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signups, setSignups] = useState<number | null>(null);
  const [signupsLoading, setSignupsLoading] = useState(true);
  const [signupsError, setSignupsError] = useState<string | null>(null);
  const goalLabelId = useId();

  useEffect(() => {
    // A network with nothing deployed has nothing to simulate against: every
    // read below would be issued with an empty contract id and fail opaquely.
    // The render states the gap instead (see below); the signup registry is
    // Postgres, not the chain, so its effect still runs untouched.
    if (!contractsConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [actionTotal, actionRecent, feedbackTotal, feedbackAuthors, sequence] =
          await Promise.all([
            getCount(),
            getRecent(SAMPLE),
            getFeedbackCount(),
            getFeedbackAuthors(SAMPLE),
            getLatestLedger(),
          ]);
        if (cancelled) return;
        // The ledger and the clock are set from the same settled read as the
        // figures, so the provenance line can never describe a different moment
        // than the numbers beside it.
        setLedger(sequence);
        setReadAt(new Date());
        setInteractions(actionTotal + feedbackTotal);
        setWallets(new Set([...actionRecent.map((e) => e.author), ...feedbackAuthors]).size);
        // Compare against the contracts' own totals rather than the requested
        // window: they clamp the limit internally, so a returned page being
        // "full" proves nothing. If either total exceeds what we actually saw,
        // older authors went uncounted and the figure is a floor.
        setPartial(actionTotal > actionRecent.length || feedbackTotal > feedbackAuthors.length);
      } catch {
        if (cancelled) return;
        // Everything the failed read was meant to produce is cleared, provenance
        // included. Figures from an earlier load surviving beside a fresh error
        // are presented as current when they are not, and a ledger and read time
        // left behind would date the panel to a moment its contents no longer
        // come from. The em dashes and the error line are the honest reading.
        setInteractions(null);
        setWallets(null);
        setPartial(false);
        setLedger(null);
        setReadAt(null);
        setError('Could not load on-chain stats.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  /**
   * The signup registry, fetched separately from the contracts on purpose.
   *
   * Postgres and public RPC fail independently, and a database outage must not
   * blank the chain figures — nor an RPC outage the signup count. Two effects
   * keep each source's failure confined to the cell it belongs to, which is what
   * lets the panel report a partial read honestly instead of collapsing to one
   * all-or-nothing error.
   */
  useEffect(() => {
    let cancelled = false;
    setSignupsLoading(true);
    setSignupsError(null);
    fetch('/api/onboard')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiError(res, 'Could not load the signup count.'));
        const body: unknown = await res.json();
        if (!isOnboardCount(body)) throw new Error('Could not load the signup count.');
        return body.count;
      })
      .then((count) => {
        if (!cancelled) setSignups(count);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // The previous count is dropped along with the error. A number left on
        // screen beside a fresh failure is presented as current when it is not,
        // and this panel is read as evidence.
        setSignups(null);
        setSignupsError(
          cause instanceof Error ? cause.message : 'Could not load the signup count.',
        );
      })
      .finally(() => {
        if (!cancelled) setSignupsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  const busy = loading || signupsLoading;

  return (
    <div aria-busy={busy} className={cn('flex flex-col gap-2', busy && 'opacity-95')}>
      {/*
        One framed panel rather than a row of loose tiles. The adoption claim is
        only credible read together — the wallets that transacted, what they did,
        and the chain it happened on — and a reviewer has to be able to capture
        the whole thing in one screenshot without cropping half the evidence out.
      */}
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">// ADOPTION · PROOF OF USE</Eyebrow>

          {/*
            Provenance, so an image of this panel stands on its own: which chain
            the figures were simulated against, the ledger the chain was at when
            they were read, and when that was. The ledger is the part a reviewer
            can independently check — it dates the read to a block, not to a
            caption. Both are omitted until a read has actually settled rather
            than shown as pending, because an empty slot cannot be misread as a
            fact.
          */}
          <div className="-mt-2 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
            <span className="text-cyan">{activeProfile.label}</span>
            {ledger === null ? null : <span>ledger #{ledger.toLocaleString('en-US')}</span>}
            {readAt === null ? null : <span>chain read {formatReadAt(readAt)}</span>}
          </div>

          {/*
            Progress against the 50-user target, as the count and the shortfall.
            Whatever the registry holds is what appears here — a zero renders as a
            zero, and the remainder is computed from it rather than stated. The
            panel is only worth screenshotting if the unflattering readings show
            up in it too.
          */}
          <div className="mb-5">
            {signupsLoading ? (
              <p className="font-mono text-xs text-muted">Reading the signup registry…</p>
            ) : signups === null ? (
              <p className="font-mono text-xs text-denied">
                {signupsError ?? 'Could not load the signup count.'}
              </p>
            ) : (
              <>
                <p id={goalLabelId} className="font-mono text-sm text-muted">
                  <span className="font-display text-4xl font-bold text-text">{signups}</span> of{' '}
                  {SIGNUP_GOAL} registry signups
                  <span className="text-faint">
                    {' · '}
                    {signups >= SIGNUP_GOAL ? 'target met' : `${SIGNUP_GOAL - signups} remaining`}
                  </span>
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={signups}
                  aria-valuemin={0}
                  aria-valuemax={SIGNUP_GOAL}
                  aria-labelledby={goalLabelId}
                  className="mt-3 h-2 w-full border border-fd-border bg-abyss"
                >
                  <span
                    aria-hidden
                    className="block h-full bg-gradient-to-r from-violet to-cyan transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (signups / SIGNUP_GOAL) * 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>

          {/*
            The readouts fall back to an em dash whenever a figure is missing,
            which reads the same whether the contracts are still being queried,
            refused to answer, or genuinely hold nothing. One line above them
            says which.
          */}
          {!contractsConfigured ? (
            // A visible statement, not a silent skip: em dashes below would
            // otherwise read as an outage when the truth is that this network
            // has no contracts deployed to read from yet.
            <p className="font-mono text-xs text-denied">
              Contracts are not configured for {activeProfile.label} yet, so the on-chain figures
              cannot be read. Registry signups above are unaffected.
            </p>
          ) : loading ? (
            <p className="font-mono text-xs text-muted">Reading the contracts…</p>
          ) : error ? (
            <p className="font-mono text-xs text-denied">{error}</p>
          ) : interactions === 0 ? (
            <p className="font-mono text-xs text-muted">
              No on-chain activity yet — record an action or leave feedback to start these counters.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Readout
              label="REGISTRY SIGNUPS"
              value={signups ?? '—'}
              // The note stays on what the figure measures in every state. Its
              // loading and failure lines are already rendered once, above, where
              // the count itself is — repeating them here would put two red lines
              // about one outage in a panel that has to be read at a glance.
              note="Rows in the signup registry — people who registered. Not evidence that they transacted."
            />
            <Readout
              label="WALLETS SEEN ON-CHAIN"
              value={wallets === null ? '—' : `${wallets}${partial ? '+' : ''}`}
              note={
                partial
                  ? `Lower bound — distinct authors within the last ${SAMPLE} entries per contract, which is the most either read returns.`
                  : 'Distinct addresses that signed a recorded interaction, counted from the chain.'
              }
            />
            <Readout
              label="ON-CHAIN INTERACTIONS"
              value={interactions ?? '—'}
              note="Exact totals from the action-log and feedback contracts' own counters."
            />
            <Readout
              accent="cyan"
              label="NETWORK"
              // Named by the active profile rather than typed in. The chain is a
              // deploy-time choice, and a readout that says "Testnet" on a
              // mainnet build is not a stale label — it is a false claim about
              // where every other figure in this panel was read from.
              value={activeProfile.label}
              note="Soroban — every on-chain figure here is simulated against this network on load."
            />
          </div>

          {/*
            Inside the frame, not under it: the caveats have to travel with the
            image. Whoever quotes these figures from a screenshot needs the same
            sentence about where each came from that a reader of the page gets.
          */}
          <p className="mt-4 border-t border-violet/15 pt-4 font-mono text-[11px] leading-relaxed text-faint">
            Signups come from Postgres via GET /api/onboard, which is edge-cached for up to 30
            seconds; wallets and interactions are read from the contracts on every load. Nothing
            here is seeded or estimated — a source that cannot be read says so in place of its
            figure.
          </p>
        </div>
      </HudPanel>
    </div>
  );
}

/**
 * One readout cell inside the panel: what is being measured, the figure, and the
 * caveat that keeps the figure from being over-read.
 *
 * The note is not decoration. Signups, wallets and interactions are three
 * different populations, and a bare number under a three-word label is exactly
 * how a reviewer ends up quoting one as another — so every cell has to state
 * what it counts. Plain bordered cells rather than nested {@link HudPanel}s,
 * because the panel already owns the corner brackets.
 */
function Readout({
  label,
  value,
  note,
  accent = 'violet',
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  accent?: 'violet' | 'cyan';
}) {
  return (
    <div
      className={cn(
        'border bg-abyss/60 p-4',
        accent === 'cyan' ? 'border-cyan/30' : 'border-violet/20',
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div
        className={cn(
          'mt-1 font-display text-3xl font-bold',
          accent === 'cyan' ? 'text-cyan' : 'text-text',
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">{note}</div>
    </div>
  );
}
