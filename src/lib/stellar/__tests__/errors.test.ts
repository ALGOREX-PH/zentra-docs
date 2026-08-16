import { describe, expect, it } from 'vitest';
import { describeError, InvokeFailedError, SubmitTimeoutError } from '@/lib/stellar/errors';

describe('describeError', () => {
  it('treats wallet rejections as a declined signature', () => {
    expect(describeError(new Error('User declined the request'))).toMatch(/declined/i);
  });

  it('explains an insufficient-balance transaction code', () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { transaction: 'tx_insufficient_balance' },
          },
        },
      },
    };
    expect(describeError(err)).toContain('Not enough XLM');
  });

  it('explains a missing destination operation code', () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { operations: ['op_no_destination'] },
          },
        },
      },
    };
    expect(describeError(err)).toMatch(/destination account does not exist/i);
  });

  it('explains a stale sequence transaction code as retryable', () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { transaction: 'tx_bad_seq' },
          },
        },
      },
    };
    expect(describeError(err)).toMatch(/sequence.*try again/i);
  });

  it('explains an underfunded operation code', () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { operations: ['op_underfunded'] },
          },
        },
      },
    };
    expect(describeError(err)).toMatch(/not enough XLM in your account/i);
  });

  // The copy must not claim failure: the transaction may still settle, and the
  // user's next move should be the explorer, not a second signature.
  it('keeps a submit timeout unresolved rather than calling it a failure', () => {
    const hash = 'ab'.repeat(32);
    const err = new SubmitTimeoutError(hash);
    expect(err.hash).toBe(hash);
    expect(describeError(err)).toMatch(/may still have gone through/i);
    expect(describeError(err)).toMatch(/check the explorer/i);
    expect(describeError(err)).not.toMatch(/failed/i);
  });

  it('falls back to a non-empty string for a plain string error', () => {
    const result = describeError('boom');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('accepts an invoke-specific message for a submit timeout, keeping the hash', () => {
    const hash = 'cd'.repeat(32);
    const err = new SubmitTimeoutError(hash, 'The invoke may still land. Check the explorer.');
    expect(err.hash).toBe(hash);
    expect(describeError(err)).toBe('The invoke may still land. Check the explorer.');
  });

  // Diagnostics quoted inside an invoke failure are free text from a contract;
  // words like "cancelled" in them must not be misread as a wallet rejection.
  it('passes an invoke failure through verbatim even when diagnostics mention cancellation', () => {
    const err = new InvokeFailedError('The transaction failed on-chain (order was cancelled).');
    expect(describeError(err)).toBe('The transaction failed on-chain (order was cancelled).');
  });

  it('carries an optional hash on an invoke failure for the explorer link', () => {
    const hash = 'ef'.repeat(32);
    expect(new InvokeFailedError('failed', hash).hash).toBe(hash);
    expect(new InvokeFailedError('refused').hash).toBeUndefined();
  });
});
