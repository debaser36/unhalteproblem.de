import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import {
  CategoriesInput,
  CategoryLimits,
  CategoryName,
  CategorySlug,
  categorySlugOf,
  DefaultCategorySlug,
  PresetCategories,
} from "./Category.ts";

describe("categorySlugOf", () => {
  it.each([
    ["Systems & Infrastructure", "systems-and-infrastructure"],
    ["Data & AI", "data-and-ai"],
    ["Café", "cafe"],
    ["Web Development", "web-development"],
    ["web development", "web-development"],
    ["Web-Development", "web-development"],
    ["  --Rust__Lang--  ", "rust-lang"],
    ["!!!", ""],
    ["日本語", ""],
  ])("maps %j to %j", (name, slug) => {
    assert.strictEqual(categorySlugOf(name), slug);
  });

  it("cuts to 48 characters without a trailing hyphen", () => {
    const slug = categorySlugOf(`${"a".repeat(47)} b`);
    assert.strictEqual(slug, "a".repeat(47));
    assert.isAtMost(categorySlugOf("x".repeat(100)).length, 48);
  });

  it("maps every preset to a valid, distinct slug", () => {
    const slugs = PresetCategories.map(categorySlugOf);
    assert.strictEqual(new Set(slugs).size, PresetCategories.length);
    for (const slug of slugs) {
      assert.isTrue(
        Exit.isSuccess(Schema.decodeUnknownExit(CategorySlug)(slug)),
      );
    }
    assert.include(slugs, DefaultCategorySlug);
  });
});

describe("CategoryName", () => {
  const decode = Schema.decodeUnknownExit(CategoryName);

  it("accepts trimmed names with a slug", () => {
    for (const name of ["Web Development", "C", "a".repeat(48)]) {
      assert.isTrue(Exit.isSuccess(decode(name)), name);
    }
  });

  it("rejects empty, untrimmed, too long, NUL and slugless names", () => {
    for (const name of [
      "",
      " Rust",
      "a".repeat(CategoryLimits.nameMaxLength + 1),
      "a\u0000b",
      "!!!",
      42,
    ]) {
      assert.isTrue(Exit.isFailure(decode(name)), String(name));
    }
  });
});

describe("CategoriesInput", () => {
  const decode = Schema.decodeUnknownExit(CategoriesInput);

  it("accepts a main and up to three distinct extra categories", () => {
    assert.isTrue(Exit.isSuccess(decode({ main: "Security", extra: [] })));
    assert.isTrue(
      Exit.isSuccess(
        decode({
          main: "Security",
          extra: ["Career", "Personal", "Data & AI"],
        }),
      ),
    );
  });

  it.each([
    ["four extra categories", { main: "A", extra: ["B", "C", "D", "E"] }],
    [
      "the main among the extra ones",
      { main: "Web Development", extra: ["web-development"] },
    ],
    ["duplicate extra categories", { main: "A", extra: ["B", "b"] }],
    ["a missing main", { extra: [] }],
    ["a missing extra list", { main: "A" }],
  ])("rejects %s", (_, input) => {
    assert.isTrue(Exit.isFailure(decode(input)));
  });
});
