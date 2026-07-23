import { HudPanel } from '@/components/landing/primitives';

/** One skeleton panel — a stand-in for a `HudPanel` block of real content. */
function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <HudPanel>
      <div className="p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="h-2.5 w-28 animate-pulse bg-violet/25" />
          <span className="h-px flex-1 bg-violet/25" />
        </div>
        <div className="h-5 w-1/2 animate-pulse bg-panel-2" />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="h-3 animate-pulse bg-panel-2"
              style={{ width: `${92 - i * 14}%` }}
            />
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

/**
 * Route-level suspense fallback for every page under `(home)`. Next renders it
 * while a segment's server work is still streaming, then swaps in the page.
 * It mirrors the real page shape — header bar plus panel blocks — so the
 * layout does not jump when the content arrives.
 */
export default function Loading() {
  return (
    <main
      role="status"
      aria-label="Loading"
      className="zen-grid px-5 py-14 sm:px-7 sm:py-20"
    >
      <span className="sr-only">Loading</span>

      <div aria-hidden="true" className="mx-auto max-w-[1100px]">
        <div className="border-b border-violet/20 pb-8">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-2.5 w-40 animate-pulse bg-violet/25" />
            <span className="h-px flex-1 bg-violet/25" />
          </div>
          <div className="h-9 w-2/3 animate-pulse bg-panel-2 sm:h-11" />
          <div className="mt-4 h-3.5 w-full max-w-[560px] animate-pulse bg-panel-2" />
          <div className="mt-2.5 h-3.5 w-full max-w-[420px] animate-pulse bg-panel-2" />
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={4} />
        </div>

        <div className="mt-5">
          <PanelSkeleton lines={2} />
        </div>

        <div className="mt-10 h-3 w-full max-w-[680px] animate-pulse bg-panel-2" />
      </div>
    </main>
  );
}
