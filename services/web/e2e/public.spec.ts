import { accessibilityProblems, expect, test } from "./fixtures.ts";

const pages = [
  "/",
  "/blog",
  "/projects",
  "/about",
  "/contact",
  "/impressum",
  "/datenschutz",
];

test.describe("public pages", () => {
  for (const path of pages) {
    test(`${path} renders, with head tags and without a11y problems`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        /\S/,
      );
      expect(await accessibilityProblems(page)).toEqual([]);
    });
  }

  test("an unknown path is a 404 that search engines skip", async ({
    page,
  }) => {
    await page.goto("/no/such/page");

    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("the header navigates without reloading", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("link", { name: "blog", exact: true })
      .click();

    await expect(page).toHaveURL("/blog");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
