import { Subject } from "@unhalteproblem.de/oidc";
import { type BlogSlug, BlogSlugMaxLength, BlogSlugPart } from "#domain/Blog";
import { Option, Schema, SchemaTransformation } from "effect";

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
 * The roles that are not scoped to anything: `normalUser`, `admin` and
 * `superAdmin` (see `Role`).
 */
export const GlobalRole = Schema.Literals([
  "normalUser",
  "admin",
  "superAdmin",
]).annotate({
  identifier: "GlobalRole",
  description: "A role that is not scoped to a subblog.",
});
export type GlobalRole = typeof GlobalRole.Type;

/** The prefix of every `BlogEditorRole`. */
const BLOG_EDITOR_ROLE_PREFIX = "blogEditor:";

// The whole role, for JSON Schema: the pattern a template literal exports
// covers only its literal parts and turns `BlogSlug` into "any string", so
// the slug rule is repeated here. Decoding checks `BlogSlug` itself too.
const BLOG_EDITOR_ROLE_PATTERN = /^blogEditor:[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The role of an editor of one subblog, `blogEditor:<slug>` with a
 * `BlogSlug`, e.g. `blogEditor:rust-notes`. Build it with `blogEditorRole`
 * and read the slug back with `blogOfEditorRole`.
 */
export const BlogEditorRole = Schema.TemplateLiteral([
  BLOG_EDITOR_ROLE_PREFIX,
  BlogSlugPart,
])
  // The pattern first: its JSON Schema `pattern` clashes with the template
  // literal's and goes into an `allOf`; the annotations below land on the
  // last check, which so stays at the top level.
  .check(
    Schema.isPattern(BLOG_EDITOR_ROLE_PATTERN, {
      expected:
        '"blogEditor:" followed by a blog slug, e.g. "blogEditor:rust-notes"',
    }),
    Schema.isMaxLength(BLOG_EDITOR_ROLE_PREFIX.length + BlogSlugMaxLength),
  )
  .annotate({
    identifier: "BlogEditorRole",
    description:
      "Edits the posts of one subblog: `blogEditor:<slug>`, e.g. " +
      "`blogEditor:rust-notes`.",
  });
export type BlogEditorRole = typeof BlogEditorRole.Type;

/** The `BlogEditorRole` for the subblog `slug`. */
export const blogEditorRole = (slug: BlogSlug): BlogEditorRole =>
  `${BLOG_EDITOR_ROLE_PREFIX}${slug}`;

/**
 * The subblog whose posts `role` lets the user edit: its slug for a
 * `BlogEditorRole`, `None` for every other role.
 */
export const blogOfEditorRole = (role: Role): Option.Option<BlogSlug> =>
  role.startsWith(BLOG_EDITOR_ROLE_PREFIX)
    ? Option.some(role.slice(BLOG_EDITOR_ROLE_PREFIX.length))
    : Option.none();

/**
 * An authorization role. Roles are stored in the backend's database, not in
 * Keycloak.
 *
 * - `normalUser`: every registered user; granted at registration.
 * - `admin`: administers the website.
 * - `superAdmin`: the highest level of administration.
 * - `blogEditor:<slug>` (`BlogEditorRole`): edits the posts of the subblog
 *   `<slug>`, and only that one; one such role per subblog.
 *
 * Every role, `blogEditor:<slug>` included, is granted and revoked by
 * superAdmins. Roles are flat: none implies another (`blogEditor:a` neither
 * implies nor is implied by `admin` or `blogEditor:b`), so a requirement that
 * admins and super admins both meet names both (see `Authorized` and
 * `RequireRoles`). A user can hold several roles at once.
 *
 * Adding a role is a contract change and needs a database migration in the
 * backend as well, since the backend stores roles by these names. Removing
 * or renaming one is breaking.
 */
export const Role = Schema.Union([GlobalRole, BlogEditorRole]).annotate({
  identifier: "Role",
  description:
    "An authorization role: `normalUser`, `admin`, `superAdmin` or " +
    "`blogEditor:<slug>` (edits the posts of the subblog `<slug>` only). " +
    "Roles are flat (none implies another) and a user can hold several.",
});
export type Role = typeof Role.Type;

/**
 * The logged-in user, taken from the OpenID Connect ID token and userinfo
 * claims at login, plus the roles from the backend's database. Everything
 * except `id` and `roles` depends on the scopes and the user's profile in
 * Keycloak, so it is optional.
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
  /**
   * The user's current roles. The backend reads them from its database on
   * every request, so a granted or revoked role takes effect without a new
   * login. Every registered user holds `normalUser`; the schema itself also
   * accepts an empty list.
   */
  roles: Schema.Array(Role),
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
export const IsoDateTimeUtc = Schema.String.annotate({
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
 * - `restricted`: Keycloak authenticated the user, but an admin has
 *   restricted the account (see `Restriction`), so no session is created
 *   until the restriction is lifted.
 * - `failed`: anything else, such as an error from Keycloak or a token that
 *   failed validation.
 *
 * Clients should treat an unknown value like `failed`: new reasons may be
 * added.
 */
export const LoginErrorReason = Schema.Literals([
  "cancelled",
  "expired",
  "restricted",
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
