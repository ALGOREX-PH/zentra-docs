'use client';

import { cn } from '@/lib/cn';
import { focusRing } from '@/lib/ui';

/**
 * The five-star rating group shared by the feedback and signup forms.
 *
 * A group rather than a radiogroup: these stay ordinary buttons, so every star
 * keeps its own tab stop and Enter/Space, and the filled state is carried by
 * aria-pressed instead of a glyph nobody hears.
 *
 * The label lives with the form, not here — each form words and styles its own
 * ("Rating" vs "Rating (optional)") — so the group points back at it through
 * `labelledBy` rather than rendering a second one.
 */
export function StarRating({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  /** The current rating, 0 when none is chosen. */
  value: number;
  onChange: (value: number) => void;
  /** id of the visible label element naming this group. */
  labelledBy: string;
  disabled?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would impose legend/border semantics; this stays a plain group labelled by the form's own heading, per the component comment above.
    <div role="group" aria-labelledby={labelledBy} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={`Rate ${star} of 5`}
            aria-pressed={filled}
            disabled={disabled}
            onClick={() => onChange(star)}
            className={cn(
              'text-2xl leading-none transition-colors',
              filled ? 'text-cyan' : 'text-faint',
              focusRing,
            )}
          >
            {filled ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
