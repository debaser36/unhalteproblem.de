import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { authFile, type TestUser } from "./users.ts";

/** Runs the tests of the current `describe` logged in as `user`. */
export const loggedInAs = (user: TestUser) =>
  base.use({ storageState: authFile(user) });

/** The serious and critical accessibility problems axe finds on the page. */
export const accessibilityProblems = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((node) => node.target.join(" ")).join(", ")})`,
    );
};

/**
 * Fails a test on uncaught errors and console errors in the page. The 401
 * of `GET /api/auth/session` is how an anonymous visitor's session looks,
 * not an error.
 */
export const test = base.extend<{ pageErrors: Array<string> }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: Array<string> = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const url = message.location().url;
        const anonymousSession =
          url.endsWith("/api/auth/session") && /\b401\b/.test(message.text());
        if (!anonymousSession) errors.push(`${message.text()} (${url})`);
      });
      await use(errors);
      expect(errors, "errors in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
