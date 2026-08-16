import { Closing } from '@/components/landing/closing';
import { ForDevelopers } from '@/components/landing/for-developers';
import { Hero } from '@/components/landing/hero';
import { HudFrame } from '@/components/landing/hud-frame';
import { ScenarioPanels } from '@/components/landing/scenario-panels';
import { SystemBar } from '@/components/landing/system-bar';
import { TheGap } from '@/components/landing/the-gap';
import { VerifierMonolith } from '@/components/landing/verifier-monolith';

export default function HomePage() {
  return (
    <>
      {/* Viewport-level decoration, so it sits outside the content landmark. */}
      <HudFrame />
      <main id="content" tabIndex={-1} className="flex-1 focus:outline-none">
        <SystemBar />
        <Hero />
        <TheGap />
        <ScenarioPanels />
        <VerifierMonolith />
        <ForDevelopers />
        <Closing />
      </main>
    </>
  );
}
