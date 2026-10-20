import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { BlogSlug } from "./Blog.ts";
import { emptyDocument } from "./Document.ts";
import {
  ProjectInput,
  ProjectLimits,
  ProjectSlug,
  ProjectStatus,
  UpdateProjectPayload,
} from "./Project.ts";

describe("ProjectSlug", () => {
  const decode = Schema.decodeUnknownExit(ProjectSlug);

  it("follows the rule of BlogSlug", () => {
    const slugs = [
      "a",
      "type-checker",
      "2026-rewrite",
      "a".repeat(ProjectLimits.slugMaxLength),
      "a".repeat(ProjectLimits.slugMaxLength + 1),
      "",
      "Type-Checker",
      "type_checker",
      "-type",
      "type-",
      "type--checker",
      "über",
    ];
    const isBlogSlug = Schema.is(BlogSlug);
    for (const slug of slugs) {
      assert.strictEqual(Exit.isSuccess(decode(slug)), isBlogSlug(slug), slug);
    }
  });
});

describe("ProjectStatus", () => {
  it("is active, completed or archived", () => {
    const is = Schema.is(ProjectStatus);
    assert.isTrue(["active", "completed", "archived"].every(is));
    assert.isFalse(is("draft"));
  });
});

const input: typeof ProjectInput.Encoded = {
  slug: "type-checker",
  title: "Type checker",
  summary: "",
  tags: ["rust", "type-systems"],
  status: "active",
  featured: true,
  position: 0,
  repoUrl: "https://github.com/ada/type-checker",
  liveUrl: null,
  coverImage: null,
  content: emptyDocument,
  published: false,
};

describe("ProjectInput", () => {
  const decode = Schema.decodeUnknownExit(ProjectInput);

  it("accepts a complete project", () => {
    // At `unknown`: the decoded `coverImage` is a branded `MediaId`.
    assert.deepStrictEqual<unknown>(decode(input), Exit.succeed(input));
    const linked = {
      ...input,
      liveUrl: "http://example.org/",
      coverImage: "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60",
      position: ProjectLimits.maxPosition,
      summary: "x".repeat(ProjectLimits.summaryMaxLength),
      title: "x".repeat(ProjectLimits.titleMaxLength),
    };
    // At `unknown`: the decoded `coverImage` is a branded `MediaId`.
    assert.deepStrictEqual<unknown>(decode(linked), Exit.succeed(linked));
  });

  it.each([
    ["an untrimmed title", { title: " Type checker" }],
    ["an empty title", { title: "" }],
    [
      "a too long title",
      { title: "x".repeat(ProjectLimits.titleMaxLength + 1) },
    ],
    ["a NUL in the title", { title: "Type\u0000checker" }],
    ["an untrimmed summary", { summary: "A checker. " }],
    [
      "a too long summary",
      { summary: "x".repeat(ProjectLimits.summaryMaxLength + 1) },
    ],
    ["duplicate tags", { tags: ["rust", "rust"] }],
    ["an invalid tag", { tags: ["Rust"] }],
    ["eleven tags", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["an unknown status", { status: "draft" }],
    ["a negative position", { position: -1 }],
    ["a too large position", { position: ProjectLimits.maxPosition + 1 }],
    ["a fractional position", { position: 1.5 }],
    ["a javascript: repoUrl", { repoUrl: "javascript:alert(1)" }],
    ["a relative liveUrl", { liveUrl: "/projects" }],
    ["a missing repoUrl", { repoUrl: undefined }],
    ["an invalid coverImage", { coverImage: "cover.png" }],
    ["a document without doc root", { content: { type: "paragraph" } }],
    ["a missing published flag", { published: undefined }],
  ])("rejects %s", (_, change) => {
    assert.isTrue(Exit.isFailure(decode({ ...input, ...change })));
  });
});

describe("UpdateProjectPayload", () => {
  const decode = Schema.decodeUnknownExit(UpdateProjectPayload);

  it("requires the version the edit is based on", () => {
    const payload: typeof UpdateProjectPayload.Encoded = {
      ...input,
      version: 3,
    };
    // At `unknown`: the decoded `coverImage` is a branded `MediaId`.
    assert.deepStrictEqual<unknown>(decode(payload), Exit.succeed(payload));
    assert.isTrue(Exit.isFailure(decode(input)));
    assert.isTrue(Exit.isFailure(decode({ ...input, version: 0 })));
  });
});
