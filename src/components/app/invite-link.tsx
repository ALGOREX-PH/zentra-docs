'use client';

import { useEffect, useRef, useState } from 'react';
import { focusRing } from '@/lib/ui';
import { cn } from '@/lib/cn';

/*
 * Mirrors of join-form's field and secondary-action atoms, kept locally so the
 * copy block matches the form it renders under pixel for pixel. Importing them
 * from join-form would make the two modules circular — join-form imports this
 * component — and they are not yet shared by a third surface, which is the bar
 * for promoting them into `@/lib/ui`.
 */
const fieldClass = cn(
  'w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
  focusRing,
);

const secondaryAction = cn(
  'inline-flex shrink-0 items-center gap-2 border border-fd-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan',
  focusRing,
);

/**
 * A copyable link back to /join, shown to the person who has just used it.
 *
 * Fifty registrations have to come from somewhere, and the cheapest source is a
 * visitor who already finished the form. Plain clipboard and a selectable field —
 * no share SDK, no third-party script, nothing that reports who was invited.
 */
export function InviteLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  /*
   * The origin is read from the live document, not from `@/lib/site`. That
   * module falls back to a placeholder domain in the browser — the Vercel
   * production URL it prefers is not a `NEXT_PUBLIC_` variable, so it is simply
   * absent client-side — and a share link nobody can open is worse than no
   * share link. Reading `location` also keeps preview deployments shareable.
   * In an effect rather than an initialiser because `location` does not exist
   * during prerender, and a value that differed would be a hydration mismatch.
   */
  useEffect(() => {
    setUrl(new URL('/join', window.location.origin).toString());
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setManual(false);
      setCopied(true);
    } catch {
      // Denied permissions, an insecure origin, or a browser without the API.
      // The link is already on screen, so the recovery is to select it for them
      // rather than to report a failure they can do nothing about.
      setManual(true);
      field.current?.select();
    }
  }

  if (url === null) return null;

  return (
    <div className="mt-5 border-t border-fd-border pt-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
        Bring one more
      </p>
      <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
        The programme is fifty people. Send this to one person building with agents
        on Stellar.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          ref={field}
          type="text"
          readOnly
          value={url}
          aria-label="Invite link to the Zentra testnet programme"
          // Selected on focus so a keyboard or a long-press can copy it without
          // dragging across 30-odd characters of URL.
          onFocus={(event) => event.currentTarget.select()}
          className={cn(fieldClass, 'sm:flex-1')}
        />
        <button type="button" onClick={() => void copy()} className={secondaryAction}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {/* Mounted from the first render so the outcome is spoken rather than
          created and filled in one tick, which screen readers routinely miss. */}
      <p
        role="status"
        className={cn('font-mono text-[11px] text-faint', (copied || manual) && 'mt-2')}
      >
        {manual
          ? 'Clipboard is blocked here — the link is selected, copy it with your keyboard.'
          : copied
            ? 'Link copied.'
            : ''}
      </p>
    </div>
  );
}
