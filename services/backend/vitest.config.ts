import { defineConfig } from "vitest/config";

// The HTTP tests start the whole backend on a fresh in-memory Postgres
// (PGlite, all migrations) and log in through the fake identity provider,
// which takes a few seconds per test on a loaded machine or a CI runner.
// The default 5 s made them flaky; nothing here waits that long on purpose.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
