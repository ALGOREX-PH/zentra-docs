import { cn } from '@/lib/cn';
import { protocol } from '@/config/protocol';
import { SIGNALS } from '@/lib/zk/education';
import { shorten } from '@/lib/ui';

const CELLS: Array<{ k: string; v: string; tone?: string }> = [
  { k: 'NETWORK', v: 'STELLAR-TESTNET' },
  { k: 'CONTRACT', v: shorten(protocol.contractId, 4, 3), tone: 'text-violet-soft' },
  { k: 'PROOF', v: 'GROTH16·BN254' },
  // Derived from the shared signal contract, so the badge can never drift.
  { k: 'PUBLIC_INPUTS', v: String(SIGNALS.length) },
  { k: 'CPU_BUDGET', v: 'OK', tone: 'text-live' },
  { k: 'POLICY', v: 'COMMITTED', tone: 'text-cyan' },
];

/** The terminal status strip beneath the nav. */
export function SystemBar() {
  return (
    <div className="flex h-[30px] items-center overflow-x-auto border-b border-fd-border bg-abyss">
      <dl
        aria-label="Protocol status"
        className="flex items-center whitespace-nowrap font-mono text-[10px] tracking-[0.06em]"
      >
        {CELLS.map((c) => (
          <div key={c.k} className="flex items-center gap-2.5 border-r border-fd-border px-4">
            <dt className="text-[#7d8ea6]">{c.k}</dt>
            <dd className={cn(c.tone ?? 'text-muted')}>{c.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
