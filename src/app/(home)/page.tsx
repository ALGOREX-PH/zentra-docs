import { Hero } from '@/components/landing/hero';
import { TheGap } from '@/components/landing/the-gap';
import { ScenarioPanels } from '@/components/landing/scenario-panels';
import { HowItWorks } from '@/components/landing/how-it-works';
import { CodeSample } from '@/components/landing/code-sample';
import { WhyNow } from '@/components/landing/why-now';
import { Closing } from '@/components/landing/closing';
import { Footer } from '@/components/landing/footer';

export default function HomePage() {
  return (
    <>
      <Hero />
      <TheGap />
      <ScenarioPanels />
      <HowItWorks />
      <CodeSample />
      <WhyNow />
      <Closing />
      <Footer />
    </>
  );
}
