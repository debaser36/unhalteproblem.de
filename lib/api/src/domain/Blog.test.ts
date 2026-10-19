import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { BlogSlug, BlogSlugMaxLength } from "./Blog.ts";

describe("BlogSlug", () => {
  const decode = Schema.decodeUnknownExit(BlogSlug);

  it.each([
    ["one letter", "a"],
    ["one digit", "7"],
    ["words separated by hyphens", "rust-notes"],
    ["digits and letters", "2026-year-in-review"],
    ["exactly the maximum length", "a".repeat(BlogSlugMaxLength)],
  ])("accepts %s", (_, slug) => {
    assert.deepStrictEqual(decode(slug), Exit.succeed(slug));
  });

  it.each([
    ["the empty string", ""],
    ["uppercase letters", "Rust-Notes"],
    ["an underscore", "rust_notes"],
    ["a space", "rust notes"],
    ["a slash", "rust/notes"],
    ["a colon", "blog:rust"],
    ["non-ASCII letters", "über"],
    ["a leading hyphen", "-rust"],
    ["a trailing hyphen", "rust-"],
    ["a doubled hyphen", "rust--notes"],
    ["one character too many", "a".repeat(BlogSlugMaxLength + 1)],
    ["a non-string", 42],
  ])("rejects %s", (_, slug) => {
    assert.isTrue(Exit.isFailure(decode(slug)));
  });

  it("exports its rules to JSON Schema", () => {
    const { schema, definitions } = Schema.toJsonSchemaDocument(BlogSlug);
    assert.deepStrictEqual(
      { schema, definitions },
      {
        schema: { $ref: "#/$defs/BlogSlug" },
        definitions: {
          BlogSlug: {
            type: "string",
            description: "URL slug of a subblog, e.g. `rust-notes`",
            minLength: 1,
            maxLength: BlogSlugMaxLength,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          },
        },
      },
    );
  });
});
