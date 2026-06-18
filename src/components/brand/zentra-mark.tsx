import type { CSSProperties } from 'react';

export type ZentraTone = 'primary' | 'violet' | 'mono' | 'onlight';

/**
 * Color treatments for the mark. `primary` is the official lockup — the gate
 * and rail in violet, the verified settle node in cyan. `mono` inherits
 * `currentColor` so the mark can sit inside text.
 */
const TONES: Record<ZentraTone, { ink: string; node: string; settle: string }> = {
  primary: { ink: '#7c3aed', node: '#7c3aed', settle: '#00e5ff' },
  violet: { ink: '#7c3aed', node: '#7c3aed', settle: '#7c3aed' },
  mono: { ink: 'currentColor', node: 'currentColor', settle: 'currentColor' },
  onlight: { ink: '#3b1e78', node: '#3b1e78', settle: '#0891a8' },
};

export interface ZentraMarkProps {
  size?: number;
  tone?: ZentraTone;
  /** Drop the proof-gate brackets — the favicon reduction. */
  bracketless?: boolean;
  /** When set, the mark is announced to assistive tech; otherwise decorative. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Zentra Protocol — the Proof Gate · Z-Path mark.
 *
 * HUD brackets clamp a proof rail shaped like a Z: intent and proof in violet,
 * the verified settle node in cyan. Nothing passes the gate without a proof.
 */
export function ZentraMark({
  size = 32,
  tone = 'primary',
  bracketless = false,
  title,
  className,
  style,
}: ZentraMarkProps) {
  const c = TONES[tone];
  const a11y = title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true } as const);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {bracketless ? (
        <>
          {/* rail-Z, scaled to fill the frame once the gate is dropped */}
          <line x1="16" y1="16" x2="48" y2="16" stroke={c.ink} strokeWidth="4" strokeLinecap="square" />
          <line x1="48" y1="16" x2="16" y2="48" stroke={c.ink} strokeWidth="4" strokeLinecap="square" />
          <line x1="16" y1="48" x2="48" y2="48" stroke={c.ink} strokeWidth="4" strokeLinecap="square" />
          <rect x="42" y="42" width="10" height="10" fill={c.settle} />
        </>
      ) : (
        <>
          {/* the proof gate — brackets clamp the rail */}
          <polyline points="20,9 10,9 10,55 20,55" stroke={c.ink} strokeWidth="2.6" strokeLinejoin="miter" strokeLinecap="square" />
          <polyline points="44,9 54,9 54,55 44,55" stroke={c.ink} strokeWidth="2.6" strokeLinejoin="miter" strokeLinecap="square" />
          {/* the Z rail — intent → proof → settle */}
          <line x1="24" y1="21" x2="40" y2="21" stroke={c.ink} strokeWidth="2.8" strokeLinecap="square" />
          <line x1="40" y1="21" x2="24" y2="43" stroke={c.ink} strokeWidth="2.8" strokeLinecap="square" />
          <line x1="24" y1="43" x2="40" y2="43" stroke={c.ink} strokeWidth="2.8" strokeLinecap="square" />
          {/* path nodes */}
          <rect x="21.5" y="18.5" width="5" height="5" fill={c.node} />
          <rect x="37.5" y="18.5" width="5" height="5" fill={c.node} />
          <rect x="21.5" y="40.5" width="5" height="5" fill={c.node} />
          {/* the verified settle node */}
          <rect x="36.5" y="39.5" width="8" height="8" fill={c.settle} />
        </>
      )}
    </svg>
  );
}
