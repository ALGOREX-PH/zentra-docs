import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { VizFlow } from '@/components/playground/viz-flow';
import { VizMerkle } from '@/components/playground/viz-merkle';
import { VizPrivatePublic } from '@/components/playground/viz-private-public';
import { VizCommitment } from '@/components/playground/viz-commitment';

/** A visual-learner walkthrough of how a Zentra zero-knowledge proof works. */
export function ProofVisuals() {
  return (
    <div className="space-y-5">
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-7">
          <Eyebrow accent="cyan">SEE IT · THE BIG PICTURE</Eyebrow>
          <h3 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            How a proof is made
          </h3>
          {/* Each diagram is a figure, so its explanation is also its
              accessible name rather than a paragraph that happens to sit above. */}
          <figure>
            <figcaption className="mt-2 max-w-[680px] text-sm text-muted">
              Private and public inputs run through the circuit; out comes a tiny
              proof anyone can verify in milliseconds.
            </figcaption>
            <div className="mt-5">
              <VizFlow />
            </div>
          </figure>
        </div>
      </HudPanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <HudPanel>
          <div className="p-5 sm:p-6">
            <Eyebrow>HIDDEN VS REVEALED</Eyebrow>
            <figure>
              <figcaption className="mt-2 text-sm text-muted">
                What stays secret, and what the proof exposes.
              </figcaption>
              <div className="mt-4">
                <VizPrivatePublic />
              </div>
            </figure>
          </div>
        </HudPanel>
        <HudPanel>
          <div className="p-5 sm:p-6">
            <Eyebrow>THE COMMITMENT</Eyebrow>
            <figure>
              <figcaption className="mt-2 text-sm text-muted">
                A one-way hash locks in the secret policy.
              </figcaption>
              <div className="mt-4">
                <VizCommitment />
              </div>
            </figure>
          </div>
        </HudPanel>
      </div>

      <HudPanel>
        <div className="p-5 sm:p-6">
          <Eyebrow>MEMBERSHIP · THE MERKLE TREE</Eyebrow>
          <figure>
            <figcaption className="mt-2 max-w-[680px] text-sm text-muted">
              How &quot;the recipient is approved&quot; is proven against a single
              root, without revealing the list.
            </figcaption>
            <div className="mt-5">
              <VizMerkle />
            </div>
          </figure>
        </div>
      </HudPanel>
    </div>
  );
}
