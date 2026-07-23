/**
 * Automated screening for comments shown on the public feedback wall.
 *
 * The policy is hide, not reject. `moderateComment` never fails a submission:
 * the caller stores the row exactly as it always did and uses the verdict only
 * to decide whether the comment is rendered publicly. Rejecting at the form
 * would tell an abuser precisely which word to change and hand them a fast
 * retry loop, while a silent withhold leaves them believing the post landed.
 * Keeping the row also preserves the record for human review, and makes a false
 * positive cost a moderator one flag flip rather than a lost comment.
 *
 * Nothing here imports a framework and nothing here has dependencies, so the
 * same function runs in a route handler, in a backfill script, and under plain
 * node in a unit test.
 */

/** Why a comment was withheld, or `clean` when it passed every check. */
export type ModerationReason =
  | 'clean'
  | 'abusive_language'
  | 'excessive_links'
  | 'repetition'
  | 'shouting';

/** The outcome of screening one comment. */
export interface ModerationVerdict {
  /** False when the comment should be withheld from public display. */
  publish: boolean;
  reason: ModerationReason;
}

/**
 * Terms that withhold a comment, matched whole-word against the normalised text.
 *
 * Scoped to the two languages this product's users actually write in — English
 * and Tagalog/Filipino — and intentionally conservative: general profanity,
 * direct personal attacks, and self-harm-directed phrases. It is deliberately
 * not an exhaustive slur list; length buys very little and costs false
 * positives. This array is the single place to extend when a real submission
 * gets through. Entries must be lowercase, alphabetised, and written with plain
 * single spaces between words — normalisation reduces every comment to that
 * alphabet before matching, so anything else could never match.
 */
export const ABUSIVE_TERMS = [
  'ass',
  'asshole',
  'bitch',
  'bobo',
  'cunt',
  'dickhead',
  'fuck',
  'fucker',
  'fucking',
  'gago',
  'hayop ka',
  'kill yourself',
  'kys',
  'magpakamatay',
  'motherfucker',
  'pakyu',
  'punyeta',
  'putang ina',
  'putangina',
  'shithead',
  'slut',
  'tang ina',
  'tanga',
  'tangina',
  'ulol',
  'whore',
] as const;

/** Characters abusers swap in for letters, mapped back before matching. */
const LEET_SUBSTITUTIONS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  '$': 's',
};

/** Combining marks left behind by an NFD decomposition. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Any character that survived normalisation as a leetspeak stand-in. */
const LEET_CHARACTERS = /[01345@$]/g;

/** A character repeated three or more times, captured for collapsing. */
const LONG_RUN = /(.)\1{2,}/g;

/** Everything outside the normalised alphabet, collapsed to a single space. */
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

/** A whole URL, counted once whether or not it carries a `www.` host. */
const URL_PATTERN = /(?:https?:\/\/|www\.)\S*/gi;

/** More URLs than this in one comment reads as link spam. */
const MAX_LINKS = 2;

/** More repeats of one whitespace-separated token than this reads as spam. */
const MAX_TOKEN_REPEATS = 6;

/** A longer run of one character than this reads as keyboard mashing. */
const MAX_CHARACTER_RUN = 15;

/** Comments at or below this length are too short to judge as shouting. */
const MIN_SHOUTING_LENGTH = 20;

/** The share of letters that must be uppercase before a comment is shouting. */
const MAX_UPPERCASE_RATIO = 0.7;

/** A run of one non-whitespace character longer than `MAX_CHARACTER_RUN`. */
const EXCESSIVE_CHARACTER_RUN = new RegExp(`([^\\s])\\1{${MAX_CHARACTER_RUN},}`);

/** One whole-word regex per term, compiled once at module load. */
const TERM_PATTERNS: readonly RegExp[] = ABUSIVE_TERMS.map(buildTermPattern);

/** A verdict that clears the comment for public display. */
const CLEAN: ModerationVerdict = { publish: true, reason: 'clean' };

