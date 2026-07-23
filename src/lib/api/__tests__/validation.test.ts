import { describe, it, expect } from 'vitest';
import type { ApiError } from '@/lib/api/errors';
import {
  MAX_BODY_BYTES,
  MAX_COMMENT_LENGTH,
  isStellarAccountId,
  isTxHash,
  parseFeedbackInput,
  readJsonBody,
} from '@/lib/api/validation';

const VALID_WALLET = `G${'A'.repeat(55)}`;
const VALID_TX_HASH = 'ab12'.repeat(16);
const FEEDBACK_KEYS = ['comment', 'onChain', 'rating', 'txHash', 'wallet'];

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

  it('keeps onChain true when a valid hash backs it', () => {
    const result = parseFeedbackInput({
      rating: 5,
      comment: 'Anchored.',
      onChain: true,
      txHash: VALID_TX_HASH,
    });

    expect(result.onChain).toBe(true);
    expect(result.txHash).toBe(VALID_TX_HASH);
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

describe('readJsonBody', () => {
  it('resolves a valid JSON body to the parsed object', async () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      body: JSON.stringify({ rating: 5, comment: 'Good.' }),
    });

    expect(await readJsonBody(request)).toEqual({ rating: 5, comment: 'Good.' });
  });

  it('rejects an empty body with a 400', async () => {
    const request = new Request('https://x.test', { method: 'POST', body: '' });
    const err = await rejection(readJsonBody(request));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects a whitespace-only body with a 400', async () => {
    const request = new Request('https://x.test', { method: 'POST', body: '   \n ' });
    const err = await rejection(readJsonBody(request));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects malformed JSON with a 400', async () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      body: '{"rating": 5,',
    });
    const err = await rejection(readJsonBody(request));

    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
  });

  it('rejects an oversized body declared by content-length with a 413', async () => {
    const body = 'x'.repeat(5000);
    const request = new Request('https://x.test', {
      method: 'POST',
      body,
      headers: { 'content-length': String(body.length) },
    });

    expect(request.headers.get('content-length')).toBe('5000');
    expect(body.length).toBeGreaterThan(MAX_BODY_BYTES);

    const err = await rejection(readJsonBody(request));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('rejects an oversized body with no content-length header with a 413', async () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      body: 'x'.repeat(5000),
    });

    expect(request.headers.get('content-length')).toBeNull();

    const err = await rejection(readJsonBody(request));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('accepts a body sitting just under the byte ceiling', async () => {
    const comment = 'a'.repeat(MAX_BODY_BYTES - 100);
    const request = new Request('https://x.test', {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });

    expect(await readJsonBody(request)).toEqual({ comment });
  });
});
