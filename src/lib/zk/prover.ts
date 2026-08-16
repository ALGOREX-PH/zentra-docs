export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface ProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
  verified: boolean;
  proveMs: number;
  verifyMs: number;
}

/**
 * The phases of a run the app can genuinely observe.
 *
 * The circuit download happens on the main thread, so it reports real bytes.
 * Everything after it — witness, proof, verification — runs inside a single
 * worker round-trip and settles together, with the worker's own measured
 * prove/verify split, when it returns.
 */
export type ProofStage = 'circuit' | 'proving';

/** What a run reports as it moves through those phases. */
export type ProofProgress =
  | { stage: 'circuit'; loaded: number; total: number }
  | { stage: 'proving' };

export interface ProofRunOptions {
  /** Called on every real transition, and on each chunk of the circuit download. */
  onProgress?: (progress: ProofProgress) => void;
  /** Tears the worker down when the caller goes away mid-run. */
  signal?: AbortSignal;
}

/** A failure tagged with the stage it happened in, so the UI can point at it. */
export class ProofError extends Error {
  readonly stage: ProofStage;

  constructor(stage: ProofStage, message: string) {
    super(message);
    this.name = 'ProofError';
    this.stage = stage;
  }
}

/** The pre-computed valid circuit input shipped with the app. */
export async function loadExampleInput(): Promise<Record<string, unknown>> {
  const res = await fetch('/zk/input.example.json');
  if (!res.ok) {
    throw new ProofError('circuit', `Could not load the circuit input (HTTP ${res.status}).`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** The artefacts the worker reads by URL, largest first. */
const CIRCUIT_FILES = [
  '/zk/payment_policy.wasm',
  '/zk/payment_policy.zkey',
  '/zk/verification_key.json',
];

let circuitReady: Promise<void> | null = null;

/** Stream one artefact into the HTTP cache, reporting bytes as they land. */
async function primeFile(
  url: string,
  onSize: (bytes: number) => void,
  onChunk: (bytes: number) => void,
): Promise<void> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    const name = url.split('/').pop() ?? url;
    throw new ProofError('circuit', `Could not load ${name} (HTTP ${res.status}).`);
  }
  onSize(Number.parseInt(res.headers.get('content-length') ?? '', 10) || 0);

  const body = res.body;
  if (!body) {
    // No streaming here — read it in one go, which still primes the cache.
    onChunk((await res.arrayBuffer()).byteLength);
    return;
  }
  const reader = body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    onChunk(chunk.value.byteLength);
  }
}

/**
 * Download the circuit artefacts up front.
 *
 * snarkjs requests the same URLs from inside the worker, where they resolve
 * from the HTTP cache — so this adds no extra transfer and turns the largest
 * slice of a cold run (~5.5 MB) into a stage with real byte progress rather
 * than dead time. Memoised, so a second proof skips it entirely.
 *
 * Exported for the prover boundary tests; the app reaches it via generateProof.
 */
export function loadCircuit(onProgress: (loaded: number, total: number) => void): Promise<void> {
  if (circuitReady) return circuitReady;

  let loaded = 0;
  let total = 0;
  let sized = 0;
  // Until every artefact has reported its size the running total is a lie —
  // a percent computed against it would leap backwards as later sizes land.
  // Report 0 (indeterminate) instead, and a real total only once complete.
  const report = () => onProgress(loaded, sized === CIRCUIT_FILES.length ? total : 0);
  const ready = Promise.all(
    CIRCUIT_FILES.map((url) =>
      primeFile(
        url,
        (bytes) => {
          total += bytes;
          sized += 1;
          report();
        },
        (bytes) => {
          loaded += bytes;
          report();
        },
      ),
    ),
  ).then(() => undefined);

  circuitReady = ready.catch((err: unknown) => {
    // A failed download must not poison the retry.
    circuitReady = null;
    throw err;
  });
  return circuitReady;
}

interface WorkerPayload {
  ok: true;
  proof: Groth16Proof;
  publicSignals: string[];
  verified: boolean;
  proveMs: number;
  verifyMs: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Structural check on the worker's proof object. Exported for tests. */
export function isGroth16Proof(value: unknown): value is Groth16Proof {
  if (typeof value !== 'object' || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    isStringArray(proof.pi_a) &&
    Array.isArray(proof.pi_b) &&
    proof.pi_b.every(isStringArray) &&
    isStringArray(proof.pi_c)
  );
}

/** The worker is untyped JS, so its reply is checked before it reaches the UI. */
export function isWorkerPayload(value: unknown): value is WorkerPayload {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    data.ok === true &&
    isGroth16Proof(data.proof) &&
    isStringArray(data.publicSignals) &&
    typeof data.verified === 'boolean' &&
    typeof data.proveMs === 'number' &&
    typeof data.verifyMs === 'number'
  );
}

/** The worker's own failure text — a bad witness is the usual cause. */
export function workerError(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const { error } = value as Record<string, unknown>;
    if (typeof error === 'string' && error.trim() !== '') return error;
  }
  return 'The circuit rejected these inputs, so no witness could be computed.';
}

/**
 * How long a single worker round-trip may take before the run is declared
 * hung. Proving is seconds even on slow hardware, so this is generous — it
 * exists so a wedged worker can never leave the lab stuck at "proving" forever.
 */
const PROVING_TIMEOUT_MS = 120_000;

function runWorker(
  input: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ProofResult> {
  return new Promise<ProofResult>((resolve, reject) => {
    const worker = new Worker('/zk-worker.js');
    // Whatever ends the run — reply, crash, abort, timeout — the worker is
    // terminated and every pending handler is detached exactly once.
    const stop = () => {
      clearTimeout(watchdog);
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      stop();
      reject(new ProofError('proving', 'Proof run cancelled.'));
    };
    const watchdog = setTimeout(() => {
      stop();
      reject(
        new ProofError(
          'proving',
          `The prover did not respond within ${PROVING_TIMEOUT_MS / 1000}s, so the run was abandoned.`,
        ),
      );
    }, PROVING_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<unknown>) => {
      stop();
      if (isWorkerPayload(event.data)) {
        const { proof, publicSignals, verified, proveMs, verifyMs } = event.data;
        resolve({ proof, publicSignals, verified, proveMs, verifyMs });
        return;
      }
      reject(new ProofError('proving', workerError(event.data)));
    };
    worker.onerror = (event: ErrorEvent) => {
      stop();
      reject(new ProofError('proving', event.message || 'The proof worker crashed.'));
    };
    // A reply that fails structured deserialisation raises messageerror, not
    // message — without this handler such a run would only die by watchdog.
    worker.onmessageerror = () => {
      stop();
      reject(new ProofError('proving', 'The proof worker sent a reply that could not be read.'));
    };
    worker.postMessage({ input });
  });
}

/**
 * Generate **and** verify a real Groth16/BN254 proof for the payment-policy
 * circuit in a Web Worker, so the (multi-second) proving never blocks the UI.
 */
export async function generateProof(
  input: Record<string, unknown>,
  options: ProofRunOptions = {},
): Promise<ProofResult> {
  const { onProgress, signal } = options;
  if (typeof Worker === 'undefined') {
    throw new ProofError(
      'circuit',
      'This browser cannot run the prover — Web Workers are unavailable.',
    );
  }

  onProgress?.({ stage: 'circuit', loaded: 0, total: 0 });
  await loadCircuit((loaded, total) => onProgress?.({ stage: 'circuit', loaded, total }));
  if (signal?.aborted) throw new ProofError('circuit', 'Proof run cancelled.');

  onProgress?.({ stage: 'proving' });
  return runWorker(input, signal);
}
