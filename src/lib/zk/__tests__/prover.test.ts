import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGroth16Proof, isWorkerPayload, ProofError, workerError } from '@/lib/zk/prover';

/** A well-formed Groth16 proof, shaped like the snarkjs output. */
const proof = () => ({
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['1', '0'],
  ],
  pi_c: ['7', '8', '1'],
  protocol: 'groth16',
  curve: 'bn128',
});

/** A well-formed worker success payload. */
const payload = () => ({
  ok: true as const,
  proof: proof(),
  publicSignals: ['1', '2', '3'],
  verified: true,
  proveMs: 1200,
  verifyMs: 15,
});

describe('isGroth16Proof', () => {
  it('accepts the snarkjs proof shape', () => {
    expect(isGroth16Proof(proof())).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isGroth16Proof(null)).toBe(false);
    expect(isGroth16Proof(undefined)).toBe(false);
    expect(isGroth16Proof('proof')).toBe(false);
    expect(isGroth16Proof(42)).toBe(false);
  });

  it('rejects a proof whose points are not string arrays', () => {
    expect(isGroth16Proof({ ...proof(), pi_a: [1, 2, 3] })).toBe(false);
    expect(isGroth16Proof({ ...proof(), pi_b: ['3', '4'] })).toBe(false);
    expect(isGroth16Proof({ ...proof(), pi_b: [['3', 4]] })).toBe(false);
  });

  it('rejects a proof missing a point', () => {
    const { pi_c: _dropped, ...partial } = proof();
    expect(isGroth16Proof(partial)).toBe(false);
  });
});

describe('isWorkerPayload', () => {
  it('accepts the worker success payload', () => {
    expect(isWorkerPayload(payload())).toBe(true);
  });

  it('rejects anything not flagged ok: true', () => {
    expect(isWorkerPayload({ ...payload(), ok: false })).toBe(false);
    expect(isWorkerPayload({ ...payload(), ok: 'true' })).toBe(false);
    const { ok: _dropped, ...unflagged } = payload();
    expect(isWorkerPayload(unflagged)).toBe(false);
  });

  it('rejects a malformed proof or signal list', () => {
    expect(isWorkerPayload({ ...payload(), proof: {} })).toBe(false);
    expect(isWorkerPayload({ ...payload(), publicSignals: [1, 2] })).toBe(false);
  });

  it('rejects missing or mistyped result fields', () => {
    expect(isWorkerPayload({ ...payload(), verified: 'yes' })).toBe(false);
    expect(isWorkerPayload({ ...payload(), proveMs: '1200' })).toBe(false);
    expect(isWorkerPayload({ ...payload(), verifyMs: undefined })).toBe(false);
    expect(isWorkerPayload(null)).toBe(false);
  });
});

describe('workerError', () => {
  it('returns the worker-reported error text', () => {
    expect(workerError({ ok: false, error: 'witness generation failed' })).toBe(
      'witness generation failed',
    );
  });

  it('falls back to the bad-witness explanation for anything else', () => {
    const fallback = 'The circuit rejected these inputs, so no witness could be computed.';
    expect(workerError({ ok: false, error: '' })).toBe(fallback);
    expect(workerError({ ok: false, error: '   ' })).toBe(fallback);
    expect(workerError({ ok: false })).toBe(fallback);
    expect(workerError(null)).toBe(fallback);
    expect(workerError('boom')).toBe(fallback);
  });
});

/** Minimal Response-like object for primeFile's non-streaming path. */
function okResponse(bytes: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-length' ? String(bytes) : null) },
    body: null,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  };
}

function badResponse() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

/**
 * loadCircuit memoises at module scope, so each test imports a fresh copy of
 * the module to start from an unprimed cache.
 */
async function freshProver() {
  vi.resetModules();
  return await import('@/lib/zk/prover');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadCircuit', () => {
  it('memoises a successful download — the second run refetches nothing', async () => {
    const fetchMock = vi.fn(async () => okResponse(10));
    vi.stubGlobal('fetch', fetchMock);
    const { loadCircuit } = await freshProver();

    await loadCircuit(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await loadCircuit(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resets the memo on failure so a retry can succeed', async () => {
    const fetchMock = vi
      .fn(async () => okResponse(10))
      .mockImplementationOnce(async () => badResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { loadCircuit, ProofError: FreshProofError } = await freshProver();

    // First run: one artefact 404s, the whole load rejects, stage-tagged.
    const failed = loadCircuit(() => {}).catch((err: unknown) => err);
    const err = await failed;
    expect(err).toBeInstanceOf(FreshProofError);
    expect((err as InstanceType<typeof FreshProofError>).stage).toBe('circuit');

    // Second run: the failed promise was not memoised, so it fetches again.
    const before = fetchMock.mock.calls.length;
    await loadCircuit(() => {});
    expect(fetchMock.mock.calls.length).toBe(before + 3);
  });

  it('reports an indeterminate total until every artefact size is known', async () => {
    const sizes = [10, 20, 30];
    let call = 0;
    const fetchMock = vi.fn(async () => okResponse(sizes[call++ % sizes.length] ?? 0));
    vi.stubGlobal('fetch', fetchMock);
    const { loadCircuit } = await freshProver();

    const reports: Array<[number, number]> = [];
    await loadCircuit((loaded, total) => reports.push([loaded, total]));

    const sum = sizes.reduce((a, b) => a + b, 0);
    // Every determinate report carries the final, complete total…
    for (const [, total] of reports) {
      if (total !== 0) expect(total).toBe(sum);
    }
    // …and the download ends fully accounted for.
    const last = reports[reports.length - 1];
    if (!last) throw new Error('expected at least one progress report');
    const [lastLoaded, lastTotal] = last;
    expect(lastLoaded).toBe(sum);
    expect(lastTotal).toBe(sum);
  });
});

describe('ProofError', () => {
  it('carries the stage it happened in', () => {
    const err = new ProofError('proving', 'boom');
    expect(err.stage).toBe('proving');
    expect(err.message).toBe('boom');
    expect(err.name).toBe('ProofError');
  });
});
