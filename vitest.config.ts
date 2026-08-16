import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `scripts/**` carries the load-test harness, which is plain Node and has no
    // business under `src/` — but its pure logic is still worth testing.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Pure logic under `src/` is what unit tests are expected to cover.
      // `.tsx` presentation components are exercised in the browser, not by
      // unit tests, so they stay out of the coverage denominator.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      // Regression floor, set ~5 points under the measured baseline
      // (stmts 45.6 / branch 50.9 / funcs 42.8 / lines 46.2 on 2026-08-16).
      // Raise these as coverage grows; they gate slides, not new work.
      thresholds: {
        statements: 40,
        branches: 45,
        functions: 37,
        lines: 41,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
