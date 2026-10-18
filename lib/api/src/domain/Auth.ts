import { Subject } from "@unhalteproblem.de/oidc";
import { Schema, SchemaTransformation } from "effect";

/** Length limit of `ReturnPath`, generous for any real page URL. */
export const ReturnPathMaxLength = 2048;

// A same-site relative reference: exactly one leading "/", then only
// printable ASCII (U+0021-U+007E) except "\". Browsers treat "\" like "/",
// so "/\evil.example" would be protocol-relative too; whitespace and control
// characters are stripped by browsers or could split a header; anything
// non-ASCII could not be put into a `Location` header as is. Absolute URLs
// ("https:", "javascript:") and protocol-relative ones ("//host") therefore
// never match. The `u` flag is required for `Schema.isPattern` to export the
// pattern to JSON Schema.
const RETURN_PATH_PATTERN = /^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/u;

/**
 * Where to send the browser after the login, as a path on the website
 * itself, e.g. `/blog/post?x=1#y`.
 *
 * Only same-site relative paths are accepted, so `GET /auth/login` and
 * `GET /auth/register` cannot be abused as an open redirect: the path
 * starts with a single `/`, is 1 to 2048 characters long and consists of
 * printable ASCII only, without spaces or `\`. Callers percent-encode
 * everything else, e.g. with `encodeURI` (`/über` becomes `/%C3%BCber`);
 * `location.pathname`, `.search` and `.hash` are already encoded that way
 * by browsers.
 */
export const ReturnPath = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(ReturnPathMaxLength),
  Schema.isPattern(RETURN_PATH_PATTERN, {
    expected:
      'a relative path on this site starting with a single "/" ' +
      "(printable ASCII only, no spaces or backslashes; percent-encode " +
      "anything else)",
  }),
).annotate({
  identifier: "ReturnPath",
  description:
    "A path on the website to return to, e.g. `/blog/post?x=1#y`. " +
    "Printable ASCII only, without spaces or backslashes; percent-encode " +
    "anything else (e.g. with `encodeURI`). Absolute and protocol-relative " +
    "URLs are rejected.",
});
export type ReturnPath = typeof ReturnPath.Type;

/** Query parameters of `GET /auth/login` and `GET /auth/register`. */
export const LoginQuery = Schema.Struct({
  /** Where to return after the login; the website's start page if absent. */
  returnTo: Schema.optionalKey(ReturnPath),
}).annotate({ identifier: "LoginQuery" });
export type LoginQuery = typeof LoginQuery.Type;

/**
 * The logged-in user, taken from the OpenID Connect ID token and userinfo
 * claims at login. Everything except `id` depends on the scopes and the
 * user's profile in Keycloak, so it is optional.
 */
export const User = Schema.Struct({
  /** The OIDC subject (`sub`): Keycloak's stable user id. */
  id: Subject,
  /** `preferred_username`; a display hint, not unique or stable. */
  username: Schema.optionalKey(Schema.String),
  /** The full name (`name`). */
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  /** Whether Keycloak has verified `email` (`email_verified`). */
  emailVerified: Schema.optionalKey(Schema.Boolean),
}).annotate({
  identifier: "User",
  description: "The logged-in user.",
});
export type User = typeof User.Type;

/**
 * A `DateTime.Utc` encoded as an ISO 8601 UTC string. The same codec as
 * `Schema.DateTimeUtcFromString`, but with the encoded side documented as
 * `format: date-time` in JSON Schema.
 */
const IsoDateTimeUtc = Schema.String.annotate({
  format: "date-time",
  description: "An ISO 8601 date-time in UTC, e.g. `2026-01-01T12:00:00.000Z`.",
}).pipe(
  Schema.decodeTo(
    Schema.DateTimeUtc,
    SchemaTransformation.dateTimeUtcFromString,
  ),
);

/** Body of `GET /auth/session`: the browser's current login session. */
export const SessionInfo = Schema.Struct({
  user: User,
  /** When the session ends unless renewed. */
  expiresAt: IsoDateTimeUtc,
}).annotate({
  identifier: "SessionInfo",
  description: "The current login session.",
});
export type SessionInfo = typeof SessionInfo.Type;

/**
 * Why a login failed, sent as the `login_error` query parameter when the
 * backend redirects the browser back to the website after an unsuccessful
 * `GET /auth/callback` (e.g. `/?login_error=cancelled`):
 *
 * - `cancelled`: the user aborted the login at Keycloak (`access_denied`).
 * - `expired`: the login took too long or was started in another browser
 *   (the short-lived login cookie is missing, expired or does not match).
 * - `failed`: anything else, such as an error from Keycloak or a token that
 *   failed validation.
 */
export const LoginErrorReason = Schema.Literals([
  "cancelled",
  "expired",
  "failed",
]).annotate({
  identifier: "LoginErrorReason",
  description:
    "Why a login failed; the `login_error` query parameter of the redirect " +
    "back to the website.",
});
export type LoginErrorReason = typeof LoginErrorReason.Type;

/** Name of the query parameter that carries a `LoginErrorReason`. */
export const LoginErrorParam = "login_error";
