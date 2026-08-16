import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitProof, getRecentProofs, isRawProof, toHex } from '@/lib/stellar/proofs';
import { simulateRead } from '@/lib/stellar/action-log';

// `simulateRead` is the proofs module's boundary to the chain; everything else
// in action-log stays real so the guard helpers under test are the shipped ones.
vi.mock('@/lib/stellar/action-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/action-log')>();
  return { ...actual, simulateRead: vi.fn() };
});

const PROVER = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

/** The commitment layout re-derived independently: each signal as 32-byte big-endian. */
function expectedDigest(signals: string[]): string {
  const packed = Buffer.concat(
    signals.map((signal) => Buffer.from(BigInt(signal).toString(16).padStart(64, '0'), 'hex')),
  );
  return createHash('sha256').update(packed).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('commitProof', () => {
  it('hashes each public signal as a 32-byte big-endian word', async () => {
    // A small value (mostly leading zeros) and one wider than 64 bits, so both
    // the padding and the multi-limb encoding are exercised.
    const signals = ['1', '340282366920938463463374607431768211456'];

    const digest = toHex(await commitProof(signals));

    expect(digest).toBe(expectedDigest(signals));
  });

  it('produces the SHA-256 of the empty string for no signals', async () => {
    expect(toHex(await commitProof([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is order-sensitive, binding the commitment to one specific proof', async () => {
    const forward = toHex(await commitProof(['1', '2']));
    const reversed = toHex(await commitProof(['2', '1']));
    expect(forward).not.toBe(reversed);
  });
});

describe('toHex', () => {
  it('zero-pads every byte to two characters', () => {
    expect(toHex(new Uint8Array([0, 1, 255]))).toBe('0001ff');
  });

  it('renders an empty array as an empty string', () => {
    expect(toHex(new Uint8Array([]))).toBe('');
  });
});

describe('isRawProof', () => {
  const valid = {
    index: 2n,
    prover: PROVER,
    commitment: Buffer.alloc(32, 7),
    signals: 3,
    ledger: 99,
  };

  it('accepts a proof entry with Buffer or Uint8Array commitment', () => {
    expect(isRawProof(valid)).toBe(true);
    expect(isRawProof({ ...valid, commitment: new Uint8Array(32) })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isRawProof(null)).toBe(false);
    expect(isRawProof('proof')).toBe(false);
    expect(isRawProof(7)).toBe(false);
  });

  it('rejects entries missing or mistyping a consumed field', () => {
    expect(isRawProof({ ...valid, prover: 7 })).toBe(false);
    expect(isRawProof({ ...valid, commitment: 'deadbeef' })).toBe(false);
    expect(isRawProof({ ...valid, signals: '3' })).toBe(false);
    expect(isRawProof({ ...valid, ledger: Number.NaN })).toBe(false);
  });
});

describe('getRecentProofs', () => {
  it('returns an empty list when the contract answer is not an array', async () => {
    vi.mocked(simulateRead).mockResolvedValue(5);

    await expect(getRecentProofs()).resolves.toEqual([]);
  });

  it('decodes valid proofs and skips invalid ones with a single structured warn', async () => {
    vi.mocked(simulateRead).mockResolvedValue([
      { index: 2n, prover: PROVER, commitment: Buffer.alloc(32, 7), signals: 3, ledger: 99 },
      { index: 3n, prover: PROVER, commitment: 'not-bytes', signals: 1, ledger: 100 },
    ]);

    const proofs = await getRecentProofs();

    expect(proofs).toEqual([
      {
        index: 2,
        prover: PROVER,
        commitment: '07'.repeat(32),
        signals: 3,
        ledger: 99,
      },
    ]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0])) as Record<
      string,
      unknown
    >;
    expect(line.event).toBe('proofs.entry_skipped');
    expect(line.skipped).toBe(1);
    expect(line.total).toBe(2);
  });
});
