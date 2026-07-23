'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { ZentraMark } from '@/components/brand/zentra-mark';
import { PITCH_SLIDES, type PitchSlide } from '@/lib/pitch';

/** Slide positions read as `01 / 11` — fixed width keeps the corner stamp steady. */
const pad = (n: number) => String(n).padStart(2, '0');

const TOTAL = PITCH_SLIDES.length;

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/**
 * Typing in a field must never move the deck, so the key handler stands down
 * for text entry surfaces (including rich-text hosts).
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Space activates whatever control has focus; only steal it on inert ground. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, [role="button"], a[href], summary'));
}

/** One deck panel: eyebrow, title, lead, bullet grid, stat, fine print. */
function Slide({
  slide,
  index,
  registerRef,
}: {
  slide: PitchSlide;
  index: number;
  registerRef: (index: number, node: HTMLElement | null) => void;
}) {
  const headingId = `${slide.id}-title`;
  // The opening panel carries the document's single h1; the rest are sections.
  const isOpening = index === 0;

  return (
    <section
      id={slide.id}
      ref={(node) => registerRef(index, node)}
      aria-labelledby={headingId}
      className={cn(
        'relative flex scroll-mt-16 flex-col justify-center border-b border-violet/15 px-5 py-16 sm:px-7 sm:py-20 md:min-h-[80vh]',
        'last:border-b-0 print:min-h-0 print:break-after-page print:border-b-0 print:py-8',
        'last:print:break-after-auto',
      )}
    >
      {isOpening && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 print:hidden"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 68% 34%, rgba(124,58,237,0.16), transparent 70%)',
          }}
        />
      )}

      <span className="pointer-events-none absolute right-5 top-8 font-mono text-[11px] tracking-[0.14em] text-faint sm:right-7 sm:top-10">
        {pad(index + 1)} <span className="text-violet/60">/</span> {pad(TOTAL)}
      </span>

      <div className="relative mx-auto w-full max-w-[1100px]">
        {isOpening && (
          <div className="mb-7 flex items-center gap-2.5">
            <ZentraMark size={26} title="Zentra Protocol" />
            <span className="font-display text-sm font-bold tracking-[0.06em]">
              ZENTRA PROTOCOL
            </span>
          </div>
        )}

        <Eyebrow accent={isOpening ? 'cyan' : 'violet'}>{slide.eyebrow}</Eyebrow>

        {isOpening ? (
          <h1
            id={headingId}
            className="max-w-[16ch] text-balance font-display text-[30px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-[46px] md:text-[58px]"
          >
            {slide.title}
          </h1>
        ) : (
          <h2
            id={headingId}
            className="max-w-[20ch] text-balance font-display text-[26px] font-bold leading-[1.1] tracking-[-0.028em] sm:text-[38px] md:text-[46px]"
          >
            {slide.title}
          </h2>
        )}

        {slide.lead && (
          <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-[#cbd5e1] sm:text-lg">
            {slide.lead}
          </p>
        )}

        {slide.bullets && slide.bullets.length > 0 && (
          <dl className="mt-9 grid gap-x-10 gap-y-6 sm:mt-11 sm:grid-cols-2">
            {slide.bullets.map((bullet) => (
              <div key={bullet.label} className="border-l border-violet/30 pl-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-cyan">
                  {bullet.label}
                </dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-muted">{bullet.body}</dd>
              </div>
            ))}
          </dl>
        )}

        {slide.stat && (
          <HudPanel
            accent="cyan"
            className="mt-9 w-fit max-w-full px-6 py-6 sm:mt-11 sm:px-9 sm:py-8"
          >
            <div className="font-display text-[38px] font-bold leading-none tracking-[-0.03em] text-cyan sm:text-[60px]">
              {slide.stat.value}
            </div>
            <div className="mt-3 max-w-[420px] font-mono text-[11px] leading-relaxed tracking-[0.08em] text-muted">
              {slide.stat.caption}
            </div>
          </HudPanel>
        )}

        {slide.note && (
          <p className="mt-9 max-w-[720px] font-mono text-[11px] leading-relaxed text-faint">
            {slide.note}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The on-site pitch deck: one full-bleed panel per slide, readable as a normal
 * scrolling page but drivable as a presentation via the keyboard and side rail.
 * Print rules collapse the panels so a judge can export a clean PDF.
 */
export function PitchDeck() {
  const [active, setActive] = useState(0);
  // The key handler is attached once; a ref keeps it reading the live position
  // without tearing down and re-adding the listener on every slide change.
  const activeRef = useRef(0);
  const slideRefs = useRef<Array<HTMLElement | null>>([]);

  const registerRef = useCallback((index: number, node: HTMLElement | null) => {
    slideRefs.current[index] = node;
  }, []);

  const goTo = useCallback((index: number) => {
    const target = Math.min(Math.max(index, 0), TOTAL - 1);
    const node = slideRefs.current[target];
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    activeRef.current = target;
    setActive(target);
  }, []);

  useEffect(() => {
    const nodes = slideRefs.current.filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    // A deck is read one panel at a time, so the slide filling the most of the
    // viewport is the one being presented — track ratios across callbacks
    // because each callback only reports the entries that changed.
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
        let best = 0;
        let bestRatio = -1;
        nodes.forEach((node, index) => {
          const ratio = ratios.get(node) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = index;
          }
        });
        activeRef.current = best;
        setActive(best);
      },
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Leave browser and OS shortcuts, and anything already handled, alone.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;

      const last = TOTAL - 1;
      let next: number;

      switch (event.key) {
        case ' ':
          // Shift+Space is the browser's "page up"; Space on a control activates it.
          if (event.shiftKey || isActivatable(event.target)) return;
          next = Math.min(activeRef.current + 1, last);
          break;
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
          next = Math.min(activeRef.current + 1, last);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          next = Math.max(activeRef.current - 1, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }

      event.preventDefault();
      goTo(next);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo]);

  return (
    <>
      <nav
        aria-label="Slides"
        className="fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-0.5 print:hidden lg:flex xl:left-7"
      >
        {PITCH_SLIDES.map((slide, index) => {
          const isActive = index === active;
          return (
            <button
              key={slide.id}
              type="button"
              onClick={() => goTo(index)}
              aria-current={isActive ? 'true' : undefined}
              className={cn('group relative flex items-center gap-2 py-1 pr-1', FOCUS_RING)}
            >
              <span
                aria-hidden
                className={cn(
                  'block h-px transition-all duration-200',
                  isActive ? 'w-7 bg-cyan' : 'w-3.5 bg-faint group-hover:w-5 group-hover:bg-violet-soft',
                )}
              />
              <span
                className={cn(
                  'font-mono text-[10px] tabular-nums tracking-[0.08em] transition-colors',
                  isActive ? 'text-cyan' : 'text-faint group-hover:text-muted',
                )}
              >
                {pad(index + 1)}
              </span>
              {/* Titles float over the canvas so the rail never reflows the page. */}
              <span className="pointer-events-none absolute left-full ml-2 hidden max-w-[220px] truncate border border-violet/30 bg-panel px-2 py-1 font-mono text-[10px] tracking-[0.04em] text-muted group-hover:block group-focus-visible:block">
                {slide.title}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="fixed bottom-4 right-4 z-30 flex items-stretch border border-violet/35 bg-panel/95 backdrop-blur print:hidden sm:bottom-6 sm:right-6">
        <button
          type="button"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="Previous slide"
          className={cn(
            'px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-cyan disabled:cursor-not-allowed disabled:text-faint/50 disabled:hover:text-faint/50',
            FOCUS_RING,
          )}
        >
          ←
        </button>
        <span className="flex items-center border-x border-violet/25 px-3 font-mono text-[11px] tabular-nums tracking-[0.1em] text-muted">
          {pad(active + 1)} / {pad(TOTAL)}
        </span>
        <button
          type="button"
          onClick={() => goTo(active + 1)}
          disabled={active === TOTAL - 1}
          aria-label="Next slide"
          className={cn(
            'px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-cyan disabled:cursor-not-allowed disabled:text-faint/50 disabled:hover:text-faint/50',
            FOCUS_RING,
          )}
        >
          →
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className={cn(
            'border-l border-violet/25 px-3 py-2 font-mono text-[11px] tracking-[0.08em] text-muted transition-colors hover:text-cyan',
            FOCUS_RING,
          )}
        >
          PRINT / PDF
        </button>
      </div>

      <div>
        {PITCH_SLIDES.map((slide, index) => (
          <Slide key={slide.id} slide={slide} index={index} registerRef={registerRef} />
        ))}
      </div>

      <p className="px-5 pb-14 text-center font-mono text-[11px] tracking-[0.08em] text-faint print:hidden sm:px-7">
        Arrow keys, Space, Page Up/Down, Home/End navigate the deck.
      </p>
    </>
  );
}
