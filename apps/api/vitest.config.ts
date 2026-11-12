import { defineConfig } from 'vitest/config';

/**
 * Integration tests: each file boots a migrated PGlite database (and the API
 * suites hash passwords on sign-up). That's a few seconds alone, but under
 * `pnpm test` every package runs in parallel and CI runners are slower, so
 * Vitest's 5 s test / 10 s hook defaults cause false timeouts.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
