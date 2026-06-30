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

/** The pre-computed valid circuit input shipped with the app. */
export async function loadExampleInput(): Promise<Record<string, unknown>> {
  const res = await fetch('/zk/input.example.json');
  if (!res.ok) throw new Error('Could not load the circuit input.');
  return res.json();
}

/**
 * Generate **and** verify a real Groth16/BN254 proof for the payment-policy
 * circuit in a Web Worker, so the (multi-second) proving never blocks the UI.
 */
export function generateProof(input: Record<string, unknown>): Promise<ProofResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/zk-worker.js');
    worker.onmessage = (event: MessageEvent) => {
      worker.terminate();
      const data = event.data;
      if (data?.ok) {
        resolve({
          proof: data.proof,
          publicSignals: data.publicSignals,
          verified: data.verified,
          proveMs: data.proveMs,
          verifyMs: data.verifyMs,
        });
      } else {
        reject(new Error(data?.error || 'Proof generation failed.'));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Proof worker error.'));
    };
    worker.postMessage({ input });
  });
}
