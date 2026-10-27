import { expect, loggedInAs, test } from "./fixtures.ts";

// One run's message, so the inbox check finds this one and not an older one.
const marker = `e2e ${Date.now()}`;

test.describe.serial("contact form", () => {
  test("a visitor sends a message", async ({ page }) => {
    await page.goto("/contact");

    await page.getByLabel("Name").fill("End-to-end");
    await page.getByLabel("Email").fill("e2e@example.invalid");
    await page.getByLabel("Message").fill(`Hello from ${marker}.`);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Message sent.")).toBeVisible();
  });

  test.describe("the admin", () => {
    loggedInAs("e2e-admin");

    test("finds it in the inbox", async ({ page }) => {
      await page.goto("/admin/inbox");

      await expect(page.getByText(`Hello from ${marker}.`)).toBeVisible();
    });
  });
});
