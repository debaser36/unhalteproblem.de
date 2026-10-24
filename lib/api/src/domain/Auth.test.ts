import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Option, Schema } from "effect";
import {
  BlogEditorRole,
  blogEditorRole,
  blogOfEditorRole,
  LoginErrorReason,
  LoginQuery,
  ReturnPath,
  ReturnPathMaxLength,
  Role,
  SessionInfo,
  User,
} from "./Auth.ts";
import { BlogSlugMaxLength } from "./Blog.ts";

const char = (codePoint: number) => String.fromCodePoint(codePoint);
// U+0021-U+007E without "\" (U+005C).
const printableAscii = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
  char(0x21 + i),
)
  .filter((c) => c !== "\\")
  .join("");

describe("ReturnPath", () => {
  const decode = Schema.decodeUnknownExit(ReturnPath);

  it.each([
    ["the start page", "/"],
    ["a path with query and fragment", "/blog/post?x=1#y"],
    ["a nested path", "/a/b/c/"],
    ["a dot segment", "/./a"],
    ["a percent-encoded slash", "/%2F%2Fevil.example"],
    ["a colon in the path", "/a:b"],
    ["percent-encoded non-ASCII letters", "/%C3%BCber"],
    ["a path encoded with encodeURI", encodeURI("/über uns?q=ä b#ö")],
    ["all printable ASCII except backslash", `/${printableAscii}`],
    ["exactly the maximum length", `/${"a".repeat(ReturnPathMaxLength - 1)}`],
  ])("accepts %s", (_, path) => {
    const exit = decode(path);
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) assert.strictEqual(exit.value, path);
  });

  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a path", "//evil.example/a"],
    ["a backslash after the slash", "/\\evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path without a leading slash", "evil"],
    ["a backslash inside", "/a\\b"],
    ["a space", "/a b"],
    ["a tab after the slash", "/\t"],
    ["a tab before a slash", "/\t/evil.example"],
    ["a newline (header splitting)", "/a\r\nSet-Cookie: x=y"],
    ["a NUL character", "/a\u0000"],
    ["a DEL character", "/a\u007f"],
    ["non-ASCII letters", "/über"],
    ["a C1 control character (U+0080)", `/a${char(0x80)}`],
    ["a C1 control character (U+009F)", `/a${char(0x9f)}`],
    ["a non-breaking space", `/a${char(0xa0)}b`],
    ["a line separator", `/a${char(0x2028)}b`],
    ["an emoji", `/a${char(0x1f600)}`],
    ["leading whitespace", " /a"],
    ["the empty string", ""],
    ["one character too many", `/${"a".repeat(ReturnPathMaxLength)}`],
    ["a non-string", 42],
  ])("rejects %s", (_, path) => {
    assert.isTrue(Exit.isFailure(decode(path)));
  });

  it("explains the rule in the error message", () => {
    const exit = decode("//evil.example");
    assert.isTrue(Exit.isFailure(exit));
    assert.include(
      String(exit),
      'a relative path on this site starting with a single "/"',
    );
  });
});

describe("LoginQuery", () => {
  const decode = Schema.decodeUnknownExit(LoginQuery);

  it("makes returnTo optional", () => {
    assert.deepStrictEqual(decode({}), Exit.succeed({}));
    assert.deepStrictEqual(
      decode({ returnTo: "/blog" }),
      Exit.succeed({ returnTo: "/blog" }),
    );
  });

  it("validates returnTo", () => {
    assert.isTrue(Exit.isFailure(decode({ returnTo: "//evil.example" })));
  });
});

describe("SessionInfo", () => {
  const encoded: typeof SessionInfo.Encoded = {
    user: {
      id: "f1b2c3",
      username: "ada",
      emailVerified: true,
      roles: ["normalUser", "admin"],
    },
    expiresAt: "2026-01-01T12:00:00.000Z",
  };

  it("decodes expiresAt from an ISO string and encodes it back", () => {
    const decoded = Schema.decodeSync(SessionInfo)(encoded);
    assert.isTrue(DateTime.isDateTime(decoded.expiresAt));
    assert.strictEqual(
      DateTime.toEpochMillis(decoded.expiresAt),
      Date.UTC(2026, 0, 1, 12),
    );
    assert.deepStrictEqual(Schema.encodeSync(SessionInfo)(decoded), encoded);
  });

  it("rejects an invalid date and an empty user id", () => {
    const decode = Schema.decodeUnknownExit(SessionInfo);
    assert.isTrue(Exit.isFailure(decode({ ...encoded, expiresAt: "soon" })));
    assert.isTrue(Exit.isFailure(decode({ ...encoded, user: { id: "" } })));
  });
});

describe("LoginErrorReason", () => {
  it("accepts exactly the documented reasons", () => {
    const is = Schema.is(LoginErrorReason);
    assert.isTrue(is("cancelled"));
    assert.isTrue(is("expired"));
    assert.isTrue(is("restricted"));
    assert.isTrue(is("failed"));
    assert.isFalse(is("access_denied"));
  });
});

