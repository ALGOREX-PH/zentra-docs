import Link from 'next/link';

export function Closing() {
  return (
    <>
      <section className="px-5 py-12 sm:px-7 sm:py-16">
        <div className="relative mx-auto max-w-[880px] border border-violet/40 bg-[#0a0c12] px-6 py-7 sm:px-10 sm:py-9">
          <span className="absolute -left-px -top-px h-3.5 w-3.5 border-l-2 border-t-2 border-violet" />
          <span className="absolute -right-px -top-px h-3.5 w-3.5 border-r-2 border-t-2 border-violet" />
          <span className="absolute -bottom-px -left-px h-3.5 w-3.5 border-b-2 border-l-2 border-violet" />
          <span className="absolute -bottom-px -right-px h-3.5 w-3.5 border-b-2 border-r-2 border-violet" />
          <div className="mb-[18px] font-mono text-[11px] tracking-[0.14em] text-faint">// BOUNDARY</div>
          <p className="mb-4 font-display text-[22px] font-semibold leading-[1.45] tracking-[-0.01em]">
            Zentra is a proof-of-compliance and settlement layer.
          </p>
          <p className="text-base leading-relaxed text-muted">
            It is not an identity system, an oracle, a policy author, a key manager,
            or a full compliance engine. That boundary stays explicit — it makes the
            protocol more credible, not less.
          </p>
        </div>
      </section>

      <section className="px-5 pb-16 pt-4 sm:px-7 sm:pb-24 sm:pt-5">
        <div className="mx-auto max-w-[760px] text-center">
          <h2 className="text-balance font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl md:text-[46px]">
            Build a guarded agent in 15 minutes.
          </h2>
          <p className="mt-3.5 text-lg text-muted">
            Identity tells you who an agent is. Zentra proves what it did. Stellar
            settles only after proof.
          </p>
          <Link
            href="/docs/quickstart"
            className="mt-8 inline-flex items-center gap-2.5 bg-violet px-8 py-4 text-[15px] font-semibold text-white transition-shadow hover:shadow-[0_0_36px_rgba(124,58,237,0.55)]"
          >
            Start Quickstart <span className="font-mono">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
