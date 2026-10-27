import { expect, loggedInAs, test } from "./fixtures.ts";
import { e2eBlog } from "./users.ts";

test.describe("an editor", () => {
  loggedInAs("e2e-admin");

  test("writes a post, publishes it, and readers see it", async ({ page }) => {
    const title = `Smoke test ${Date.now()}`;
    await page.goto(`/blog/${e2eBlog}/edit/new`);

    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Summary").fill("Written by Playwright.");
    await page.getByLabel("Document editor").click();
    await page.keyboard.type("## It works\nThe whole way through.");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(
      page.getByRole("status").getByText("Published."),
    ).toBeVisible();

    await page.goto(`/blog/${e2eBlog}`);
    await page.getByRole("link", { name: title }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "It works" })).toBeVisible();
    await expect(page.getByText("The whole way through.")).toBeVisible();
  });
});