/**
 * Screen a comment and say whether it may be displayed publicly.
 *
 * Checks run in severity order — abusive language, then links, then repetition,
 * then shouting — and the first match wins, so the reason a reviewer sees is
 * the worst thing the comment did rather than the last. Empty input is clean:
 * validation already rejects it upstream, and duplicating that here would only
 * give the two modules two different answers to drift apart on.
 */
export function moderateComment(comment: string): ModerationVerdict {
  if (comment.trim().length === 0) return CLEAN;

  if (containsAbusiveTerm(normaliseForMatching(comment))) {
    return { publish: false, reason: 'abusive_language' };
  }
  if (countLinks(comment) > MAX_LINKS) {
    return { publish: false, reason: 'excessive_links' };
  }
  // Repetition and shouting both read the original: normalisation caps runs at
  // two characters and discards case, which would erase the evidence entirely.
  if (isRepetitive(comment)) {
    return { publish: false, reason: 'repetition' };
  }
  if (isShouting(comment)) {
    return { publish: false, reason: 'shouting' };
  }

  return CLEAN;
}

/**
 * Reduce a comment to the lowercase `[a-z0-9 ]` form that terms match against.
 *
 * Each step closes off one cheap evasion: case folding, diacritic stripping
 * (`gágo`), leetspeak mapping (`g4g0`), and collapsing any run of three or more
 * identical characters down to exactly two (`fuuuuck` becomes `fuuck`) — two
 * rather than one so genuinely doubled letters survive. Punctuation and
 * whitespace both become single spaces, which is what makes whole-word matching
 * possible on the result.
 */
export function normaliseForMatching(comment: string): string {
  return comment
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(LEET_CHARACTERS, (char) => LEET_SUBSTITUTIONS[char] ?? char)
    .replace(LONG_RUN, '$1$1')
    .replace(NON_ALPHANUMERIC, ' ')
    .trim();
}

/** Whether the normalised text contains any listed term as a whole word. */
function containsAbusiveTerm(normalised: string): boolean {
  return TERM_PATTERNS.some((pattern) => pattern.test(normalised));
}

/**
 * Compile one term into a whole-word pattern tolerant of doubled letters.
 *
 * The `\b` anchors are what keep `assess`, `class` and `Scunthorpe` clean — a
 * bare substring search flags all three. Every character accepts one or two
 * occurrences because normalisation leaves collapsed runs at two, so `fuuck`
 * still matches the single-`u` term it was built from.
 */
function buildTermPattern(term: string): RegExp {
  const body = Array.from(term)
    .map((char) => (char === ' ' ? ' ' : `${escapeRegExp(char)}{1,2}`))
    .join('');
  return new RegExp(`\\b${body}\\b`);
}

/** Escape the regex metacharacters in a literal fragment. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How many URLs the original comment contains. */
function countLinks(comment: string): number {
  return comment.match(URL_PATTERN)?.length ?? 0;
}

/** Whether the comment mashes one character or repeats one token to excess. */
function isRepetitive(comment: string): boolean {
  if (EXCESSIVE_CHARACTER_RUN.test(comment)) return true;

  const seen = new Map<string, number>();
  for (const token of comment.toLowerCase().split(/\s+/)) {
    if (token.length === 0) continue;
    const count = (seen.get(token) ?? 0) + 1;
    if (count > MAX_TOKEN_REPEATS) return true;
    seen.set(token, count);
  }
  return false;
}

/**
 * Whether the comment is long enough to judge and mostly uppercase letters.
 *
 * The ratio is taken over letters alone so digits, punctuation and the spaces
 * in a wallet address cannot dilute a genuine all-caps rant.
 */
function isShouting(comment: string): boolean {
  if (comment.length <= MIN_SHOUTING_LENGTH) return false;

  const letters = comment.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return false;

  const uppercase = comment.match(/\p{Lu}/gu)?.length ?? 0;
  return uppercase / letters > MAX_UPPERCASE_RATIO;
}
