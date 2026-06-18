import { HudPanel, Eyebrow } from './primitives';

const CODE = `const guarded = zentra.guard(agent, policy);

await guarded.pay({
  recipient: vendorA,
  amount: 50_000_000n,   // 5 XLM
  invoicePreimage,
});
// proving → proof-ready → submitting → released`;

export function CodeSample() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow>ZENTRA // THREE LINES</Eyebrow>
        <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Guard an agent. The proof happens for you.
        </h2>

        <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:items-center">
          <p className="text-fd-muted-foreground">
            <code>guard()</code> wraps your agent so its only way to move money is
            through a proof. A disallowed recipient throws before any proof is even
            generated — the prompt-injection defense, for free.
          </p>

          <HudPanel className="overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-fd-border px-4 py-2.5">
              <span className="size-2 rounded-full bg-denied/70" />
              <span className="size-2 rounded-full bg-violet-soft/70" />
              <span className="size-2 rounded-full bg-cyan/70" />
              <span className="ml-2 font-mono text-[11px] text-fd-muted-foreground">agent.ts</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-fd-foreground">
              <code>{CODE}</code>
            </pre>
          </HudPanel>
        </div>

        <a
          href="/docs/quickstart"
          className="mt-6 inline-block text-sm text-fd-primary hover:underline"
        >
          Read the Quickstart →
        </a>
      </div>
    </section>
  );
}
