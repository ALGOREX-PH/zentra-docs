import type { Metadata } from 'next';
import { JoinForm } from '@/components/app/join-form';
import { JoinProgress } from '@/components/app/join-progress';
import { Eyebrow } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'Join the testnet programme',
  description:
    'Register for the Zentra testnet programme — free Stellar testnet access, no real funds involved.',
};

export default function JoinPage() {
  return (
    <main className="zen-grid px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[1100px]">
        <header className="border-b border-violet/20 pb-8">
          <Eyebrow>// ZENTRA · TESTNET PROGRAMME</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
            Join the testnet programme
          </h1>
          <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-muted sm:text-base">
            We are onboarding the first 50 people to build proof-gated agents on
            Zentra and tell us where it breaks. Everything runs on the Stellar
            testnet — it is free, the XLM comes from Friendbot, and no real funds
            are ever involved.
          </p>
        </header>

        <div className="mt-10 flex max-w-[620px] flex-col gap-5">
          <JoinProgress />
          <JoinForm />
        </div>
      </div>
    </main>
  );
}
