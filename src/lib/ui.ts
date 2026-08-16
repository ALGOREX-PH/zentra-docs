/**
 * Shared presentational atoms that were previously copy-pasted per component.
 *
 * These are deliberately tiny: a class string and a truncation helper. They
 * live in one module so a change to the focus treatment or the ellipsis style
 * lands everywhere at once instead of drifting file by file.
 */

/** The app-wide keyboard focus treatment. Apply to every interactive element. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/**
 * Truncate a long identifier (account, contract, hash) for display.
 *
 * Keeps `head` leading and `tail` trailing characters around a single
 * ellipsis. Values short enough to show whole are returned untouched, so
 * callers never widen a string by "shortening" it.
 */
export function shorten(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
