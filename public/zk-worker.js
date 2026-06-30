/* eslint-disable */
// Classic Web Worker: generates and verifies a real Groth16 (BN254) proof for
// the Zentra payment-policy circuit, off the main thread. snarkjs is loaded as
// a UMD bundle (it does not bundle cleanly), exposing `self.snarkjs`.
importScripts('/zk/snarkjs.min.js');

self.onmessage = async (event) => {
  const { input } = event.data || {};
  try {
    const t0 = performance.now();
    const { proof, publicSignals } = await self.snarkjs.groth16.fullProve(
      input,
      '/zk/payment_policy.wasm',
      '/zk/payment_policy.zkey',
    );
    const t1 = performance.now();

    const vk = await fetch('/zk/verification_key.json').then((r) => r.json());
    const verified = await self.snarkjs.groth16.verify(vk, publicSignals, proof);
    const t2 = performance.now();

    self.postMessage({
      ok: true,
      proof,
      publicSignals,
      verified,
      proveMs: Math.round(t1 - t0),
      verifyMs: Math.round(t2 - t1),
    });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
