import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Schema } from "effect";
import {
  BlogLimits,
  BlogSlug,
  BlogSlugMaxLength,
  CreateBlogPayload,
  PostCursor,
  PostCursorMaxLength,
  PostId,
  PostInput,
  PostPageLimits,
  PostPageQuery,
  UpdateBlogPayload,
  UpdatePostPayload,
} from "./Blog.ts";
import { emptyDocument } from "./Document.ts";

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

const postId = "8d7e6f5a-4b3c-4d2e-8f1a-0b9c8d7e6f5a";

const postInput: typeof PostInput.Encoded = {
  slug: "hello-world",
  title: "Hello, world",
  summary: "",
  tags: ["rust", "type-systems"],
  coverImage: null,
  content: emptyDocument,
};

describe("PostInput", () => {
  const decode = Schema.decodeUnknownExit(PostInput);

  it("accepts a post, with and without a cover image", () => {
    assert.isTrue(Exit.isSuccess(decode(postInput)));
    assert.isTrue(
      Exit.isSuccess(
        decode({
          ...postInput,
          coverImage: "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60",
          tags: [],
          summary: "s".repeat(BlogLimits.postSummaryMaxLength),
          title: "t".repeat(BlogLimits.postTitleMaxLength),
          slug: "s".repeat(BlogLimits.postSlugMaxLength),
        }),
      ),
    );
  });

  it("accepts exactly the maximum number of tags", () => {
    const tags = Array.from({ length: BlogLimits.maxTags }, (_, i) => `t${i}`);
    assert.isTrue(Exit.isSuccess(decode({ ...postInput, tags })));
  });

  it.each([
    ["too many tags", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["duplicate tags", { tags: ["rust", "rust"] }],
    ["an uppercase tag", { tags: ["Rust"] }],
    ["an empty tag", { tags: [""] }],
    ["a too long tag", { tags: ["t".repeat(BlogLimits.tagMaxLength + 1)] }],
    ["an untrimmed title", { title: " Hello" }],
    ["an empty title", { title: "" }],
    ["a too long title", { title: "t".repeat(201) }],
    ["a title with NUL", { title: "a\u0000b" }],
    ["a too long summary", { summary: "s".repeat(501) }],
    ["an untrimmed summary", { summary: "teaser\n" }],
    ["an invalid slug", { slug: "Hello World" }],
    ["a too long slug", { slug: "s".repeat(129) }],
    ["a cover image that is not a UUID", { coverImage: "cover.png" }],
    ["a missing cover image key", { coverImage: undefined }],
    ["a content that is not a document", { content: { type: "paragraph" } }],
  ])("rejects %s", (_, change) => {
    assert.isTrue(Exit.isFailure(decode({ ...postInput, ...change })));
  });

  it("requires the version on updates", () => {
    const decodeUpdate = Schema.decodeUnknownExit(UpdatePostPayload);
    assert.isTrue(Exit.isSuccess(decodeUpdate({ ...postInput, version: 3 })));
    assert.isTrue(Exit.isFailure(decodeUpdate(postInput)));
    assert.isTrue(Exit.isFailure(decodeUpdate({ ...postInput, version: 0 })));
    assert.isTrue(Exit.isFailure(decodeUpdate({ ...postInput, version: 1.5 })));
  });
});

describe("Blog payloads", () => {
  it("validate title and description", () => {
    const decode = Schema.decodeUnknownExit(CreateBlogPayload);
    const ok = { slug: "rust-notes", title: "Rust notes", description: "" };
    assert.isTrue(Exit.isSuccess(decode(ok)));
    for (const bad of [
      { ...ok, title: "" },
      { ...ok, title: "t".repeat(121) },
      { ...ok, description: " x" },
      { ...ok, description: "d".repeat(1001) },
      { ...ok, slug: "Rust" },
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)));
    }
    assert.isTrue(
      Exit.isSuccess(
        Schema.decodeUnknownExit(UpdateBlogPayload)({
          title: "Rust",
          description: "d".repeat(1000),
        }),
      ),
    );
  });
});

describe("PostCursor", () => {
  const position = {
    publishedAt: DateTime.makeUnsafe("2026-07-04T08:09:10.123Z"),
    id: PostId.make(postId),
  };

  it("round-trips in both directions", () => {
    const encoded = Schema.encodeSync(PostCursor)(position);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.isAtMost(encoded.length, PostCursorMaxLength);
    assert.deepStrictEqual(Schema.decodeSync(PostCursor)(encoded), position);
    assert.strictEqual(
      Schema.encodeSync(PostCursor)(Schema.decodeSync(PostCursor)(encoded)),
      encoded,
    );
    assert.strictEqual(
      atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
      `[${DateTime.toEpochMillis(position.publishedAt)},"${postId}"]`,
    );
  });

  it("rejects malformed cursors", () => {
    const decode = Schema.decodeUnknownExit(PostCursor);
    const base64Url = (text: string) =>
      btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    for (const bad of [
      "",
      "not*base64url",
      base64Url("[]"),
      base64Url(`[1767268800000,"not-a-uuid"]`),
      base64Url(`["yesterday","${postId}"]`),
      "A".repeat(PostCursorMaxLength + 1),
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), bad);
    }
  });
});

describe("PostPageQuery", () => {
  const decode = Schema.decodeUnknownExit(PostPageQuery);

  it("fills in the default limit and keeps the tag", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: PostPageLimits.defaultLimit }),
    );
    assert.deepStrictEqual(
      decode({ limit: 50, tag: "rust" }),
      Exit.succeed({ limit: 50, tag: "rust" }),
    );
  });

  it("rejects limits out of range and invalid tags", () => {
    for (const bad of [{ limit: 0 }, { limit: 51 }, { tag: "Rust" }]) {
      assert.isTrue(Exit.isFailure(decode(bad)));
    }
  });
});
