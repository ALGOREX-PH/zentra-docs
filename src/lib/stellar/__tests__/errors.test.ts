import { describe, it, expect } from 'vitest';
import { describeError } from '@/lib/stellar/errors';

describe('describeError', () => {
  it('treats wallet rejections as a declined signature', () => {
    expect(describeError(new Error('User declined the request'))).toMatch(
      /declined/i,
    );
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

  it('falls back to a non-empty string for a plain string error', () => {
    const result = describeError('boom');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
