/**
 * Pure grading logic for the signup form's inputs, wallet field foremost.
 *
 * Extracted from the /join form component so the rules a visitor's paste is
 * judged by can be unit-tested without mounting a form. Nothing here touches
 * React or the DOM: strings in, verdicts out.
 */

/** Longest name the registry accepts. */
export const MAX_NAME = 80;

/** Longest optional note the registry accepts. */
export const MAX_NOTE = 500;

/** Every Stellar account id is exactly this long — `G` plus 55 base32 digits. */
export const WALLET_LENGTH = 56;

/** Same shapes the API validates against, so the form fails before the fetch. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

/** The base32 alphabet a strkey is written in — note the absent 0, 1, 8 and 9. */
const BASE32 = /^[A-Z2-7]*$/;

export type Field = 'name' | 'email' | 'wallet' | 'note';

export type FieldErrors = Partial<Record<Field, string>>;

export interface Values {
  name: string;
  email: string;
  wallet: string;
  note: string;
}

/**
 * What can honestly be said about a wallet value mid-entry.
 *
 * `typing` is the state that earns this type its keep: an address on its way to
 * 56 characters is not wrong yet, and a field that shouts "invalid" on the third
 * keystroke is how a form teaches people to stop reading it.
 */
export type WalletState =
  | { kind: 'empty' }
  | { kind: 'typing'; length: number }
  | { kind: 'invalid'; reason: string }
  | { kind: 'valid' };

/**
 * Grade a wallet value the way the person entering it needs it graded.
 *
 * The wrong-prefix cases get their own wording because they are the two ways
 * this field actually gets filled in wrong, and both are one move from fixed
 * once named: `S` is somebody about to paste a secret key into a registry, and
 * `C` is a contract id copied off the explorer. Everything else is either
 * unfinished or a character that cannot appear in a strkey at all.
 */
export function inspectWallet(value: string): WalletState {
  if (value.length === 0) return { kind: 'empty' };

  if (value.startsWith('S')) {
    return {
      kind: 'invalid',
      reason:
        'That looks like a secret key — do not paste it anywhere. Your account id is the public one, starting with G.',
    };
  }

  if (!value.startsWith('G')) {
    return {
      kind: 'invalid',
      reason: value.startsWith('C')
        ? 'That is a contract id. Paste your own account id — it starts with G.'
        : 'A Stellar account id starts with G.',
    };
  }

  if (!BASE32.test(value.slice(1))) {
    return {
      kind: 'invalid',
      reason: 'An account id only holds letters A–Z and digits 2–7 — something else got copied in.',
    };
  }

  if (value.length > WALLET_LENGTH) {
    return {
      kind: 'invalid',
      reason: `That is ${value.length} characters. An account id is exactly ${WALLET_LENGTH}.`,
    };
  }

  if (value.length < WALLET_LENGTH) return { kind: 'typing', length: value.length };

  // Prefix, alphabet and length all hold, so this should be unreachable — but
  // the server judges the value against this exact pattern, so the form does too
  // rather than inferring validity from three checks that happen to agree.
  return STELLAR_ACCOUNT_ID.test(value)
    ? { kind: 'valid' }
    : {
        kind: 'invalid',
        reason: `Enter a Stellar account id — G followed by ${WALLET_LENGTH - 1} characters.`,
      };
}

/** The reason a wallet state cannot be submitted, or null when it can. */
export function walletMessage(state: WalletState): string | null {
  switch (state.kind) {
    case 'valid':
      return null;
    case 'empty':
      return 'Enter your Stellar testnet account id.';
    case 'typing':
      return `${state.length} of ${WALLET_LENGTH} characters — paste the whole address.`;
    case 'invalid':
      return state.reason;
  }
}

/**
 * Whitespace and case removed so a paste survives wherever it came from.
 *
 * A 56-character address gets copied out of wallet UIs, chat messages and
 * wrapped emails, and arrives with newlines or spaces in the middle of it more
 * often than not. A strkey has no lowercase letters and no interior whitespace,
 * so neither can be anything but transport damage — dropping them recovers the
 * paste instead of rejecting it and making someone find the stray character.
 */
export function normaliseWallet(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Mirror of the server's rules, worded for a person rather than a validator.
 *
 * Duplicating them is deliberate: the API is still the authority, but a signup
 * that can be fixed without a round trip — and without burning one of three
 * rate-limited attempts — is the difference between a registration and a bounce.
 */
export function validate({ name, email, wallet, note }: Values): FieldErrors {
  const errors: FieldErrors = {};

  const trimmedName = name.trim();
  if (trimmedName.length < 1) errors.name = 'Enter your name.';
  else if (trimmedName.length > MAX_NAME)
    errors.name = `Name must be ${MAX_NAME} characters or fewer.`;

  if (!EMAIL.test(email.trim())) errors.email = 'Enter a valid email address.';

  const walletProblem = walletMessage(inspectWallet(wallet.trim()));
  if (walletProblem !== null) errors.wallet = walletProblem;

  if (note.trim().length > MAX_NOTE) errors.note = `Note must be ${MAX_NOTE} characters or fewer.`;

  return errors;
}
