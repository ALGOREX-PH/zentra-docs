import { cn } from '@/lib/cn';
import { protocol } from '@/config/protocol';

const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-3)}`;

const CELLS: Array<{ k: string; v: string; tone?: string }> = [
  { k: 'NETWORK', v: 'STELLAR-TESTNET' },
  { k: 'CONTRACT', v: shortId(protocol.contractId), tone: 'text-violet-soft' },
  { k: 'PROOF', v: 'GROTH16·BN254' },
  { k: 'PUBLIC_INPUTS', v: '14' },
  { k: 'CPU_BUDGET', v: 'OK', tone: 'text-live' },
  { k: 'POLICY', v: 'COMMITTED', tone: 'text-cyan' },
];

/** The terminal status strip beneath the nav. */
export function SystemBar() {
  return (
    <div className="flex h-[30px] items-center overflow-x-auto border-b border-fd-border bg-abyss">
      <div className="flex items-center whitespace-nowrap font-mono text-[10px] tracking-[0.06em]">
        {CELLS.map((c) => (
          <span key={c.k} className="border-r border-fd-border px-4 text-faint">
            {c.k} <span className={cn('ml-1', c.tone ?? 'text-muted')}>{c.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
