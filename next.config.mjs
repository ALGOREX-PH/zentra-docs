import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * Baseline security headers applied to every route.
 *
 * A full `script-src` policy is deliberately omitted: the ZK playground runs a
 * Groth16 witness in WebAssembly inside a Web Worker, which needs
 * `wasm-unsafe-eval`, and Next injects inline bootstrap scripts. Shipping a
 * strict policy without a nonce pipeline would break proving in production, so
 * we ship the directives that are unambiguously safe today. `frame-ancestors`
 * is enforced regardless, since it is unaffected by that constraint.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withMDX(config);
