import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { HttpUrl, HttpUrlMaxLength } from "./HttpUrl.ts";

describe("HttpUrl", () => {
  const decode = Schema.decodeUnknownExit(HttpUrl);
  const longest = `https://example.org/${"a".repeat(HttpUrlMaxLength - 20)}`;

  it.each([
    ["an http URL", "http://example.org"],
    ["an https URL", "https://example.org/"],
    ["a repository", "https://github.com/ada/type-checker"],
    ["a port, query and fragment", "https://example.org:8443/a?b=c&d=e#f"],
    ["an uppercase host", "https://Example.ORG/Path"],
    ["a non-ASCII host", "https://bücher.example/"],
    ["an @ in the path", "https://mastodon.example/@ada"],
    ["an IPv6 host", "http://[::1]:8080/"],
    ["exactly the maximum length", longest],
  ])("accepts %s, unchanged", (_, url) => {
    assert.deepStrictEqual(decode(url), Exit.succeed(url));
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: disguised", "java\nscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp:", "ftp://example.org/file"],
    ["mailto:", "mailto:ada@example.org"],
    ["a site-relative path", "/projects/type-checker"],
    ["a relative path", "projects/type-checker"],
    ["a protocol-relative URL", "//example.org/"],
    ["a host without scheme", "example.org"],
    ["an uppercase scheme", "HTTPS://example.org/"],
    ["a mixed-case scheme", "Https://example.org/"],
    ["a scheme without slashes", "https:example.org"],
    ["a scheme with one slash", "https:/example.org"],
    ["leading whitespace", " https://example.org/"],
    ["trailing whitespace", "https://example.org/ "],
    ["a space in the path", "https://example.org/a b"],
    ["a tab", "https://example.org/a\tb"],
    ["a NUL", "https://example.org/a\u0000b"],
    ["no host", "https://"],
    ["an invalid host", "https://exa<mple.org/"],
    ["an invalid port", "https://example.org:99999/"],
    ["a user name", "https://ada@example.org/"],
    ["a user name and password", "https://ada:secret@example.org/"],
    ["a host disguised as user name", "https://github.com@evil.example/"],
    ["the empty string", ""],
    ["one character too many", `${longest}a`],
    ["a non-string", 42],
  ])("rejects %s", (_, url) => {
    assert.isTrue(Exit.isFailure(decode(url)));
  });

  it("exports its prefix rule and length to JSON Schema", () => {
    const { definitions } = Schema.toJsonSchemaDocument(HttpUrl);
    const schema = definitions["HttpUrl"] as {
      readonly maxLength?: number;
      readonly pattern?: string;
      readonly allOf?: ReadonlyArray<{ readonly pattern?: string }>;
    };
    assert.strictEqual(schema.maxLength, HttpUrlMaxLength);
    const patterns = [
      schema.pattern,
      ...(schema.allOf ?? []).map((s) => s.pattern),
    ];
    assert.isTrue(
      patterns.some((pattern) => pattern?.startsWith("^https?:\\/\\/")),
      JSON.stringify(schema),
    );
  });
});
