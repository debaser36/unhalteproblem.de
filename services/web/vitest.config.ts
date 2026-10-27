import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          // Pure modules: fast, in Node.
          extends: true,
          test: { name: "unit", include: ["src/**/*.test.ts"] },
        },
        {
          // Components and pages, rendered in a real Chromium: the editor
          // (ProseMirror) needs real selections and layout.
          extends: true,
          test: {
            name: "browser",
            include: ["src/**/*.browser.test.tsx"],
            setupFiles: ["./src/testing/setup.ts"],
            browser: {
              enabled: true,
              headless: true,
              // Desktop width: some labels only show from `sm` up.
              viewport: { width: 1280, height: 800 },
              screenshotFailures: false,
              provider: playwright({
                launchOptions: {
                  // The dev shell's Chromium (flake.nix); Playwright's own
                  // download does not run on NixOS.
                  ...(process.env.CHROMIUM_EXECUTABLE
                    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
                    : {}),
                  // CI and containers may run as root, where Chromium's
                  // sandbox cannot start; the pages are our own.
                  args: ["--no-sandbox"],
                },
              }),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  }),
);
