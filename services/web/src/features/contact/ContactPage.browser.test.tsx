import { RateLimited } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";
import { ContactPage } from "./ContactPage.tsx";

const fillIn = async (
  screen: Awaited<ReturnType<typeof renderWithApi>>["screen"],
) => {
  await screen.getByLabelText("Name").fill("  Ada Lovelace ");
  await screen.getByLabelText("Email").fill("ada@example.org");
  await screen.getByLabelText("Message").fill("Hello there!\n");
};

describe("ContactPage", () => {
  it("sends the trimmed message and thanks the sender", async () => {
    const api = fakeApi({ contact: { submit: () => Effect.void } });
    const { screen } = await renderWithApi(<ContactPage />, api);

    await fillIn(screen);
    await screen.getByRole("button", { name: "Send" }).click();

    await expect.element(screen.getByText("Message sent.")).toBeVisible();
    await expect.element(screen.getByText("ada@example.org")).toBeVisible();
    expect(api.callsTo("contact", "submit")).toEqual([
      {
        payload: {
          name: "Ada Lovelace",
          email: "ada@example.org",
          message: "Hello there!",
        },
      },
    ]);
  });

  it("explains the rate limit and keeps the message", async () => {
    const api = fakeApi({
      contact: { submit: () => Effect.fail(new RateLimited()) },
    });
    const { screen } = await renderWithApi(<ContactPage />, api);

    await fillIn(screen);
    await screen.getByRole("button", { name: "Send" }).click();

    await expect
      .element(screen.getByText(/several messages already/))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText("Message"))
      .toHaveValue("Hello there!\n");
  });

  it("does not submit without the required fields", async () => {
    const api = fakeApi({ contact: { submit: () => Effect.void } });
    const { screen } = await renderWithApi(<ContactPage />, api);

    await screen.getByRole("button", { name: "Send" }).click();

    await expect.element(screen.getByLabelText("Name")).toBeInvalid();
    expect(api.callsTo("contact", "submit")).toEqual([]);
  });
});
