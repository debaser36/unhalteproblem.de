import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderApp } from "#testing/render.tsx";

// Through the real routes: the request page needs a login, the admin
// area the `admin` role.
describe("RequireUser", () => {
  it("asks anonymous visitors to log in and comes back afterwards", async () => {
    const { screen } = await renderApp("/blog/~request?from=nav");

    await expect.element(screen.getByText("permission denied")).toBeVisible();
    const login = screen
      .getByRole("main")
      .getByRole("link", { name: "Log in" });
    await expect.element(login).toBeVisible();
    const href = new URL(
      login.element().getAttribute("href") ?? "",
      location.origin,
    );
    expect(href.pathname).toBe("/api/auth/login");
    expect(href.searchParams.get("returnTo")).toBe("/blog/~request?from=nav");
  });

  it("refuses a user without the role", async () => {
    const { screen } = await renderApp(
      "/admin",
      fakeApi({}, { roles: ["normalUser"] }),
    );

    await expect.element(screen.getByText("403")).toBeVisible();
    await expect
      .element(screen.getByText("admin", { exact: true }))
      .toBeVisible();
  });

  it("shows the page to a logged-in user", async () => {
    const { screen } = await renderApp(
      "/blog/~request",
      fakeApi(
        { blogRequests: { listMyBlogRequests: () => Effect.succeed([]) } },
        { roles: ["normalUser"] },
      ),
    );

    await expect
      .element(screen.getByRole("button", { name: "Send request" }))
      .toBeVisible();
  });

  it("says so when the backend cannot be reached", async () => {
    const { screen } = await renderApp(
      "/blog/~request",
      fakeApi({
        auth: { session: () => Effect.die(new Error("connection refused")) },
      }),
    );

    await expect
      .element(screen.getByText("The server is not answering."))
      .toBeVisible();
  });
});
