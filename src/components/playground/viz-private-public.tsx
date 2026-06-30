import { cn } from '@/lib/cn';

type RedactedItem = {
  label: string;
  width: number;
};

type RevealedItem = {
  label: string;
  value: string;
};

const privateItems: RedactedItem[] = [
  { label: 'Max amount', width: 64 },
  { label: 'Daily limit', width: 88 },
  { label: 'Vendor list', width: 72 },
  { label: 'Policy salt', width: 96 },
  { label: 'Invoice', width: 56 },
];

const publicItems: RevealedItem[] = [
  { label: 'Commitment', value: '0x9f3a…' },
  { label: 'Vendor root', value: '0x71b2…' },
  { label: 'Amount', value: '75.0' },
  { label: 'Nullifier', value: '0x4e8c…' },
  { label: 'New spent', value: '375.0' },
];

export function VizPrivatePublic() {
  return (
    <div>
      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="border border-violet/40 bg-panel p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden>🔒</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-violet-soft">
              Private · hidden
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {privateItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-[11px] text-faint">{item.label}</span>
                <span
                  className="inline-block h-3 rounded-sm bg-violet/30"
                  style={{ width: item.width }}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-faint">Never leaves your browser.</p>
        </div>

        <div className="flex flex-col items-center justify-center px-1">
          <div className="border border-cyan/40 bg-abyss px-3 py-2 text-center">
            <span className="font-display text-lg text-cyan">π</span>
          </div>
          <span className="mt-1 font-mono text-[10px] text-faint">proof</span>
          <span className="mt-1 text-[10px] text-faint">proves</span>
        </div>

        <div className="border border-cyan/40 bg-panel p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden>👁</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-cyan">
              Public · revealed
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {publicItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-[11px] text-faint">{item.label}</span>
                <span className={cn('font-mono text-[11px] text-cyan')}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-faint">Anyone can check these.</p>
        </div>
      </div>

      <p className="mt-4 text-center text-[12px] text-muted">
        The proof links the hidden side to the public side — proving they&apos;re
        consistent without revealing the secrets.
      </p>
    </div>
  );
}
