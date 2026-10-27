import { expect, loggedInAs, test } from "./fixtures.ts";

test.describe("anonymous", () => {
  test("the admin area asks to log in", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByText("permission denied")).toBeVisible();
    const login = page.getByRole("main").getByRole("link", { name: "Log in" });
    await expect(login).toHaveAttribute(
      "href",
      /^\/api\/auth\/login\?returnTo=%2Fadmin$/,
    );
  });
});

test.describe("a user without roles", () => {
  loggedInAs("e2e-user");

  test("is refused in the admin area", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByText("403", { exact: true })).toBeVisible();
  });

  test("sees their own account", async ({ page }) => {
    await page.goto("/account");

    await expect(
      page.getByRole("main").getByText("e2e-user").first(),
    ).toBeVisible();
  });
});

test.describe("an admin", () => {
  loggedInAs("e2e-admin");

  test("reaches the admin area and its pages", async ({ page }) => {
    await page.goto("/admin");

    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Users" }).click();
    await expect(page).toHaveURL("/admin/users");
    await expect(
      page.getByRole("main").getByText("e2e-admin").first(),
    ).toBeVisible();
  });
});
