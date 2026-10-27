import { Category } from "@unhalteproblem.de/api";
import { Effect, Schema } from "effect";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { decode } from "#testing/fixtures.ts";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";
import { type CategoryChoice, CategoryFields } from "./CategoryFields.tsx";

const categories = decode(Schema.Array(Category))([
  { slug: "programming", name: "Programming", blogCount: 1, postCount: 4 },
  { slug: "security", name: "Security", blogCount: 1, postCount: 2 },
]);

/** The fields with their state, reporting each change to `seen`. */
const render = async (initial: CategoryChoice) => {
  const seen: Array<CategoryChoice> = [];
  function Form() {
    const [value, setValue] = useState(initial);
    return (
      <CategoryFields
        value={value}
        onChange={(next) => {
          seen.push(next);
          setValue(next);
        }}
      />
    );
  }
  const { screen } = await renderWithApi(
    <Form />,
    fakeApi({ blogs: { listCategories: () => Effect.succeed(categories) } }),
  );
  return { screen, seen };
};

describe("CategoryFields", () => {
  it("marks a main category that does not exist yet", async () => {
    const { screen } = await render({ main: "", extra: [] });

    await screen.getByLabelText("Main category").fill("Programming");
    await expect
      .element(screen.getByText("Pick one, or type a new one."))
      .toBeVisible();
    await screen.getByLabelText("Main category").fill("Compilers");
    await expect
      .element(screen.getByText("New category: it will be added for everyone."))
      .toBeVisible();
  });

  it("adds extra categories with Enter, cleaned and without duplicates", async () => {
    const { screen, seen } = await render({ main: "Programming", extra: [] });
    const more = screen.getByLabelText("More categories");

    await more.fill("  security  ");
    await more.click();
    await userEnter();
    await more.fill("programming");
    await userEnter();

    expect(seen.at(-1)).toEqual({ main: "Programming", extra: ["security"] });
    await expect.element(more).toHaveValue("");
  });

  it("stops at the maximum and removes one again", async () => {
    const { screen, seen } = await render({
      main: "Programming",
      extra: ["Security", "Compilers", "Types"],
    });

    await expect
      .element(screen.getByLabelText("More categories"))
      .toBeDisabled();
    await expect.element(screen.getByText("(new)").first()).toBeInTheDocument();
    await screen.getByRole("button", { name: "Remove Compilers" }).click();

    expect(seen.at(-1)).toEqual({
      main: "Programming",
      extra: ["Security", "Types"],
    });
    await expect
      .element(screen.getByLabelText("More categories"))
      .toBeEnabled();
  });
});

async function userEnter() {
  const { userEvent } = await import("vitest/browser");
  await userEvent.keyboard("{Enter}");
}
