import { HudFrame } from '@/components/landing/hud-frame';
import { SystemBar } from '@/components/landing/system-bar';
import { Hero } from '@/components/landing/hero';
import { TheGap } from '@/components/landing/the-gap';
import { ScenarioPanels } from '@/components/landing/scenario-panels';
import { VerifierMonolith } from '@/components/landing/verifier-monolith';
import { ForDevelopers } from '@/components/landing/for-developers';
import { Closing } from '@/components/landing/closing';
import { Footer } from '@/components/landing/footer';

export default function HomePage() {
  return (
    <>
      <HudFrame />
      <SystemBar />
      <Hero />
      <TheGap />
      <ScenarioPanels />
      <VerifierMonolith />
      <ForDevelopers />
      <Closing />
      <Footer />
    </>
  );
}
