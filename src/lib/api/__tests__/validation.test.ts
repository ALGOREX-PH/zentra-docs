import { describe, expect, it } from 'vitest';
import type { ApiError } from '@/lib/api/errors';
import {
  isEmail,
  isStellarAccountId,
  isTxHash,
  JSON_MEDIA_TYPE,
  MAX_BODY_BYTES,
  MAX_COMMENT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RESULT_LIMIT,
  MAX_TAGS,
  parseFeedbackInput,
  parseSearchQuery,
  parseUserInput,
  readJsonBody,
} from '@/lib/api/validation';

const VALID_WALLET = `G${'A'.repeat(55)}`;
const VALID_TX_HASH = 'ab12'.repeat(16);
const FEEDBACK_KEYS = ['comment', 'onChain', 'rating', 'txHash', 'wallet'];
const USER_KEYS = ['email', 'name', 'note', 'rating', 'wallet'];

/** Longest address the SMTP standard permits; `isEmail` refuses one past it. */
const MAX_EMAIL_LENGTH = 254;

/** An address of exactly `length` characters, ending in a real dotted domain. */
function emailOfLength(length: number): string {
  const domain = '@example.com';
  return `${'a'.repeat(length - domain.length)}${domain}`;
}

/**
 * Build a POST carrying `body` labelled as JSON, which is what every legitimate
 * caller sends. `headers` overrides that label so a test can send a bad one.
 */
function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://x.test', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': JSON_MEDIA_TYPE, ...headers },
  });
}

