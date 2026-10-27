import { defineConfig } from "@playwright/test";

// The end-to-end smoke tests run against the local stack (`stack up`, see
// nix/stack.sh): the real backend on Postgres behind the Vite dev server.
// The global setup starts it if needed and seeds the logins.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One stack, one database: tests that write go one after another.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    // No fade-ins or blinking cursor: axe would measure the contrast of
    // half-transparent text, and screenshots differ less.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: {
      // The dev shell's Chromium (flake.nix); Playwright's own download
      // does not run on NixOS.
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
      // CI and containers may run as root, where Chromium's sandbox cannot
      // start; the pages are our own on loopback.
      args: ["--no-sandbox"],
    },
  },
});
