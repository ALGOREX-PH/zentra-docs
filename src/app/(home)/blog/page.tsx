import type { Metadata } from 'next';
import { Eyebrow } from '@/components/landing/primitives';
import { Footer } from '@/components/landing/footer';
import { gitConfig, repoUrl } from '@/lib/shared';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Releases, deep-dives, and testnet results from Zentra Protocol.',
};

/** Where a linked article lives, built off the git config the footer also uses. */
const articleUrl = (file: string) =>
  `${repoUrl}/blob/${gitConfig.branch}/docs/articles/${file}`;

const POSTS: {
  cat: string;
  date: string;
  title: string;
  body: string;
  href?: string;
}[] = [
  {
    cat: 'Tutorial',
    date: '2026-07-23',
    title: 'Build and ship an on-chain action log on Soroban',
    body: 'A full walkthrough for developers new to Soroban: storage keys and why instance differs from persistent, typed events, capping reads, extending TTLs so instance storage is not archived, cross-contract calls, testing with mocked auth, deploying, and a React frontend that reads by simulation and writes through a wallet.',
    href: articleUrl('soroban-action-log-tutorial.md'),
  },
  {
    cat: 'Deep-dive',
    date: '2026-06-12',
    title: 'Verifying a Groth16 proof inside Soroban for ~26M CPU',
    body: "On-chain ZK verification used to be a paper idea on Stellar. With Protocol 25/26 BN254 host functions and CAP-0075 Poseidon, a full Groth16 check — multi-pairing plus a public-input MSM — now fits in about a quarter of the per-transaction CPU budget. Here's how the verifier is structured and where the cost goes.",
  },
  {
    cat: 'Deep-dive',
    date: '2026-06-05',
    title: 'Why state-bound proofs beat naive policy checks',
    body: 'A proof that a payment is "under the limit" is worthless if the agent can lie about prior spend. Binding every proof to the on-chain Authority State turns the daily-limit check into something an agent cannot forge — the difference between an over-spend being blocked and a treasury being drained.',
  },
  {
    cat: 'Release',
    date: '2026-05-28',
    title: 'On-chain Poseidon receipts (CAP-0075)',
    body: 'Every settled action now carries an action_id computed on-chain with the host Poseidon, over the verified amount, recipient, nullifier, and new spend. The receipt id is a fact the chain attests to, not a claim the agent makes.',
  },
];

export default function BlogPage() {
  return (
    <>
      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-20">
          <Eyebrow>ZENTRA // BLOG &amp; CHANGELOG</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Releases, deep-dives, and testnet results.
          </h1>

          <div className="mt-12 space-y-px border border-fd-border bg-fd-border">
            {POSTS.map((p) => (
              <article key={p.title} className="bg-panel p-6">
                <div className="flex items-center gap-3 font-mono text-xs text-fd-muted-foreground">
                  <span className="text-violet-soft">{p.cat}</span>
                  <span>·</span>
                  <time>{p.date}</time>
                </div>
                <h2 className="mt-3 font-display text-xl font-semibold">{p.title}</h2>
                <p className="mt-2 leading-relaxed text-fd-muted-foreground">{p.body}</p>
                {p.href ? (
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block font-mono text-xs text-cyan transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                  >
                    Read it →
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