describe("Role", () => {
  it("accepts exactly the documented roles", () => {
    const is = Schema.is(Role);
    assert.isTrue(is("normalUser"));
    assert.isTrue(is("admin"));
    assert.isTrue(is("superAdmin"));
    assert.isTrue(is("foodPlanner"));
    assert.isTrue(is("mealPlanBuyer"));
    assert.isFalse(is("root"));
    assert.isFalse(is("Admin"));
  });

  it("accepts blog editor roles", () => {
    assert.deepStrictEqual(
      Schema.decodeExit(Role)("blogEditor:rust-notes"),
      Exit.succeed("blogEditor:rust-notes"),
    );
  });
});

describe("BlogEditorRole", () => {
  const decode = Schema.decodeUnknownExit(BlogEditorRole);
  const decodeRole = Schema.decodeUnknownExit(Role);
  const longestSlug = "a".repeat(BlogSlugMaxLength);

  it.each([
    ["a one-word slug", "blogEditor:rust"],
    ["a slug with hyphens and digits", "blogEditor:2026-year-in-review"],
    ["the longest slug", `blogEditor:${longestSlug}`],
  ])("accepts %s", (_, role) => {
    assert.deepStrictEqual(decode(role), Exit.succeed(role as BlogEditorRole));
    assert.deepStrictEqual(decodeRole(role), Exit.succeed(role as Role));
  });

  it.each([
    ["the prefix alone", "blogEditor:"],
    ["the prefix without a colon", "blogEditor"],
    ["an uppercase slug", "blogEditor:Rust-Notes"],
    ["an underscore in the slug", "blogEditor:rust_notes"],
    ["a space in the slug", "blogEditor:rust notes"],
    ["a slash in the slug", "blogEditor:rust/notes"],
    ["a second colon", "blogEditor:rust:notes"],
    ["a leading hyphen", "blogEditor:-rust"],
    ["a doubled hyphen", "blogEditor:rust--notes"],
    ["a slug one character too long", `blogEditor:${longestSlug}a`],
    ["a differently cased prefix", "BlogEditor:rust"],
    ["leading whitespace", " blogEditor:rust"],
    ["a global role", "admin"],
  ])("rejects %s", (_, role) => {
    assert.isTrue(Exit.isFailure(decode(role)));
    if (role !== "admin") assert.isTrue(Exit.isFailure(decodeRole(role)));
  });

  it("exports the slug rule to JSON Schema", () => {
    const { schema, definitions } = Schema.toJsonSchemaDocument(BlogEditorRole);
    // The template literal's own pattern has "any string" for the slug; the
    // `allOf` pattern carries the slug rule.
    assert.deepStrictEqual(
      { schema, definitions },
      {
        schema: { $ref: "#/$defs/BlogEditorRole" },
        definitions: {
          BlogEditorRole: {
            type: "string",
            pattern: "^blogEditor:[\\s\\S]*?$",
            allOf: [{ pattern: "^blogEditor:[a-z0-9]+(?:-[a-z0-9]+)*$" }],
            maxLength: "blogEditor:".length + BlogSlugMaxLength,
            description:
              "Edits the posts of one subblog: `blogEditor:<slug>`, e.g. " +
              "`blogEditor:rust-notes`.",
          },
        },
      },
    );
  });

  it("is built from and read back to a slug", () => {
    const role = blogEditorRole("rust-notes");
    assert.strictEqual(role, "blogEditor:rust-notes");
    assert.deepStrictEqual(blogOfEditorRole(role), Option.some("rust-notes"));
    assert.deepStrictEqual(blogOfEditorRole("admin"), Option.none());
    assert.deepStrictEqual(blogOfEditorRole("superAdmin"), Option.none());
  });
});

describe("User", () => {
  const user: typeof User.Encoded = {
    id: "f1b2c3",
    username: "ada",
    roles: ["normalUser", "superAdmin"],
  };

  it("round-trips the roles", () => {
    const decoded = Schema.decodeSync(User)(user);
    assert.deepStrictEqual(decoded.roles, ["normalUser", "superAdmin"]);
    assert.deepStrictEqual(Schema.encodeSync(User)(decoded), user);
  });

  it("accepts an empty role list", () => {
    const decode = Schema.decodeUnknownExit(User);
    assert.deepStrictEqual(
      decode({ id: "f1b2c3", roles: [] }),
      Exit.succeed({ id: "f1b2c3", roles: [] }),
    );
  });

  it("requires roles and rejects unknown ones", () => {
    const decode = Schema.decodeUnknownExit(User);
    assert.isTrue(Exit.isFailure(decode({ id: "f1b2c3" })));
    assert.isTrue(
      Exit.isFailure(decode({ ...user, roles: ["normalUser", "root"] })),
    );
    assert.isTrue(Exit.isFailure(decode({ ...user, roles: "admin" })));
  });
});
