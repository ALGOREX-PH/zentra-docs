import { cn } from '@/lib/cn';
import { Eyebrow } from './primitives';

const QUESTIONS = [
  { tag: 'Identity', q: 'Who is this agent?', ok: true },
  { tag: 'Permissions', q: 'What is it allowed to do?', ok: true },
  { tag: 'Zentra', q: 'Did this action, right now, obey the rules — privately?', ok: false },
];

export function TheGap() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow>ZENTRA // THE GAP</Eyebrow>
        <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Identity and permissions can't tell you whether a payment, right now,
          obeyed the rules.
        </h2>

        <div className="mt-10 grid gap-px overflow-hidden border border-fd-border bg-fd-border sm:grid-cols-3">
          {QUESTIONS.map((item) => (
            <div key={item.tag} className="relative bg-panel p-6">
              {!item.ok && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-cyan" />}
              <div className="font-mono text-xs text-fd-muted-foreground">{item.tag}</div>
              <p className="mt-3 text-sm text-fd-foreground">{item.q}</p>
              <div className="mt-5">
                <span
                  className={cn(
                    'font-mono text-xs',
                    item.ok ? 'text-fd-muted-foreground' : 'text-cyan',
                  )}
                >
                  {item.ok ? '✓ answered' : '← answered by Zentra'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
