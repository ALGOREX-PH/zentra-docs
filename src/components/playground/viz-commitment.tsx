import { cn } from '@/lib/cn';

export function VizCommitment() {
  return (
    <div>
      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center">
        <div className="border border-violet/40 bg-panel px-4 py-4 text-center">
          <span aria-hidden>
            <span className="font-display text-xl">🔒</span>
          </span>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-violet-soft">
            Secret policy
          </div>
          <div className="mt-1 text-[11px] text-faint">limits · vendors · salt</div>
        </div>

        <div className="flex flex-col items-center justify-center px-1">
          <span className="text-cyan text-xl">→</span>
          <span className="mt-1 font-mono text-[9px] text-faint">Poseidon hash</span>
        </div>

        <div className="border border-cyan/40 bg-panel px-4 py-4 text-center">
          <span className="font-display text-xl text-cyan">◆</span>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-cyan">
            Commitment
          </div>
          <div className="mt-1 font-mono text-[11px] text-cyan">0x9f3a…c41d</div>
          <div className="mt-1 text-[11px] text-faint">public · on-chain</div>
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-2 text-center text-[12px] text-muted">
        <span className={cn('relative font-mono text-denied')}>
          <span aria-hidden>←</span>
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-denied"
          />
        </span>
        One-way: the commitment reveals nothing about the secret.
      </p>
    </div>
  );
}