/** Await a promise expected to reject and hand back the `ApiError` it threw. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

describe('isStellarAccountId', () => {
  it('accepts a 56-character G key', () => {
    expect(VALID_WALLET).toHaveLength(56);
    expect(isStellarAccountId(VALID_WALLET)).toBe(true);
  });

  it('rejects a lowercase key', () => {
    expect(isStellarAccountId(VALID_WALLET.toLowerCase())).toBe(false);
  });

  it('rejects a 55-character key', () => {
    expect(isStellarAccountId(`G${'A'.repeat(54)}`)).toBe(false);
  });

  it('rejects a 57-character key', () => {
    expect(isStellarAccountId(`G${'A'.repeat(56)}`)).toBe(false);
  });

  it('rejects a muxed M address', () => {
    expect(isStellarAccountId(`M${'A'.repeat(68)}`)).toBe(false);
    expect(isStellarAccountId(`M${'A'.repeat(55)}`)).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isStellarAccountId(12345)).toBe(false);
  });

  it('rejects null', () => {
    expect(isStellarAccountId(null)).toBe(false);
  });
});

describe('isTxHash', () => {
  it('accepts 64 lowercase hex characters', () => {
    expect(VALID_TX_HASH).toHaveLength(64);
    expect(isTxHash(VALID_TX_HASH)).toBe(true);
  });

  it('accepts 64 uppercase hex characters', () => {
    expect(isTxHash(VALID_TX_HASH.toUpperCase())).toBe(true);
  });

  it('rejects 63 characters', () => {
    expect(isTxHash(VALID_TX_HASH.slice(0, 63))).toBe(false);
  });

  it('rejects 65 characters', () => {
    expect(isTxHash(`${VALID_TX_HASH}a`)).toBe(false);
  });

  it('rejects 64 characters containing a non-hex character', () => {
    const withZ = `z${VALID_TX_HASH.slice(1)}`;
    expect(withZ).toHaveLength(64);
    expect(isTxHash(withZ)).toBe(false);
  });
});

describe('parseFeedbackInput', () => {
  it('returns exactly the five persisted fields', () => {
    const result = parseFeedbackInput({
      rating: 5,
      comment: 'Proof verified in under a second.',
      wallet: VALID_WALLET,
      txHash: VALID_TX_HASH,
      onChain: true,
    });

    expect(Object.keys(result).sort()).toEqual(FEEDBACK_KEYS);
    expect(result.rating).toBe(5);
    expect(result.comment).toBe('Proof verified in under a second.');
    expect(result.wallet).toBe(VALID_WALLET);
    expect(result.txHash).toBe(VALID_TX_HASH);
    expect(result.onChain).toBe(true);
  });

  it('drops caller-supplied extras instead of assigning them through', () => {
    const result = parseFeedbackInput({
      rating: 3,
      comment: 'Fine.',
      id: 999,
      created_at: '1970-01-01T00:00:00.000Z',
      isAdmin: true,
    });

    expect(Object.keys(result).sort()).toEqual(FEEDBACK_KEYS);
    expect('id' in result).toBe(false);
    expect('created_at' in result).toBe(false);
    expect('isAdmin' in result).toBe(false);
  });

  it('lowercases an uppercase transaction hash', () => {
    const result = parseFeedbackInput({
      rating: 4,
      comment: 'Works.',
      txHash: VALID_TX_HASH.toUpperCase(),
    });

    expect(result.txHash).toBe(VALID_TX_HASH);
    expect(result.txHash).not.toBe(VALID_TX_HASH.toUpperCase());
  });

  it('collapses newlines, tabs and repeated spaces into single spaces', () => {
    const result = parseFeedbackInput({
      rating: 4,
      comment: 'first\nsecond\tthird    fourth',
    });

    expect(result.comment).toBe('first second third fourth');
  });

  it('strips control characters from the comment', () => {
    const result = parseFeedbackInput({
      rating: 4,
      comment: `cle${String.fromCharCode(0)}an${String.fromCharCode(7)}ed${String.fromCharCode(127)}`,
    });

    expect(result.comment).toBe('cleaned');
  });

  it('trims the normalised comment', () => {
    const result = parseFeedbackInput({
      rating: 4,
      comment: '   \n  spaced out \t  ',
    });

    expect(result.comment).toBe('spaced out');
  });

  it('rejects a comment made only of whitespace', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({ rating: 4, comment: '   \n\t  ' });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(err.details?.comment).toBeDefined();
  });

  it('rejects a comment one character over the limit', () => {
    expect(MAX_COMMENT_LENGTH).toBe(280);

    let caught: unknown;
    try {
      parseFeedbackInput({ rating: 4, comment: 'a'.repeat(281) });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.details?.comment).toBeDefined();
  });

  it('accepts a comment exactly at the limit', () => {
    const result = parseFeedbackInput({ rating: 4, comment: 'a'.repeat(280) });
    expect(result.comment).toHaveLength(280);
  });

  it('rejects a rating of 0', () => {
    expect(() => parseFeedbackInput({ rating: 0, comment: 'ok' })).toThrow();
  });

  it('rejects a rating of 6', () => {
    expect(() => parseFeedbackInput({ rating: 6, comment: 'ok' })).toThrow();
  });

  it('rejects a fractional rating', () => {
    expect(() => parseFeedbackInput({ rating: 2.5, comment: 'ok' })).toThrow();
  });

  it('rejects a rating sent as a string', () => {
    expect(() => parseFeedbackInput({ rating: '3', comment: 'ok' })).toThrow();
  });

  it('rejects a missing rating', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({ comment: 'ok' });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.details?.rating).toBeDefined();
  });

  it('accumulates every field failure into a single 422', () => {
    const body = { rating: 0, comment: '   ' };

    expect(() => parseFeedbackInput(body)).toThrow();

    let caught: unknown;
    try {
      parseFeedbackInput(body);
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(Object.keys(err.details ?? {}).sort()).toEqual(['comment', 'rating']);
    expect(typeof err.details?.rating).toBe('string');
    expect(typeof err.details?.comment).toBe('string');
  });

  it('rejects a null body with a 400', () => {
    let caught: unknown;
    try {
      parseFeedbackInput(null);
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects a string body with a 400', () => {
    let caught: unknown;
    try {
      parseFeedbackInput('rating=5');
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects an array body with a 400', () => {
    let caught: unknown;
    try {
      parseFeedbackInput([]);
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects a number body with a 400', () => {
    let caught: unknown;
    try {
      parseFeedbackInput(42);
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('keeps onChain true when a valid hash and wallet back it', () => {
    const result = parseFeedbackInput({
      rating: 5,
      comment: 'Anchored.',
      onChain: true,
      wallet: VALID_WALLET,
      txHash: VALID_TX_HASH,
    });

    expect(result.onChain).toBe(true);
    expect(result.txHash).toBe(VALID_TX_HASH);
    expect(result.wallet).toBe(VALID_WALLET);
  });

  it('rejects an on-chain claim that names no wallet', () => {
    // Without a wallet the ownership check downstream has nothing to check
    // against, so any harvested public hash would earn the badge (BE-01).
    for (const wallet of [undefined, null, '', '   ']) {
      let caught: unknown;
      try {
        parseFeedbackInput({
          rating: 5,
          comment: 'Anchored.',
          onChain: true,
          wallet,
          txHash: VALID_TX_HASH,
        });
      } catch (error) {
        caught = error;
      }

      const err = caught as ApiError;
      expect(err.status).toBe(422);
      expect(err.code).toBe('validation_failed');
      expect(err.details?.wallet).toBe('Wallet is required when onChain is true.');
    }
  });

  it('reports the missing wallet alongside an invalid hash in one 422', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({
        rating: 5,
        comment: 'Anchored?',
        onChain: true,
        txHash: 'not-a-transaction-hash',
      });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(Object.keys(err.details ?? {}).sort()).toEqual(['txHash', 'wallet']);
  });

  it('keeps the malformed-wallet message when an on-chain claim names a bad wallet', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({
        rating: 5,
        comment: 'Anchored.',
        onChain: true,
        wallet: 'GABC',
        txHash: VALID_TX_HASH,
      });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.details?.wallet).toBe('Wallet must be a valid Stellar account id (G…).');
  });

  it('downgrades onChain to false when the hash is null', () => {
    const result = parseFeedbackInput({
      rating: 5,
      comment: 'Not anchored.',
      onChain: true,
      txHash: null,
    });

    expect(result.onChain).toBe(false);
    expect(result.txHash).toBeNull();
  });

  it('rejects an invalid hash rather than downgrading onChain', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({
        rating: 5,
        comment: 'Anchored?',
        onChain: true,
        txHash: 'not-a-transaction-hash',
      });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(err.details?.txHash).toBeDefined();
  });

  it('defaults onChain to false when it is absent', () => {
    const result = parseFeedbackInput({ rating: 2, comment: 'Meh.' });
    expect(result.onChain).toBe(false);
  });

  it('turns an absent wallet and hash into null', () => {
    const result = parseFeedbackInput({ rating: 3, comment: 'Anonymous.' });
    expect(result.wallet).toBeNull();
    expect(result.txHash).toBeNull();
  });

  it('turns an empty-string wallet and hash into null', () => {
    const result = parseFeedbackInput({
      rating: 3,
      comment: 'Anonymous.',
      wallet: '',
      txHash: '   ',
    });

    expect(result.wallet).toBeNull();
    expect(result.txHash).toBeNull();
  });

  it('rejects a wallet that is not a Stellar account id', () => {
    let caught: unknown;
    try {
      parseFeedbackInput({ rating: 3, comment: 'ok', wallet: 'GABC' });
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(422);
    expect(err.details?.wallet).toBeDefined();
  });
});

describe('isEmail', () => {
  it('accepts an ordinary dotted address', () => {
    expect(isEmail('ada@example.com')).toBe(true);
  });

  it('accepts the shortest plausible dotted address', () => {
    expect(isEmail('a@b.c')).toBe(true);
  });

  it('accepts an uppercase address as-is — normalisation is the parser`s job', () => {
    expect(isEmail('ADA@EXAMPLE.COM')).toBe(true);
  });

  it('accepts an address at exactly the 254-character SMTP ceiling', () => {
    const email = emailOfLength(MAX_EMAIL_LENGTH);

    expect(email).toHaveLength(254);
    expect(isEmail(email)).toBe(true);
  });

  it('rejects an address of 255 characters', () => {
    const email = emailOfLength(MAX_EMAIL_LENGTH + 1);

    expect(email).toHaveLength(255);
    expect(isEmail(email)).toBe(false);
  });

  it('rejects a domain with no dot — the load-bearing junk filter', () => {
    expect(isEmail('ada@localhost')).toBe(false);
    expect(isEmail('ada@examplecom')).toBe(false);
  });

  it('rejects an address with no @ or with more than one', () => {
    expect(isEmail('ada.example.com')).toBe(false);
    expect(isEmail('ada@@example.com')).toBe(false);
    expect(isEmail('ada@ex@ample.com')).toBe(false);
  });

  it('rejects whitespace anywhere in the address', () => {
    expect(isEmail('ada lovelace@example.com')).toBe(false);
    expect(isEmail('ada@exa mple.com')).toBe(false);
    expect(isEmail(' ada@example.com')).toBe(false);
  });

  it('rejects an empty local part, domain or TLD', () => {
    expect(isEmail('@example.com')).toBe(false);
    expect(isEmail('ada@.com')).toBe(false);
    expect(isEmail('ada@example.')).toBe(false);
  });

  it('rejects a non-string and null', () => {
    expect(isEmail(42)).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
    expect(isEmail(['ada@example.com'])).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isEmail('')).toBe(false);
  });
});

describe('parseUserInput', () => {
  /** A body every required field of which is valid; override to break one. */
  function signup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      wallet: VALID_WALLET,
      ...overrides,
    };
  }

  /** Run the parser on a body expected to be refused, returning the error. */
  function refusal(body: unknown): ApiError {
    try {
      parseUserInput(body);
    } catch (error) {
      return error as ApiError;
    }
    throw new Error('Expected parseUserInput to throw, but it returned.');
  }

  it('returns exactly the five persisted fields', () => {
    const result = parseUserInput(signup({ rating: 4, note: 'Excited to build.' }));

    expect(Object.keys(result).sort()).toEqual(USER_KEYS);
    expect(result.name).toBe('Ada Lovelace');
    expect(result.email).toBe('ada@example.com');
    expect(result.wallet).toBe(VALID_WALLET);
    expect(result.rating).toBe(4);
    expect(result.note).toBe('Excited to build.');
  });

  it('drops caller-supplied extras instead of assigning them through', () => {
    const result = parseUserInput(
      signup({ id: 999, source: 'import', created_at: '1970-01-01', isAdmin: true }),
    );

    expect(Object.keys(result).sort()).toEqual(USER_KEYS);
    expect('id' in result).toBe(false);
    expect('source' in result).toBe(false);
    expect('created_at' in result).toBe(false);
    expect('isAdmin' in result).toBe(false);
  });

  it('trims and lowercases the email — the lower(email) unique index depends on it', () => {
    // Stored as typed, `Ada@…` and `ada@…` would both insert and then collide
    // inside Postgres as a 500 rather than the 409 the route maps.
    const result = parseUserInput(signup({ email: '  Ada@Example.COM  ' }));

    expect(result.email).toBe('ada@example.com');
  });

  it('validates the email after trimming, so padded addresses still pass', () => {
    expect(parseUserInput(signup({ email: '   ada@example.com   ' })).email).toBe(
      'ada@example.com',
    );
  });

  it('rejects an email that only breaks the format after lowercasing checks', () => {
    for (const email of ['ada@localhost', 'not-an-email', 'ada @example.com', '', '   ']) {
      const err = refusal(signup({ email }));

      expect(err.status).toBe(422);
      expect(err.code).toBe('validation_failed');
      expect(err.details?.email).toBe('Email must be a valid address.');
    }
  });

  it('rejects a missing email', () => {
    const { email: _email, ...body } = signup();

    expect(refusal(body).details?.email).toBeDefined();
  });

  it('rejects an email of 255 characters after trimming', () => {
    const err = refusal(signup({ email: emailOfLength(MAX_EMAIL_LENGTH + 1) }));

    expect(err.status).toBe(422);
    expect(err.details?.email).toBeDefined();
  });

  it('rejects a non-string email rather than coercing it', () => {
    expect(refusal(signup({ email: 42 })).details?.email).toBeDefined();
    expect(refusal(signup({ email: ['ada@example.com'] })).details?.email).toBeDefined();
  });

  it('requires the wallet, unlike feedback', () => {
    for (const wallet of [undefined, null, '', '   ']) {
      const err = refusal(signup({ wallet }));

      expect(err.status).toBe(422);
      expect(err.details?.wallet).toBe('Wallet must be a valid Stellar account id (G…).');
    }
  });

  it('rejects a malformed wallet', () => {
    for (const wallet of ['GABC', VALID_WALLET.toLowerCase(), `${VALID_WALLET}A`]) {
      expect(refusal(signup({ wallet })).details?.wallet).toBeDefined();
    }
  });

  it('normalises the name like a comment: collapse, strip controls, trim', () => {
    const result = parseUserInput(
      signup({ name: `  Ada\n Love${String.fromCharCode(0)}lace\t King  ` }),
    );

    expect(result.name).toBe('Ada Lovelace King');
  });

  it('accepts a name exactly at the 80-character limit', () => {
    expect(MAX_NAME_LENGTH).toBe(80);
    expect(parseUserInput(signup({ name: 'a'.repeat(80) })).name).toHaveLength(80);
  });

  it('rejects a name one character over the limit', () => {
    const err = refusal(signup({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) }));

    expect(err.status).toBe(422);
    expect(err.details?.name).toBe('Name must be 1–80 characters.');
  });

  it('rejects a missing or whitespace-only name', () => {
    expect(refusal(signup({ name: undefined })).details?.name).toBeDefined();
    expect(refusal(signup({ name: '   \n\t ' })).details?.name).toBeDefined();
    expect(refusal(signup({ name: 42 })).details?.name).toBeDefined();
  });

  it('turns an absent rating and note into null', () => {
    const result = parseUserInput(signup());

    expect(result.rating).toBeNull();
    expect(result.note).toBeNull();
  });

  it('treats an empty-string or null rating and note as absent', () => {
    const result = parseUserInput(signup({ rating: null, note: '   ' }));

    expect(result.rating).toBeNull();
    expect(result.note).toBeNull();
  });

  it('accepts every rating in the 1–5 range', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(parseUserInput(signup({ rating })).rating).toBe(rating);
    }
  });

  it('rejects a rating that is present but not an integer in range', () => {
    for (const rating of [0, 6, 2.5, '3', Number.NaN, [4]]) {
      const err = refusal(signup({ rating }));

      expect(err.status).toBe(422);
      expect(err.details?.rating).toBe('Rating must be an integer between 1 and 5.');
    }
  });

  it('normalises the note and stores it', () => {
    const result = parseUserInput(signup({ note: '  keen \n to\ttest  ' }));

    expect(result.note).toBe('keen to test');
  });

  it('accepts a note exactly at the 500-character limit', () => {
    expect(MAX_NOTE_LENGTH).toBe(500);
    expect(parseUserInput(signup({ note: 'a'.repeat(500) })).note).toHaveLength(500);
  });

  it('rejects a note one character over the limit', () => {
    const err = refusal(signup({ note: 'a'.repeat(MAX_NOTE_LENGTH + 1) }));

    expect(err.status).toBe(422);
    expect(err.details?.note).toBe('Note must be 1–500 characters.');
  });

  it('rejects a non-string note that is present', () => {
    expect(refusal(signup({ note: 42 })).details?.note).toBeDefined();
    expect(refusal(signup({ note: { text: 'hi' } })).details?.note).toBeDefined();
  });

  it('accumulates every field failure into a single 422', () => {
    const err = refusal({ name: '  ', email: 'nope', wallet: 'GABC', rating: 9, note: 42 });

    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(Object.keys(err.details ?? {}).sort()).toEqual([
      'email',
      'name',
      'note',
      'rating',
      'wallet',
    ]);
  });

  it('rejects a non-object body with a 400, not a 422', () => {
    for (const body of [null, undefined, 'name=Ada', 42, [], [signup()]]) {
      const err = refusal(body);

      expect(err.status).toBe(400);
      expect(err.code).toBe('bad_request');
    }
  });
});

