import { ZentraMark } from '@/components/brand/zentra-mark';

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
    <polyline points="2,7 6,11 12,3" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
  </svg>
);
const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 13 13" aria-hidden>
    <line x1="3" y1="3" x2="10" y2="10" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="square" />
    <line x1="10" y1="3" x2="3" y2="10" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="square" />
  </svg>
);

const ROWS = [
  { n: '01', ok: true, label: 'Identity', desc: 'Who is this agent?', tag: '// ERC-8004' },
  { n: '02', ok: true, label: 'Permission', desc: 'What may it access?', tag: '// ERC-7715' },
  { n: '03', ok: false, label: 'Compliance', desc: 'Did this action obey the rule right now?', tag: '' },
];

export function TheGap() {
  return (
    <section className="border-t border-violet/20 px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[920px]">
        <div className="mb-5 flex items-center gap-3.5">
          <span className="font-mono text-xs tracking-[0.12em] text-violet">[ 01 ] THE TRUST GAP</span>
          <span className="h-px flex-1 bg-violet/25" />
        </div>
        <h2 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[40px]">
          Three questions in agentic finance.
        </h2>
        <p className="mt-3 max-w-[560px] text-[17px] text-muted">
          Identity and permission are solved. The action-level question is not — and
          that is where money goes wrong.
        </p>

        <div className="mt-10 border border-fd-border">
          {ROWS.map((r) => (
            <div
              key={r.n}
              className="flex items-stretch border-b border-fd-border last:border-b-0"
              style={r.ok ? undefined : { background: 'rgba(239,68,68,0.04)' }}
            >
              <span className="flex w-12 shrink-0 items-center justify-center border-r border-fd-border bg-[#0a0c12] font-mono text-xs text-faint">
                {r.n}
              </span>
              <span className="flex w-9 shrink-0 items-center justify-center">
                {r.ok ? <Check /> : <Cross />}
              </span>
              <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-5 pr-5">
                <span className="w-[96px] shrink-0 font-display font-semibold sm:w-[120px]">{r.label}</span>
                <span className="text-[15px] text-[#cbd5e1]">
                  {r.ok ? r.desc : <>Did this action obey the rule <span className="font-semibold text-white">right now</span>?</>}
                  {r.tag && <span className="ml-2 font-mono text-xs text-faint">{r.tag}</span>}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div
          className="mt-6 flex items-center gap-4 border border-violet/40 px-6 py-5"
          style={{ background: 'linear-gradient(100deg,rgba(124,58,237,0.12),rgba(0,229,255,0.05))' }}
        >
          <ZentraMark size={22} tone="violet" bracketless />
          <div className="font-display text-base font-semibold sm:text-lg">
            Zentra answers the action-level question — with cryptography, not surveillance.
          </div>
        </div>
      </div>
    </section>
  );
}
