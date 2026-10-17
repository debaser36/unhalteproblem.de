import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Schema } from "effect";
import {
  LoginErrorReason,
  LoginQuery,
  ReturnPath,
  ReturnPathMaxLength,
  SessionInfo,
} from "./Auth.ts";

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
  const encoded = {
    user: { id: "f1b2c3", username: "ada", emailVerified: true },
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
    assert.isTrue(is("failed"));
    assert.isFalse(is("access_denied"));
  });
});