describe('readJsonBody', () => {
  it('resolves a valid JSON body to the parsed object', async () => {
    expect(await readJsonBody(jsonRequest({ rating: 5, comment: 'Good.' }))).toEqual({
      rating: 5,
      comment: 'Good.',
    });
  });

  it('rejects an empty body with a 400', async () => {
    const err = await rejection(readJsonBody(jsonRequest('')));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects a whitespace-only body with a 400', async () => {
    const err = await rejection(readJsonBody(jsonRequest('   \n ')));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects malformed JSON with a 400', async () => {
    const err = await rejection(readJsonBody(jsonRequest('{"rating": 5,')));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects an oversized body declared by content-length with a 413', async () => {
    const body = 'x'.repeat(5000);
    const request = jsonRequest(body, { 'content-length': String(body.length) });

    expect(request.headers.get('content-length')).toBe('5000');
    expect(body.length).toBeGreaterThan(MAX_BODY_BYTES);

    const err = await rejection(readJsonBody(request));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('rejects an oversized body with no content-length header with a 413', async () => {
    const request = jsonRequest('x'.repeat(5000));

    expect(request.headers.get('content-length')).toBeNull();

    const err = await rejection(readJsonBody(request));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('accepts a body sitting just under the byte ceiling', async () => {
    const comment = 'a'.repeat(MAX_BODY_BYTES - 100);

    expect(await readJsonBody(jsonRequest({ comment }))).toEqual({ comment });
  });

  it('rejects a body with no content-type at all with a 415', async () => {
    const request = new Request('https://x.test', { method: 'POST', body: '{}' });
    request.headers.delete('content-type');

    const err = await rejection(readJsonBody(request));
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
  });

  it('rejects the cross-origin simple-request media types with a 415', async () => {
    // The three types a browser sends without a preflight. Refusing them is
    // what forces a preflight the attacker's page cannot satisfy (ZEN-12).
    for (const type of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const err = await rejection(readJsonBody(jsonRequest('{}', { 'content-type': type })));
      expect(err.status).toBe(415);
      expect(err.code).toBe('unsupported_media_type');
    }
  });

  it('refuses a media type that merely contains the word json', async () => {
    for (const type of ['text/json', 'application/jsonish', 'application/json-patch']) {
      const err = await rejection(readJsonBody(jsonRequest('{}', { 'content-type': type })));
      expect(err.status).toBe(415);
    }
  });

  it('accepts application/json with parameters and the +json suffix', async () => {
    for (const type of [
      'application/json',
      'application/json; charset=utf-8',
      'APPLICATION/JSON',
      'application/merge-patch+json',
    ]) {
      const request = jsonRequest('{"ok":true}', { 'content-type': type });
      expect(await readJsonBody(request)).toEqual({ ok: true });
    }
  });

  it('reports the media type it wants without echoing the one it got', async () => {
    const err = await rejection(
      readJsonBody(jsonRequest('{}', { 'content-type': 'text/plain; secret=abc' })),
    );

    expect(err.message).toContain(JSON_MEDIA_TYPE);
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('text/plain');
  });

  it('accepts a body over the default ceiling when maxBytes raises it', async () => {
    const value = 'x'.repeat(MAX_BODY_BYTES + 1000);
    const body = { value };

    expect(await readJsonBody(jsonRequest(body), { maxBytes: 65536 })).toEqual(body);
  });

  it('rejects a body over a raised maxBytes ceiling with a 413 naming that ceiling', async () => {
    const request = jsonRequest('x'.repeat(70000));

    const err = await rejection(readJsonBody(request, { maxBytes: 65536 }));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
    expect(err.message).toContain('65536');
  });

  it('applies a raised maxBytes to the declared content-length check too', async () => {
    const request = jsonRequest('{}', { 'content-length': '70000' });

    const err = await rejection(readJsonBody(request, { maxBytes: 65536 }));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('still applies the content-type gate when maxBytes is raised', async () => {
    const request = jsonRequest('{}', { 'content-type': 'text/plain' });

    const err = await rejection(readJsonBody(request, { maxBytes: 65536 }));
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
  });
});
describe('parseSearchQuery', () => {
  /** Build the parameters as they arrive on the URL. */
  function params(entries: Record<string, string>): URLSearchParams {
    return new URLSearchParams(entries);
  }

  /** Run the parser on parameters expected to be refused, returning the error. */
  function refusal(entries: Record<string, string>): ApiError {
    try {
      parseSearchQuery(params(entries));
    } catch (error) {
      return error as ApiError;
    }
    throw new Error('Expected parseSearchQuery to throw, but it returned.');
  }

  it('reads a bare query and leaves every option unset', () => {
    expect(parseSearchQuery(params({ query: 'soroban' }))).toEqual({
      query: 'soroban',
      locale: undefined,
      tag: undefined,
      limit: undefined,
    });
  });

  it('treats an absent or blank query as an empty search rather than an error', () => {
    expect(parseSearchQuery(params({})).query).toBe('');
    expect(parseSearchQuery(params({ query: '   ' })).query).toBe('');
  });

  it('trims the query', () => {
    expect(parseSearchQuery(params({ query: '  wallet  ' })).query).toBe('wallet');
  });

  it('accepts a query sitting exactly on the length ceiling', () => {
    const query = 'a'.repeat(MAX_QUERY_LENGTH);

    expect(parseSearchQuery(params({ query })).query).toBe(query);
  });

  it('refuses a query past the length ceiling with a 422', () => {
    const err = refusal({ query: 'a'.repeat(MAX_QUERY_LENGTH + 1) });

    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
    expect(err.details?.query).toBeDefined();
  });

  it('splits a comma-separated tag list and trims each entry', () => {
    expect(parseSearchQuery(params({ query: 'x', tag: ' guide , api ' })).tag).toEqual([
      'guide',
      'api',
    ]);
  });

  it('leaves tag unset when it is blank', () => {
    expect(parseSearchQuery(params({ query: 'x', tag: '  ' })).tag).toBeUndefined();
  });

  it('refuses more tags than the ceiling allows', () => {
    const tag = Array.from({ length: MAX_TAGS + 1 }, (_v, i) => `tag${i}`).join(',');

    expect(refusal({ query: 'x', tag }).details?.tag).toBeDefined();
  });

  it('refuses a tag outside the identifier alphabet', () => {
    for (const tag of ['has space', 'quote"', 'semi;colon', 'star*']) {
      expect(refusal({ query: 'x', tag }).status).toBe(422);
    }
  });

  it('accepts an integer limit inside the ceiling', () => {
    expect(parseSearchQuery(params({ query: 'x', limit: '10' })).limit).toBe(10);
    expect(parseSearchQuery(params({ query: 'x', limit: String(MAX_RESULT_LIMIT) })).limit).toBe(
      MAX_RESULT_LIMIT,
    );
  });

  it('refuses a limit that would allocate an unbounded result set', () => {
    // The handler this replaced accepted any integer, so a caller could ask the
    // index to materialise a million entries on our heap.
    for (const limit of ['1000000', '0', '-5', '1e9', 'many', '2.5', 'Infinity', 'NaN']) {
      expect(refusal({ query: 'x', limit }).details?.limit).toBeDefined();
    }
  });

  it('accepts a locale that is a short identifier', () => {
    expect(parseSearchQuery(params({ query: 'x', locale: 'en-GB' })).locale).toBe('en-GB');
  });

  it('refuses a locale outside the identifier alphabet or over length', () => {
    expect(refusal({ query: 'x', locale: 'en GB' }).status).toBe(422);
    expect(refusal({ query: 'x', locale: 'e'.repeat(65) }).status).toBe(422);
  });

  it('reports every bad parameter in one response', () => {
    const err = refusal({
      query: 'a'.repeat(MAX_QUERY_LENGTH + 1),
      limit: '999999',
      tag: 'bad tag',
      locale: 'bad locale',
    });

    expect(Object.keys(err.details ?? {}).sort()).toEqual(['limit', 'locale', 'query', 'tag']);
  });

  it('ignores parameters it does not know about', () => {
    const parsed = parseSearchQuery(params({ query: 'x', mode: 'vector', extra: 'dropped' }));

    expect(Object.keys(parsed).sort()).toEqual(['limit', 'locale', 'query', 'tag']);
  });
});
