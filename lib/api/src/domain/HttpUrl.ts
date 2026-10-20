import { Schema } from "effect";

/** Length limit of `HttpUrl`. */
export const HttpUrlMaxLength = 2048;

// Checked on the string as given, not only on the parsed URL: it starts with
// a lowercase `http://` or `https://` (the database checks
// `~ '^https?://'`, case-sensitive) and contains no space and no ASCII control
// character, which the URL parser would silently strip or percent-encode, so
// the stored string would not be the URL that was checked. The `u` flag is
// required for `Schema.isPattern` to export the pattern to JSON Schema.
// oxlint-disable-next-line no-control-regex -- excluding controls is the point
const HTTP_URL_PATTERN = /^https?:\/\/[^\u0000- \u007f]+$/u;

const isHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    // No credentials: a password in a public link is a leak, and
    // `https://github.com@evil.example/` is a phishing trick (the host is
    // `evil.example`).
    url.username === "" &&
    url.password === ""
  );
};

/**
 * An absolute `http:` or `https:` URL, e.g. a link to a project's source
 * code or to the project itself: at most 2048 characters, a lowercase
 * scheme, no spaces or control characters, a host the URL parser (WHATWG,
 * as in browsers) accepts, and no user name or password (`user:pass@`).
 * `javascript:`, `data:`, `ftp:`, `mailto:` and relative URLs are rejected.
 *
 * Validated, not normalized: the string is kept as given.
 */
export const HttpUrl = Schema.String.check(
  Schema.isMaxLength(HttpUrlMaxLength),
  Schema.isPattern(HTTP_URL_PATTERN, {
    expected:
      "an absolute URL starting with http:// or https://, without spaces " +
      "or control characters",
  }),
  Schema.makeFilter<string>(
    (value) =>
      isHttpUrl(value) ||
      "a valid absolute http(s) URL without user name or password",
    { expected: "a valid absolute http(s) URL without user name or password" },
  ),
).annotate({
  identifier: "HttpUrl",
  description:
    "An absolute `http://` or `https://` URL (lowercase scheme), at most " +
    "2048 characters, without spaces, control characters or credentials " +
    "(`user:pass@`).",
  format: "uri",
});
export type HttpUrl = typeof HttpUrl.Type;
