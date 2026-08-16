import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulateRead } from '@/lib/stellar/action-log';
import { getFeedbackAuthors, getFeedbackCount, hasAuthor } from '@/lib/stellar/feedback';

// `simulateRead` is the feedback module's boundary to the chain.
vi.mock('@/lib/stellar/action-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/action-log')>();
  return { ...actual, simulateRead: vi.fn() };
});

const AUTHOR = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hasAuthor', () => {
  it('accepts any object whose author is a string', () => {
    expect(hasAuthor({ author: AUTHOR })).toBe(true);
    expect(hasAuthor({ author: AUTHOR, rating: 5n, comment: 'good' })).toBe(true);
  });

  it('rejects non-objects and non-string authors', () => {
    expect(hasAuthor(null)).toBe(false);
    expect(hasAuthor('entry')).toBe(false);
    expect(hasAuthor({})).toBe(false);
    expect(hasAuthor({ author: 7 })).toBe(false);
  });
});

describe('getFeedbackAuthors', () => {
  it('returns an empty list when the contract answer is not an array', async () => {
    vi.mocked(simulateRead).mockResolvedValue(3);

    await expect(getFeedbackAuthors()).resolves.toEqual([]);
  });

  it('collects authors and skips malformed entries with a single structured warn', async () => {
    vi.mocked(simulateRead).mockResolvedValue([
      { author: AUTHOR, rating: 5n, comment: 'good' },
      { rating: 1n },
      'junk',
    ]);

    await expect(getFeedbackAuthors()).resolves.toEqual([AUTHOR]);

    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0])) as Record<
      string,
      unknown
    >;
    expect(line.event).toBe('feedback.entry_skipped');
    expect(line.skipped).toBe(2);
    expect(line.total).toBe(3);
  });
});

describe('getFeedbackCount', () => {
  it('coerces the simulated count to a number, defaulting to 0', async () => {
    vi.mocked(simulateRead).mockResolvedValue(7n);
    await expect(getFeedbackCount()).resolves.toBe(7);

    vi.mocked(simulateRead).mockResolvedValue(null);
    await expect(getFeedbackCount()).resolves.toBe(0);
  });
});
